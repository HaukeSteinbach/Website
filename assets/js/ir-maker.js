/**
 * IR Maker: impulse-response generator from sine-sweep recordings.
 *
 * Everything runs locally in the browser:
 *   • Load a reference exponential sine sweep (or generate one).
 *   • Load up to 20 named microphone recordings of that sweep.
 *   • Trim / align, optionally remove hum & room noise (phase-preserving).
 *   • Deconvolve each recording into an impulse response.
 *   • Export as a ZIP of named WAV files or a single multitrack WAV.
 *
 * No dependencies: FFT, WAV encoding and ZIP (store) are implemented inline.
 */
(function () {
    'use strict';

    var MAX_MICS = 20;

    /* ============================================================
       FFT: iterative in-place radix-2, separate real/imag arrays
       ============================================================ */
    function fft(re, im, inverse) {
        var n = re.length;
        if (n <= 1) return;
        // bit-reversal permutation
        for (var i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr = re[i]; re[i] = re[j]; re[j] = tr;
                var ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var ang = (inverse ? 2 : -2) * Math.PI / len;
            var wr = Math.cos(ang), wi = Math.sin(ang);
            var half = len >> 1;
            for (var start = 0; start < n; start += len) {
                var cwr = 1, cwi = 0;
                for (var k = 0; k < half; k++) {
                    var a = start + k, b = a + half;
                    var vr = re[b] * cwr - im[b] * cwi;
                    var vi = re[b] * cwi + im[b] * cwr;
                    re[b] = re[a] - vr; im[b] = im[a] - vi;
                    re[a] += vr; im[a] += vi;
                    var ncwr = cwr * wr - cwi * wi;
                    cwi = cwr * wi + cwi * wr;
                    cwr = ncwr;
                }
            }
        }
        if (inverse) {
            for (var x = 0; x < n; x++) { re[x] /= n; im[x] /= n; }
        }
    }

    function nextPow2(n) {
        var p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    /* ============================================================
       DSP
       ============================================================ */

    // Cross-correlation delay: lag of sig relative to ref, plus polarity sign.
    function findDelay(ref, sig) {
        var N = nextPow2(ref.length + sig.length);
        var ar = new Float64Array(N), ai = new Float64Array(N);
        var br = new Float64Array(N), bi = new Float64Array(N);
        var i;
        for (i = 0; i < sig.length; i++) ar[i] = sig[i];
        for (i = 0; i < ref.length; i++) br[i] = ref[i];
        fft(ar, ai, false);
        fft(br, bi, false);
        // sig * conj(ref)
        for (i = 0; i < N; i++) {
            var rr = ar[i] * br[i] + ai[i] * bi[i];
            var ii = ai[i] * br[i] - ar[i] * bi[i];
            ar[i] = rr; ai[i] = ii;
        }
        fft(ar, ai, true);
        var peak = 0, idx = 0, sign = 1;
        for (i = 0; i < N; i++) {
            var v = ar[i];
            var a = v < 0 ? -v : v;
            if (a > peak) { peak = a; idx = i; sign = v < 0 ? -1 : 1; }
        }
        if (idx > N / 2) idx -= N;
        return { lag: idx, sign: sign };
    }

    // Nearest transient (energy onset) to an approximate sample, within a radius.
    function findNearestTransient(data, sampleRate, approx, radius) {
        var win = Math.max(1, Math.round(sampleRate * 0.002));
        var lo = Math.max(0, approx - radius);
        var hi = Math.min(data.length - 1, approx + radius);
        var bestIdx = approx, bestOnset = -Infinity, prevE = 0, first = true;
        for (var i = lo; i < hi; i += win) {
            var e = 0;
            for (var k = 0; k < win && i + k < data.length; k++) {
                var v = data[i + k];
                e += v * v;
            }
            if (!first) {
                var onset = e - prevE;
                if (onset > bestOnset) { bestOnset = onset; bestIdx = i; }
            }
            prevE = e;
            first = false;
        }
        return bestIdx;
    }

    // Sum a stereo pair to mono below a cutoff using a linear-phase crossover.
    function monoLowCrossover(L, R, sampleRate, cutoff) {
        var len = Math.max(L.length, R.length);
        var N = nextPow2(len);
        var Lr = new Float64Array(N), Li = new Float64Array(N);
        var Rr = new Float64Array(N), Ri = new Float64Array(N);
        var i;
        for (i = 0; i < L.length; i++) Lr[i] = L[i];
        for (i = 0; i < R.length; i++) Rr[i] = R[i];
        fft(Lr, Li, false);
        fft(Rr, Ri, false);
        var lo = cutoff / Math.SQRT2;   // half-octave transition band
        var hi = cutoff * Math.SQRT2;
        for (i = 0; i < N; i++) {
            var freq = i <= N / 2 ? i * sampleRate / N : (N - i) * sampleRate / N;
            var w;                       // 1 = full mono, 0 = full stereo
            if (freq <= lo) w = 1;
            else if (freq >= hi) w = 0;
            else w = 0.5 + 0.5 * Math.cos(Math.PI * (freq - lo) / (hi - lo));
            if (w <= 0) continue;
            var mr = (Lr[i] + Rr[i]) * 0.5, mi = (Li[i] + Ri[i]) * 0.5;
            Lr[i] = w * mr + (1 - w) * Lr[i]; Li[i] = w * mi + (1 - w) * Li[i];
            Rr[i] = w * mr + (1 - w) * Rr[i]; Ri[i] = w * mi + (1 - w) * Ri[i];
        }
        fft(Lr, Li, true);
        fft(Rr, Ri, true);
        var outL = new Float32Array(len), outR = new Float32Array(len);
        for (i = 0; i < len; i++) { outL[i] = Lr[i]; outR[i] = Rr[i]; }
        return [outL, outR];
    }

    // RT60 via Schroeder backward integration (T30 doubled).
    function measureRT60(ir, sampleRate) {
        var N = ir.length;
        var edc = new Float64Array(N);
        var sum = 0;
        for (var i = N - 1; i >= 0; i--) { sum += ir[i] * ir[i]; edc[i] = sum; }
        if (sum <= 0) return 0;
        var ref = edc[0];
        var i5 = -1, i35 = -1;
        for (i = 0; i < N; i++) {
            var db = 10 * Math.log10(edc[i] / ref);
            if (i5 < 0 && db <= -5) i5 = i;
            if (db <= -35) { i35 = i; break; }
        }
        if (i5 < 0) i5 = 0;
        if (i35 < 0) i35 = N - 1;
        var t30 = (i35 - i5) / sampleRate;
        return t30 * 2;
    }

    // Phase-preserving spectral subtraction (removes hum + steady room noise).
    function denoise(sig, sampleRate) {
        var frame = 4096;
        if (sig.length < frame * 2) return sig;
        var hop = frame >> 2;                 // 75% overlap
        var bins = (frame >> 1) + 1;
        var win = new Float64Array(frame);
        var wi;
        for (wi = 0; wi < frame; wi++) win[wi] = 0.5 - 0.5 * Math.cos(2 * Math.PI * wi / (frame - 1));

        var numFrames = Math.floor((sig.length - frame) / hop) + 1;

        // ---- noise estimate: per-bin low percentile of magnitude ----
        var estStride = Math.max(1, Math.floor(numFrames / 400)); // cap samples used
        var estFrames = [];
        var fr = new Float64Array(frame), fi = new Float64Array(frame);
        var f, b, pos;
        var collected = [];
        for (b = 0; b < bins; b++) collected.push([]);
        for (f = 0; f < numFrames; f += estStride) {
            pos = f * hop;
            for (var t = 0; t < frame; t++) { fr[t] = sig[pos + t] * win[t]; fi[t] = 0; }
            fft(fr, fi, false);
            for (b = 0; b < bins; b++) {
                collected[b].push(Math.hypot(fr[b], fi[b]));
            }
        }
        var noiseMag = new Float64Array(bins);
        for (b = 0; b < bins; b++) {
            var arr = collected[b];
            arr.sort(function (x, y) { return x - y; });
            noiseMag[b] = arr[Math.floor(arr.length * 0.15)] || 0; // 15th percentile
        }
        collected = null;

        // ---- subtract & resynthesize with original phase ----
        var out = new Float64Array(sig.length);
        var norm = new Float64Array(sig.length);
        var alpha = 2.0;   // over-subtraction
        var floorGain = 0.05; // spectral floor
        for (f = 0; f < numFrames; f++) {
            pos = f * hop;
            for (var s = 0; s < frame; s++) { fr[s] = sig[pos + s] * win[s]; fi[s] = 0; }
            fft(fr, fi, false);
            for (b = 0; b < bins; b++) {
                var re = fr[b], im = fi[b];
                var mag = Math.hypot(re, im);
                if (mag < 1e-12) continue;
                var reduced = mag - alpha * noiseMag[b];
                if (reduced < floorGain * mag) reduced = floorGain * mag;
                var g = reduced / mag;              // gain only -> phase preserved
                fr[b] *= g; fi[b] *= g;
                if (b > 0 && b < frame - b) {        // mirror to conjugate bin
                    fr[frame - b] *= g; fi[frame - b] *= g;
                }
            }
            fft(fr, fi, true);
            for (var o = 0; o < frame; o++) {
                out[pos + o] += fr[o] * win[o];
                norm[pos + o] += win[o] * win[o];
            }
        }
        var result = new Float32Array(sig.length);
        for (var n = 0; n < sig.length; n++) {
            result[n] = norm[n] > 1e-8 ? out[n] / norm[n] : sig[n];
        }
        return result;
    }

    // Regularized frequency-domain deconvolution -> impulse response.
    function deconvolve(ref, resp, sampleRate, opts) {
        var N = nextPow2(ref.length + resp.length);
        var Rr = new Float64Array(N), Ri = new Float64Array(N);
        var Yr = new Float64Array(N), Yi = new Float64Array(N);
        var i;
        for (i = 0; i < ref.length; i++) Rr[i] = ref[i];
        for (i = 0; i < resp.length; i++) Yr[i] = resp[i];
        fft(Rr, Ri, false);
        fft(Yr, Yi, false);

        // peak reference power for regularization scaling
        var pmax = 0;
        for (i = 0; i < N; i++) {
            var p = Rr[i] * Rr[i] + Ri[i] * Ri[i];
            if (p > pmax) pmax = p;
        }
        var epsIn = pmax * 1e-5;
        var epsOut = pmax * 1e-1;
        var f1 = opts.f1 || 20, f2 = opts.f2 || 20000;
        var lo = f1 * 0.5, hi = f2 * 1.5;    // half-octave transition

        for (i = 0; i < N; i++) {
            var freq = i <= N / 2 ? i * sampleRate / N : (N - i) * sampleRate / N;
            var eps;
            if (freq >= f1 && freq <= f2) eps = epsIn;
            else if (freq < lo || freq > hi) eps = epsOut;
            else {
                // smooth ramp in the transition band
                var t = freq < f1 ? (f1 - freq) / (f1 - lo) : (freq - f2) / (hi - f2);
                eps = epsIn + (epsOut - epsIn) * Math.min(1, Math.max(0, t));
            }
            var rr = Rr[i], ri = Ri[i];
            var yr = Yr[i], yi = Yi[i];
            var denom = rr * rr + ri * ri + eps;
            // H = Y * conj(R) / denom
            Rr[i] = (yr * rr + yi * ri) / denom;
            Ri[i] = (yi * rr - yr * ri) / denom;
        }
        fft(Rr, Ri, true);

        // circular peak search
        var peak = 0, pIdx = 0;
        for (i = 0; i < N; i++) {
            var a = Rr[i] < 0 ? -Rr[i] : Rr[i];
            if (a > peak) { peak = a; pIdx = i; }
        }
        var pre = Math.round(sampleRate * 0.005);
        var startIdx = pIdx - pre;

        var irLen;
        if (opts.irLength > 0) {
            irLen = Math.round(opts.irLength * sampleRate);
        } else {
            // auto: trim tail at -60 dB, cap at 4 s
            irLen = autoTailLength(Rr, N, pIdx, peak, sampleRate);
        }
        if (irLen > N) irLen = N;

        var ir = new Float32Array(irLen);
        for (i = 0; i < irLen; i++) {
            ir[i] = Rr[((startIdx + i) % N + N) % N];
        }
        // short fade-in over the pre-roll, fade-out over last 10%
        var fadeIn = pre;
        for (i = 0; i < fadeIn && i < irLen; i++) ir[i] *= i / fadeIn;
        var fadeOut = Math.max(1, Math.round(irLen * 0.1));
        for (i = 0; i < fadeOut; i++) {
            ir[irLen - 1 - i] *= i / fadeOut;
        }
        return ir;
    }

    function autoTailLength(h, N, pIdx, peak, sampleRate) {
        var thresh = peak * 0.001; // -60 dB
        var maxLen = Math.round(sampleRate * 4);
        var win = Math.round(sampleRate * 0.02);
        var last = Math.round(sampleRate * 0.25);
        for (var i = 0; i < maxLen; i += win) {
            var e = 0;
            for (var k = 0; k < win; k++) {
                var v = h[((pIdx + i + k) % N + N) % N];
                e += v * v;
            }
            var rms = Math.sqrt(e / win);
            if (rms > thresh) last = i + win;
        }
        return Math.min(maxLen, last + Math.round(sampleRate * 0.05));
    }

    function peakNormalize(ir, targetDb) {
        var peak = 0;
        for (var i = 0; i < ir.length; i++) {
            var a = ir[i] < 0 ? -ir[i] : ir[i];
            if (a > peak) peak = a;
        }
        if (peak < 1e-9) return;
        var target = Math.pow(10, targetDb / 20);
        var g = target / peak;
        for (i = 0; i < ir.length; i++) ir[i] *= g;
    }

    /* ============================================================
       Exponential sine sweep generator (Farina)
       ============================================================ */
    function generateSweep(duration, sampleRate, f1, f2) {
        var n = Math.round(duration * sampleRate);
        var out = new Float32Array(n);
        var w1 = 2 * Math.PI * f1;
        var w2 = 2 * Math.PI * f2;
        var K = w1 * duration / Math.log(w2 / w1);
        var L = Math.log(w2 / w1) / duration;
        for (var i = 0; i < n; i++) {
            var t = i / sampleRate;
            out[i] = Math.sin(K * (Math.exp(t * L) - 1));
        }
        // short fades to avoid clicks
        var fi = Math.round(sampleRate * 0.01);
        var fo = Math.round(sampleRate * 0.05);
        for (i = 0; i < fi && i < n; i++) out[i] *= i / fi;
        for (i = 0; i < fo && i < n; i++) out[n - 1 - i] *= i / fo;
        return out;
    }

    /* ============================================================
       WAV encoder: 16/24-bit PCM or 32-bit float, multichannel
       ============================================================ */
    function encodeWav(channels, sampleRate, mode) {
        var numCh = channels.length;
        var frames = channels[0].length;
        var isFloat = mode === '32f';
        var bytesPerSample = isFloat ? 4 : (mode === '24' ? 3 : 2);
        var blockAlign = numCh * bytesPerSample;
        var dataSize = frames * blockAlign;
        var buffer = new ArrayBuffer(44 + dataSize);
        var view = new DataView(buffer);

        function writeStr(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, isFloat ? 3 : 1, true);      // format: 1 PCM, 3 float
        view.setUint16(22, numCh, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bytesPerSample * 8, true);
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        var off = 44;
        for (var f = 0; f < frames; f++) {
            for (var c = 0; c < numCh; c++) {
                var x = channels[c][f];
                if (isFloat) {
                    view.setFloat32(off, x, true);
                    off += 4;
                } else if (mode === '24') {
                    var v24 = clampInt(x, 8388607, 8388608);
                    view.setUint8(off, v24 & 0xFF);
                    view.setUint8(off + 1, (v24 >> 8) & 0xFF);
                    view.setUint8(off + 2, (v24 >> 16) & 0xFF);
                    off += 3;
                } else {
                    view.setInt16(off, clampInt(x, 32767, 32768), true);
                    off += 2;
                }
            }
        }
        return buffer;
    }

    function clampInt(x, posMax, negMax) {
        if (x > 1) x = 1; else if (x < -1) x = -1;
        return x < 0 ? Math.round(x * negMax) : Math.round(x * posMax);
    }

    /* ============================================================
       Minimal ZIP writer (STORE / no compression) + CRC32
       ============================================================ */
    var crcTable = (function () {
        var t = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(buf) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function buildZip(files) {
        // files: [{ name, data:Uint8Array }]
        var parts = [];
        var central = [];
        var offset = 0;
        var enc = new TextEncoder();

        files.forEach(function (file) {
            var nameBytes = enc.encode(file.name);
            var crc = crc32(file.data);
            var size = file.data.length;

            var local = new Uint8Array(30 + nameBytes.length);
            var lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);       // version
            lv.setUint16(6, 0, true);        // flags
            lv.setUint16(8, 0, true);        // method: store
            lv.setUint16(10, 0, true);       // time
            lv.setUint16(12, 0x21, true);    // date
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            local.set(nameBytes, 30);
            parts.push(local, file.data);

            var cen = new Uint8Array(46 + nameBytes.length);
            var cv = new DataView(cen.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0x21, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint32(42, offset, true);
            cen.set(nameBytes, 46);
            central.push(cen);

            offset += local.length + size;
        });

        var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);

        return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
    }

    /* ============================================================
       Audio decode helpers
       ============================================================ */
    function decodeToMono(arrayBuffer, sampleRate) {
        return new Promise(function (resolve, reject) {
            var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            var ctx = new Ctx(1, 1, sampleRate);
            ctx.decodeAudioData(arrayBuffer.slice(0),
                function (buf) {
                    var chs = buf.numberOfChannels;
                    var len = buf.length;
                    var mono = new Float32Array(len);
                    for (var c = 0; c < chs; c++) {
                        var d = buf.getChannelData(c);
                        for (var i = 0; i < len; i++) mono[i] += d[i];
                    }
                    if (chs > 1) for (var i2 = 0; i2 < len; i2++) mono[i2] /= chs;
                    resolve({ data: mono, sampleRate: buf.sampleRate });
                },
                function (err) { reject(err || new Error('Could not decode audio file.')); }
            );
        });
    }

    // Best-effort read of a WAV header sample rate for the info line.
    function readWavSampleRate(arrayBuffer) {        try {
            var v = new DataView(arrayBuffer);
            if (v.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
            return v.getUint32(24, true);
        } catch (e) { return null; }
    }

    function download(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function sanitize(name) {
        return (name || 'mic').replace(/[^A-Za-z0-9\-_ ]/g, '_').trim().replace(/\s+/g, '_') || 'mic';
    }

    // Filesystem-safe name that keeps spaces and dashes (for rack folder/file titles).
    function safeName(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'IR Convolution Rack';
    }

    // First word of a filename (before the first space), extension stripped.
    function micNameFromFilename(filename) {
        var base = String(filename || '').replace(/\.[^.\s]+$/, '');
        var first = base.split(/\s+/)[0];
        return first || base || 'Mic';
    }

    // Detect a name ending in L or R: returns { key, base, side } or null.
    function pairInfo(name) {
        var m = String(name || '').match(/^(.+?)[ _\-]*([LR])$/i);
        if (!m || !m[1]) return null;
        var key = String(name).slice(0, -1).toLowerCase().replace(/[ _\-]+$/, '');
        if (!key) return null;
        return { key: key, base: m[1], side: m[2].toUpperCase() };
    }

    /* ============================================================
       Ableton Audio Effect Rack (.adg) generation
       Clones the embedded Convolution Reverb Pro rack template,
       one convolution chain per exported IR.
       ============================================================ */
    function escXml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function strToU8(s) { return new TextEncoder().encode(s); }
    function u8ToStr(u8) { return new TextDecoder('utf-8').decode(u8); }
    function b64ToU8(b64) {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }
    function streamThrough(u8, transform) {
        return new Response(new Blob([u8]).stream().pipeThrough(transform))
            .arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }
    function gzip(u8) {
        if (typeof CompressionStream === 'undefined')
            return Promise.reject(new Error('This browser cannot create .adg files (CompressionStream unsupported). Try Chrome, Edge or a recent Safari/Firefox.'));
        return streamThrough(u8, new CompressionStream('gzip'));
    }
    function gunzip(u8) {
        if (typeof DecompressionStream === 'undefined')
            return Promise.reject(new Error('This browser cannot read the rack template (DecompressionStream unsupported).'));
        return streamThrough(u8, new DecompressionStream('gzip'));
    }

    var _rackTemplate = null;
    function getRackTemplate() {
        if (_rackTemplate) return Promise.resolve(_rackTemplate);
        if (!window.ABLETON_RACK_TEMPLATE_GZ_B64)
            return Promise.reject(new Error('Ableton rack template is not loaded.'));
        return gunzip(b64ToU8(window.ABLETON_RACK_TEMPLATE_GZ_B64)).then(function (u8) {
            _rackTemplate = u8ToStr(u8);
            return _rackTemplate;
        });
    }

    // Clone one branch template, retargeting name, wav sample refs, and Volume macro AutomationTarget.
    function buildRackBranch(tpl, id, displayName, relFile, size) {
        var b = tpl.replace(/^<AudioEffectBranchPreset Id="\d+">/,
            '<AudioEffectBranchPreset Id="' + id + '">');
        b = b.replace(/(<UserName Value=")ORIGIN(" \/>)/, '$1' + escXml(displayName) + '$2');
        b = b.replace(/<FileRef>([\s\S]*?)<\/FileRef>/g, function (full, inner) {
            if (!/\.wav"/.test(inner)) return full; // keep the device/pack reference
            var nn = inner
                .replace(/<RelativePathType Value="\d+" \/>/, '<RelativePathType Value="3" />')
                .replace(/<RelativePath Value="[^"]*" \/>/, '<RelativePath Value="Samples/' + escXml(relFile) + '" />')
                .replace(/<Path Value="[^"]*" \/>/, '<Path Value="" />')
                .replace(/<OriginalFileSize Value="[^"]*" \/>/, '<OriginalFileSize Value="' + size + '" />')
                .replace(/<OriginalCrc Value="[^"]*" \/>/, '<OriginalCrc Value="0" />');
            return '<FileRef>' + nn + '</FileRef>';
        });
        return b;
    }

    // branches: [{ name, file, size }] -> Promise<Uint8Array> (gzipped .adg)
    function buildAbletonAdg(rackName, branches) {
        return getRackTemplate().then(function (xml) {
            var openTag = '<BranchPresets>';
            var iOpen = xml.indexOf(openTag) + openTag.length;
            var iClose = xml.indexOf('</BranchPresets>');
            var head = xml.slice(0, iOpen);
            var tail = xml.slice(iClose);
            var region = xml.slice(iOpen, iClose);
            var tpl = region.match(/<AudioEffectBranchPreset [\s\S]*?<\/AudioEffectBranchPreset>/)[0];

            head = head.replace(/(<UserName Value=")JazzChorusAmp Convolution - Steinbach(" \/>)/,
                '$1' + escXml(rackName) + '$2');
            // Hide macro area; user sets up their own mappings in Live.
            head = head.replace(/<NumVisibleMacroControls Value="\d+" \/>/,
                '<NumVisibleMacroControls Value="0" />');
            var body = branches.map(function (b, i) {
                return buildRackBranch(tpl, i, b.name, b.file, b.size);
            }).join('');
            return gzip(strToU8(head + body + tail));
        });
    }

    var yield_ = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

    /* ============================================================
       Waveform rendering
       ============================================================ */
    /* Pull a colour from the stylesheet so the waveform follows the design tokens
   instead of a literal from the previous palette. */
    function irColour(token, fallback) {
        var value = getComputedStyle(document.documentElement)
            .getPropertyValue(token).trim();
        return value || fallback;
    }

    function drawWave(canvas, data) {
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var w = Math.max(100, Math.floor(rect.width));
        var h = Math.max(40, Math.floor(rect.height));
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        var mid = h / 2;
        ctx.strokeStyle = irColour('--accent', 'rgba(233,69,96,0.75)');
        ctx.lineWidth = 1;
        ctx.beginPath();
        var step = Math.max(1, Math.floor(data.length / w));
        for (var x = 0; x < w; x++) {
            var start = x * step;
            var min = 1, max = -1;
            for (var i = 0; i < step; i++) {
                var s = data[start + i] || 0;
                if (s < min) min = s;
                if (s > max) max = s;
            }
            ctx.moveTo(x + 0.5, mid - max * mid * 0.95);
            ctx.lineTo(x + 0.5, mid - min * mid * 0.95);
        }
        ctx.stroke();
        ctx.strokeStyle = irColour('--wave-placeholder', 'rgba(255,255,255,0.12)');
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.stroke();
    }

    /* ============================================================
       State
       ============================================================ */
    var reference = null; // { arrayBuffer, preview, name, duration, sr, trimStart, trimEnd }
    var mics = [];        // { id, name, arrayBuffer, preview, duration, sr, start }
    var micCounter = 0;

    /* ============================================================
       UI wiring
       ============================================================ */
    document.addEventListener('DOMContentLoaded', function () {
        var previewCtx = null;
        function getPreviewCtx() {
            if (!previewCtx) {
                var C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                previewCtx = new C(1, 1, 48000);
            }
            return previewCtx;
        }

        /* ---------- Reference sweep ---------- */
        var refDrop = document.getElementById('reference-drop');
        var refInput = document.getElementById('reference-input');
        var refEmpty = document.getElementById('reference-empty');
        var refLoaded = document.getElementById('reference-loaded');
        var refName = document.getElementById('reference-name');
        var refInfo = document.getElementById('reference-info');
        var refClear = document.getElementById('reference-clear');
        var refWaveBlock = document.getElementById('reference-waveform-block');
        var refCanvas = document.getElementById('reference-canvas');
        var refShadeL = document.getElementById('reference-shade-left');
        var refShadeR = document.getElementById('reference-shade-right');
        var refHandleS = document.getElementById('reference-trim-start');
        var refHandleE = document.getElementById('reference-trim-end');

        refDrop.addEventListener('click', function (e) {
            if (e.target.closest('.ir-file-clear') || e.target.closest('.ir-waveform')) return;
            refInput.click();
        });
        refDrop.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refInput.click(); }
        });
        refInput.addEventListener('change', function () {
            if (refInput.files[0]) loadReference(refInput.files[0]);
        });
        setupDnd(refDrop, function (file) { loadReference(file); });
        refClear.addEventListener('click', function () {
            reference = null;
            refEmpty.hidden = false;
            refLoaded.hidden = true;
            refWaveBlock.hidden = true;
            refInput.value = '';
        });

        function loadReference(file) {
            var reader = new FileReader();
            reader.onload = function () {
                var ab = reader.result;
                decodeToMono(ab, 48000).then(function (res) {
                    var wavSr = readWavSampleRate(ab);
                    reference = {
                        arrayBuffer: ab,
                        preview: res.data,
                        name: file.name,
                        duration: res.data.length / res.sampleRate,
                        sr: wavSr || res.sampleRate,
                        trimStart: 0,
                        trimEnd: 1
                    };
                    refName.textContent = file.name;
                    refInfo.textContent = formatInfo(reference.duration, reference.sr);
                    refEmpty.hidden = true;
                    refLoaded.hidden = false;
                    refWaveBlock.hidden = false;
                    drawWave(refCanvas, reference.preview);
                    updateRefTrimUI();
                }).catch(function (err) {
                    alert('Could not decode "' + file.name + '". ' + (err.message || ''));
                });
            };
            reader.readAsArrayBuffer(file);
        }

        function updateRefTrimUI() {
            refHandleS.style.left = (reference.trimStart * 100) + '%';
            refHandleE.style.left = (reference.trimEnd * 100) + '%';
            refShadeL.style.width = (reference.trimStart * 100) + '%';
            refShadeR.style.left = (reference.trimEnd * 100) + '%';
            refShadeR.style.width = ((1 - reference.trimEnd) * 100) + '%';
        }

        var snapChk = document.getElementById('opt-snap');

        // Copy the reference start point (absolute time) onto every loaded mic track.
        function propagateStartToMics() {
            if (!reference) return;
            var startTime = reference.trimStart * reference.duration;
            mics.forEach(function (m) {
                if (!m.preview || !m.duration) return;
                m.start = Math.min(1, Math.max(0, startTime / m.duration));
                if (m.startHandle) m.startHandle.style.left = (m.start * 100) + '%';
            });
        }

        makeDraggable(refHandleS, refCanvas.parentElement, function (pos) {
            if (!reference) return;
            if (snapChk.checked && reference.preview) {
                var approx = Math.round(pos * reference.preview.length);
                var radius = Math.round(48000 * 0.15);   // snap in from ~150 ms away
                var idx = findNearestTransient(reference.preview, 48000, approx, radius);
                pos = idx / reference.preview.length;
            }
            reference.trimStart = Math.max(0, Math.min(pos, reference.trimEnd - 0.02));
            updateRefTrimUI();
        }, function () {
            propagateStartToMics();
        });
        makeDraggable(refHandleE, refCanvas.parentElement, function (pos) {
            if (!reference) return;
            reference.trimEnd = Math.max(pos, reference.trimStart + 0.02);
            reference.trimEnd = Math.min(1, reference.trimEnd);
            updateRefTrimUI();
        });

        /* ---------- Microphones ---------- */
        var micList = document.getElementById('mic-list');
        var addMicBtn = document.getElementById('add-mic');
        var uploadAllBtn = document.getElementById('upload-all');
        var uploadAllInput = document.getElementById('upload-all-input');
        var optAlign = document.getElementById('opt-align');

        addMicBtn.addEventListener('click', function () {
            if (mics.length >= MAX_MICS) return;
            addMic();
        });

        uploadAllBtn.addEventListener('click', function () { uploadAllInput.click(); });
        uploadAllInput.addEventListener('change', function () {
            var files = Array.prototype.slice.call(uploadAllInput.files);
            uploadAllInput.value = '';
            files.forEach(function (file) {
                var slot = mics.find(function (m) { return !m.arrayBuffer && !m._pending; });
                if (!slot) {
                    if (mics.length >= MAX_MICS) return;
                    addMic();
                    slot = mics[mics.length - 1];
                }
                slot._pending = true;
                loadMicFile(slot, file);
            });
            updateAddBtn();
        });

        function addMic() {
            micCounter++;
            var mic = {
                id: micCounter,
                name: 'Mic ' + (mics.length + 1),
                arrayBuffer: null, preview: null, duration: 0, sr: 0, start: 0
            };
            mics.push(mic);
            renderMicRow(mic);
            updateAddBtn();
        }

        function updateAddBtn() {
            addMicBtn.disabled = mics.length >= MAX_MICS;
            addMicBtn.textContent = mics.length >= MAX_MICS
                ? 'Maximum of ' + MAX_MICS + ' microphones'
                : '+ Add microphone';
        }

        function renderMicRow(mic) {
            var row = document.createElement('div');
            row.className = 'ir-mic-row';
            row.dataset.id = mic.id;
            row.innerHTML =
                '<div class="ir-mic-index">' + mics.length + '</div>' +
                '<div class="ir-mic-body">' +
                    '<div class="ir-mic-top">' +
                        '<input type="text" class="ir-mic-name" value="' + escapeAttr(mic.name) + '" placeholder="Microphone name" aria-label="Microphone name">' +
                        '<button type="button" class="ir-mic-link-btn" hidden></button>' +
                        '<button type="button" class="ir-mic-file-btn">Load recording</button>' +
                        '<span class="ir-mic-info"></span>' +
                        '<button type="button" class="ir-mic-remove" aria-label="Remove microphone">&times;</button>' +
                        '<input type="file" class="ir-mic-input" accept="audio/*,.wav,.aiff,.aif,.flac" hidden>' +
                    '</div>' +
                    '<div class="ir-mic-wave" hidden>' +
                        '<canvas class="ir-wave-canvas ir-mic-canvas"></canvas>' +
                        '<div class="ir-trim-handle ir-mic-start-handle" title="Sweep start" hidden></div>' +
                    '</div>' +
                '</div>';
            micList.appendChild(row);

            var nameInput = row.querySelector('.ir-mic-name');
            var fileBtn = row.querySelector('.ir-mic-file-btn');
            var fileInput = row.querySelector('.ir-mic-input');
            var info = row.querySelector('.ir-mic-info');
            var removeBtn = row.querySelector('.ir-mic-remove');
            var waveWrap = row.querySelector('.ir-mic-wave');
            var canvas = row.querySelector('.ir-mic-canvas');
            var startHandle = row.querySelector('.ir-mic-start-handle');
            var linkBtn = row.querySelector('.ir-mic-link-btn');
            mic.startHandle = startHandle;
            mic.linkBtn = linkBtn;
            mic.els = { nameInput: nameInput, info: info, waveWrap: waveWrap, canvas: canvas, startHandle: startHandle };

            nameInput.addEventListener('input', function () { mic.name = nameInput.value; updatePairing(); });
            fileBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                if (fileInput.files[0]) loadMicFile(mic, fileInput.files[0]);
            });
            setupDnd(row, function (file) { loadMicFile(mic, file); });
            linkBtn.addEventListener('click', function () {
                mic.pairUnbound = !mic.pairUnbound;
                if (mic.partner) mic.partner.pairUnbound = mic.pairUnbound;
                updatePairing();
            });
            removeBtn.addEventListener('click', function () {
                var idx = mics.indexOf(mic);
                if (idx >= 0) mics.splice(idx, 1);
                micList.removeChild(row);
                reindexMics();
                updateAddBtn();
                updatePairing();
            });

            makeDraggable(startHandle, canvas.parentElement, function (pos) {
                mic.start = pos;
                startHandle.style.left = (pos * 100) + '%';
            });
        }

        // Detect L/R pairs among loaded mics and show the link/unlink button on both rows.
        function updatePairing() {
            var groups = {};
            mics.forEach(function (m) {
                var info = pairInfo(m.name);
                m._pi = info;
                if (!info) return;
                if (!groups[info.key]) groups[info.key] = {};
                var g = groups[info.key];
                if (!g[info.side]) g[info.side] = m;
            });
            mics.forEach(function (m) {
                var info = m._pi;
                var partner = null;
                if (info) {
                    var g = groups[info.key];
                    if (g && g.L && g.R && g.L !== g.R && g[info.side] === m) {
                        partner = info.side === 'L' ? g.R : g.L;
                    }
                }
                m.partner = partner;
                if (m.linkBtn) {
                    if (partner) {
                        m.linkBtn.hidden = false;
                        m.linkBtn.textContent = m.pairUnbound ? 'Link L/R' : 'Unlink';
                        m.linkBtn.classList.toggle('is-unlinked', !!m.pairUnbound);
                    } else {
                        m.linkBtn.hidden = true;
                        m.pairUnbound = false;
                    }
                }
                delete m._pi;
            });
        }

        function loadMicFile(mic, file) {
            var els = mic.els;
            els.info.textContent = 'Decoding...';
            var reader = new FileReader();
            reader.onload = function () {
                var ab = reader.result;
                decodeToMono(ab, 48000).then(function (res) {
                    var wavSr = readWavSampleRate(ab);
                    mic.arrayBuffer = ab;
                    mic.preview = res.data;
                    mic.duration = res.data.length / res.sampleRate;
                    mic.sr = wavSr || res.sampleRate;
                    mic.fileName = file.name;
                    mic._pending = false;
                    mic.name = micNameFromFilename(file.name);
                    els.nameInput.value = mic.name;
                    els.info.textContent = formatInfo(mic.duration, mic.sr);
                    els.waveWrap.hidden = false;
                    drawWave(els.canvas, mic.preview);
                    if (reference) {
                        mic.start = Math.min(1, Math.max(0,
                            (reference.trimStart * reference.duration) / mic.duration));
                    }
                    els.startHandle.hidden = optAlign.checked;
                    els.startHandle.style.left = (mic.start * 100) + '%';
                    updatePairing();
                }).catch(function (err) {
                    mic._pending = false;
                    els.info.textContent = 'Decode failed';
                    alert('Could not decode "' + file.name + '". ' + (err.message || ''));
                });
            };
            reader.readAsArrayBuffer(file);
        }

        function reindexMics() {
            var rows = micList.querySelectorAll('.ir-mic-row');
            rows.forEach(function (row, i) {
                row.querySelector('.ir-mic-index').textContent = i + 1;
            });
        }

        optAlign.addEventListener('change', function () {
            micList.querySelectorAll('.ir-mic-row').forEach(function (row) {
                var mic = mics.find(function (m) { return String(m.id) === row.dataset.id; });
                var h = row.querySelector('.ir-mic-start-handle');
                if (mic && mic.preview) h.hidden = optAlign.checked;
            });
        });

        // start with two mic rows
        addMic();
        addMic();

        /* ---------- Processing ---------- */
        var processBtn = document.getElementById('process-btn');
        var progressBlock = document.getElementById('progress-block');
        var progressBar = document.getElementById('progress-bar');
        var progressLabel = document.getElementById('progress-label');
        var progressPct = document.getElementById('progress-pct');
        var progressLog = document.getElementById('progress-log');
        var resultsBlock = document.getElementById('results-block');
        var resultsList = document.getElementById('results-list');

        function setProgress(pct, label) {
            progressBar.style.width = pct + '%';
            progressPct.textContent = Math.round(pct) + '%';
            if (label) progressLabel.textContent = label;
        }
        function log(msg) {
            var li = document.createElement('li');
            li.textContent = msg;
            progressLog.appendChild(li);
            progressLog.scrollTop = progressLog.scrollHeight;
        }

        processBtn.addEventListener('click', function () { runProcess(); });

        function runProcess() {
            if (!reference) { alert('Load a reference sweep first.'); return; }
            var ready = mics.filter(function (m) { return m.arrayBuffer; });
            if (!ready.length) { alert('Load at least one microphone recording.'); return; }

            var sampleRate = parseInt(document.getElementById('opt-samplerate').value, 10);
            var bitMode = document.getElementById('opt-bitdepth').value;
            var format = document.getElementById('opt-format').value;
            var irMode = document.getElementById('opt-irlength').value;
            var doAlign = optAlign.checked;
            var doDenoise = document.getElementById('opt-denoise').checked;
            var doNorm = document.getElementById('opt-normalize').checked;
            var doMonoLow = document.getElementById('opt-monolow').checked;
            var rackName = document.getElementById('opt-rackname').value;

            processBtn.disabled = true;
            progressBlock.hidden = false;
            resultsBlock.hidden = true;
            resultsList.innerHTML = '';
            progressLog.innerHTML = '';
            setProgress(0, 'Preparing...');

            processAsync(ready, {
                sampleRate: sampleRate, bitMode: bitMode, format: format,
                irMode: irMode, irLength: 1, doAlign: doAlign, doDenoise: doDenoise,
                doNorm: doNorm, doMonoLow: doMonoLow, rackName: rackName
            }).then(function () {
                processBtn.disabled = false;
            }).catch(function (err) {
                log('Error: ' + (err.message || err));
                processBtn.disabled = false;
            });
        }

        function processAsync(ready, o) {
            var results = [];
            var refFull = null, refTrim = null;

            return yield_().then(function () {
                setProgress(3, 'Decoding reference sweep at ' + (o.sampleRate / 1000) + ' kHz...');
                return decodeToMono(reference.arrayBuffer, o.sampleRate);
            }).then(function (res) {
                refFull = res.data;
                var s = Math.floor(reference.trimStart * refFull.length);
                var e = Math.floor(reference.trimEnd * refFull.length);
                refTrim = refFull.subarray(s, e);
                o.irLength = o.irMode === 'full'
                    ? refTrim.length / o.sampleRate
                    : parseFloat(o.irMode);
                log('Reference: ' + refTrim.length + ' samples used, IR length ' +
                    o.irLength.toFixed(2) + ' s.');

                var chain = Promise.resolve();
                ready.forEach(function (mic, i) {
                    chain = chain.then(function () {
                        return processMic(mic, i, ready.length, refTrim, o).then(function (ir) {
                            results.push({ name: sanitize(mic.name || ('Mic_' + (i + 1))), ir: ir, mic: mic });
                        });
                    });
                });
                return chain;
            }).then(function () {
                setProgress(94, 'Encoding output...');
                return yield_();
            }).then(function () {
                return finishExport(results, o);
            }).then(function () {
                setProgress(100, 'Complete');
                resultsBlock.hidden = false;
            });
        }

        function processMic(mic, i, total, refTrim, o) {
            var base = 8 + (i / total) * 84;
            var span = 84 / total;
            return yield_().then(function () {
                setProgress(base, 'Mic ' + (i + 1) + '/' + total + ': decoding...');
                return decodeToMono(mic.arrayBuffer, o.sampleRate);
            }).then(function (res) {
                var sig = res.data;
                return yield_().then(function () {
                    var startSample;
                    if (o.doAlign) {
                        setProgress(base + span * 0.15, 'Mic ' + (i + 1) + ': checking phase and aligning...');
                        var d = findDelay(refTrim, sig);
                        startSample = Math.max(0, d.lag);
                        if (d.sign < 0) {
                            for (var p = 0; p < sig.length; p++) sig[p] = -sig[p];
                            log('Mic ' + (i + 1) + ': polarity inverted for mono compatibility.');
                        }
                        log('Mic ' + (i + 1) + ' (' + (mic.name || '') + '): aligned at ' +
                            (startSample / o.sampleRate).toFixed(3) + ' s.');
                    } else {
                        startSample = Math.floor(mic.start * sig.length);
                        log('Mic ' + (i + 1) + ': manual start at ' + (startSample / o.sampleRate).toFixed(3) + ' s.');
                    }
                    var aligned = startSample > 0 ? sig.subarray(startSample) : sig;
                    return yield_().then(function () { return aligned; });
                }).then(function (aligned) {
                    if (!o.doDenoise) return aligned;
                    setProgress(base + span * 0.35, 'Mic ' + (i + 1) + ': removing hum & room noise...');
                    return yield_().then(function () {
                        var clean = denoise(aligned, o.sampleRate);
                        log('Mic ' + (i + 1) + ': noise reduction applied.');
                        return clean;
                    });
                }).then(function (proc) {
                    setProgress(base + span * 0.7, 'Mic ' + (i + 1) + ': deconvolving...');
                    return yield_().then(function () {
                        var ir = deconvolve(refTrim, proc, o.sampleRate, {
                            irLength: o.irLength, f1: 20, f2: 20000
                        });
                        if (o.doNorm) peakNormalize(ir, -1);
                        log('Mic ' + (i + 1) + ': IR ready (' + (ir.length / o.sampleRate).toFixed(2) + ' s).');
                        return ir;
                    });
                });
            });
        }

        function padTo(arr, len) {
            if (arr.length === len) return arr;
            var p = new Float32Array(len);
            p.set(arr.subarray(0, Math.min(arr.length, len)));
            return p;
        }

        // Group L/R pairs into stereo outputs, apply mono-low if requested.
        function buildOutputs(results, o) {
            var groups = {};
            results.forEach(function (r, idx) {
                var info = pairInfo(r.name);
                r._info = info;
                if (info && !(r.mic && r.mic.pairUnbound)) {
                    if (!groups[info.key]) groups[info.key] = {};
                    var g = groups[info.key];
                    if (g[info.side] == null) g[info.side] = idx;
                }
            });
            var paired = {};
            Object.keys(groups).forEach(function (key) {
                var g = groups[key];
                if (g.L != null && g.R != null) { paired[g.L] = true; paired[g.R] = true; }
            });
            var outputs = [];
            results.forEach(function (r, idx) {
                if (paired[idx]) return;
                outputs.push({ name: r.name, channels: [r.ir], order: idx });
            });
            Object.keys(groups).forEach(function (key) {
                var g = groups[key];
                if (g.L == null || g.R == null) return;
                var L = results[g.L].ir, R = results[g.R].ir;
                var base = results[g.L]._info.base;
                if (o.doMonoLow) {
                    var mono = monoLowCrossover(L, R, o.sampleRate, 80);
                    L = mono[0]; R = mono[1];
                    log('Stereo pair "' + base + '": grouped, mono below 80 Hz applied.');
                } else {
                    log('Stereo pair "' + base + '": grouped as stereo WAV.');
                }
                var len = Math.max(L.length, R.length);
                outputs.push({ name: base, channels: [padTo(L, len), padTo(R, len)], order: Math.min(g.L, g.R) });
            });
            outputs.sort(function (a, b) { return a.order - b.order; });
            return outputs;
        }

        function sizeFromRt(rt) { return Math.min(100, Math.max(10, Math.round(rt * 22))); }

        function generateReport(results, o) {
            var lines = [];
            lines.push('IR Maker reverb analysis');
            lines.push('Generated ' + new Date().toISOString());
            lines.push('Working sample rate: ' + o.sampleRate + ' Hz');
            lines.push('');
            lines.push('Measured decay values plus approximate starting points for algorithmic');
            lines.push('reverbs such as Valhalla VintageVerb and ValhallaRoom. Load the exported');
            lines.push('WAV in a convolution reverb for the exact space; use the numbers below to');
            lines.push('dial in a matching algorithmic reverb. Values are a starting point, trust');
            lines.push('your ears.');
            lines.push('');
            results.forEach(function (r, idx) {
                var rt60 = measureRT60(r.ir, o.sampleRate);
                lines.push('=== ' + (r.name || ('Mic ' + (idx + 1))) + ' ===');
                lines.push('  Measured RT60 : ' + rt60.toFixed(2) + ' s');
                lines.push('  IR length     : ' + (r.ir.length / o.sampleRate).toFixed(2) + ' s');
                lines.push('  VintageVerb   : Decay ' + rt60.toFixed(2) + ' s, Size ' + sizeFromRt(rt60) + ', Mix 100% (aux)');
                lines.push('  ValhallaRoom  : Decay ' + rt60.toFixed(2) + ' s, Size ' + sizeFromRt(rt60));
                lines.push('');
            });
            return lines.join('\n');
        }

        function finishExport(results, o) {
            var outputs = buildOutputs(results, o);
            var done = Promise.resolve();
            if (o.format === 'multi') {
                var allCh = [];
                outputs.forEach(function (out) { out.channels.forEach(function (c) { allCh.push(c); }); });
                var maxLen = allCh.reduce(function (a, c) { return Math.max(a, c.length); }, 0);
                var channels = allCh.map(function (c) { return padTo(c, maxLen); });
                var wav = encodeWav(channels, o.sampleRate, o.bitMode);
                var blob = new Blob([wav], { type: 'audio/wav' });
                addResult('impulse-responses-multitrack.wav', blob,
                    channels.length + ' channels, ' + (maxLen / o.sampleRate).toFixed(2) + ' s');
            } else if (o.format === 'ableton') {
                done = exportAbletonRack(outputs, o);
            } else {
                var files = [];
                var used = {};
                outputs.forEach(function (out) {
                    var name = out.name;
                    if (used[name]) { used[name]++; name = name + '_' + used[name]; }
                    else used[name] = 1;
                    var wav = encodeWav(out.channels, o.sampleRate, o.bitMode);
                    files.push({ name: name + '.wav', data: new Uint8Array(wav) });
                });
                var zip = buildZip(files);
                addResult('impulse-responses.zip', zip, files.length + ' WAV files');
            }

            return done.then(function () {
                var report = generateReport(results, o);
                var rblob = new Blob([report], { type: 'text/plain' });
                addResult('valhalla-reverb-suggestions.txt', rblob, 'RT60 analysis and reverb starting points', false);
            });
        }

        // Build a Convolution Reverb Pro rack: one chain per IR + a Samples folder.
        function exportAbletonRack(outputs, o) {
            var base = (o.rackName || '').trim();
            var rackTitle = base ? base + ' Convolution' : 'IR Convolution Rack';
            var folder = safeName(rackTitle);
            var prefix = base ? safeName(base) + '_' : '';
            var files = [];
            var used = {};
            var branches = [];
            outputs.forEach(function (out) {
                var mic = sanitize(out.name);
                var fileBase = prefix + mic;
                if (used[fileBase]) { used[fileBase]++; fileBase = fileBase + '_' + used[fileBase]; }
                else used[fileBase] = 1;
                var wav = new Uint8Array(encodeWav(out.channels, o.sampleRate, o.bitMode));
                files.push({ name: folder + '/Samples/' + fileBase + '.wav', data: wav });
                branches.push({ name: out.name, file: fileBase + '.wav', size: wav.length });
            });
            log('Building Ableton rack "' + rackTitle + '" with ' + branches.length + ' convolution chains...');
            return buildAbletonAdg(rackTitle, branches).then(function (adgBytes) {
                files.unshift({ name: folder + '/' + folder + '.adg', data: adgBytes });
                var zip = buildZip(files);
                addResult(folder + '.zip', zip,
                    branches.length + ' chain rack, needs Convolution Reverb Pro');
                log('Ableton rack ready. Unzip and drop the .adg into Live (Convolution Reverb Pro pack required).');
            });
        }

        function addResult(filename, blob, meta, auto) {
            var item = document.createElement('div');
            item.className = 'ir-result-item';
            var info = document.createElement('div');
            info.className = 'ir-result-meta';
            info.innerHTML = '<span class="ir-result-name">' + filename + '</span>' +
                '<span class="ir-result-sub">' + meta + ', ' + formatBytes(blob.size) + '</span>';
            var btn = document.createElement('button');
            btn.className = 'btn ir-result-download';
            btn.textContent = 'Download';
            btn.addEventListener('click', function () { download(blob, filename); });
            item.appendChild(info);
            item.appendChild(btn);
            resultsList.appendChild(item);
            if (auto !== false) download(blob, filename);
        }

        /* ---------- Sweep generator ---------- */
        var genBtn = document.getElementById('generate-sweep-btn');
        var previewBtn = document.getElementById('preview-sweep-btn');
        var playCtx = null, playSource = null;

        genBtn.addEventListener('click', function () {
            var dur = parseFloat(document.getElementById('gen-duration').value);
            var sr = parseInt(document.getElementById('gen-samplerate').value, 10);
            var f1 = parseFloat(document.getElementById('gen-fstart').value);
            var f2 = parseFloat(document.getElementById('gen-fend').value);
            var mode = document.getElementById('gen-bitdepth').value;
            if (f2 > sr / 2) f2 = Math.floor(sr / 2);
            var sweep = generateSweep(dur, sr, f1, f2);
            var wav = encodeWav([sweep], sr, mode);
            var blob = new Blob([wav], { type: 'audio/wav' });
            var fname = 'sweep_' + dur + 's_' + f1 + '-' + f2 + 'Hz_' + (sr / 1000) + 'kHz.wav';
            download(blob, fname);
        });

        previewBtn.addEventListener('click', function () {
            if (playSource) { try { playSource.stop(); } catch (e) {} playSource = null; previewBtn.textContent = 'Preview'; return; }
            var sr = parseInt(document.getElementById('gen-samplerate').value, 10);
            var f1 = parseFloat(document.getElementById('gen-fstart').value);
            var f2 = parseFloat(document.getElementById('gen-fend').value);
            var dur = Math.min(6, parseFloat(document.getElementById('gen-duration').value));
            if (f2 > sr / 2) f2 = Math.floor(sr / 2);
            var C = window.AudioContext || window.webkitAudioContext;
            if (!playCtx) playCtx = new C();
            var sweep = generateSweep(dur, playCtx.sampleRate, f1, f2);
            var buf = playCtx.createBuffer(1, sweep.length, playCtx.sampleRate);
            buf.copyToChannel(sweep, 0);
            playSource = playCtx.createBufferSource();
            playSource.buffer = buf;
            playSource.connect(playCtx.destination);
            playSource.onended = function () { playSource = null; previewBtn.textContent = 'Preview'; };
            playSource.start();
            previewBtn.textContent = 'Stop preview';
        });

        /* ---------- shared helpers ---------- */
        function setupDnd(el, onFile) {
            el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('ir-dragover'); });
            el.addEventListener('dragleave', function () { el.classList.remove('ir-dragover'); });
            el.addEventListener('drop', function (e) {
                e.preventDefault();
                el.classList.remove('ir-dragover');
                if (e.dataTransfer.files && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
            });
        }
    });

    function makeDraggable(handle, track, onMove, onEnd) {
        function pointer(e) {
            var rect = track.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var pos = (clientX - rect.left) / rect.width;
            return Math.min(1, Math.max(0, pos));
        }
        function down(e) {
            e.preventDefault();
            var last = pointer(e);
            function move(ev) { last = pointer(ev); onMove(last); }
            function up() {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.removeEventListener('touchmove', move);
                document.removeEventListener('touchend', up);
                if (onEnd) onEnd(last);
            }
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
        }
        handle.addEventListener('mousedown', down);
        handle.addEventListener('touchstart', down, { passive: false });
    }

    function formatInfo(duration, sr) {
        var d = duration >= 1 ? duration.toFixed(2) + ' s' : Math.round(duration * 1000) + ' ms';
        return d + (sr ? ' · ' + (sr / 1000) + ' kHz' : '');
    }
    function formatBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }
    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
})();
