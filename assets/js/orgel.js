/**
 * Orgel – Historic Organ Audio Engine
 *
 * All 17 samples start SIMULTANEOUSLY on Play (same audioCtx timestamp).
 * Each stop has its own GainNode: gain=1 (active) or gain=0 (muted).
 * Pulling/pushing a stop just cross-fades its gain – no restart needed.
 *
 * Sprite: 43×330 px, 6 frames à 55 px.
 *   Frame 0 (off) = background-position-y: 0
 *   Frame 5 (on)  = background-position-y: -275px
 */

(function () {
    'use strict';

    const AUDIO_BASE    = 'assets/audio/ORGEL/';
    const START_AHEAD_S = 0.06;   // schedule this far in the future so all sources start together
    const KNOB_FRAME_H  = 55;     // px per sprite frame
    const FRAME_ON      = 5;
    const FRAME_OFF     = 0;
    const GAIN_FADE_S   = 0.04;   // smooth gain ramp duration

    // ── Web Audio ──────────────────────────────────────────────────────────
    var audioCtx   = null;
    var masterGain = null;
    var stopGains  = {};  // file → GainNode
    var sources    = {};  // file → AudioBufferSourceNode (running while isPlaying)
    var buffers    = {};  // file → AudioBuffer
    var isPlaying  = false;

    function ensureCtx() {
        if (!audioCtx) {
            audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = getVolume();
            masterGain.connect(audioCtx.destination);
        }
        return audioCtx;
    }

    function getVolume() {
        var s = document.getElementById('organ-volume');
        return s ? parseInt(s.value, 10) / 100 : 0.8;
    }

    // ── Preload all samples ────────────────────────────────────────────────
    var allFiles   = [];
    var loadedCount = 0;

    function loadAll() {
        document.querySelectorAll('.organ-stop-btn').forEach(function (btn) {
            var f = btn.dataset.file;
            if (f && allFiles.indexOf(f) === -1) allFiles.push(f);
        });

        var ctx = ensureCtx();  // create early for decodeAudioData

        allFiles.forEach(function (file) {
            fetch(AUDIO_BASE + file + '.mp3')
                .then(function (res) { return res.arrayBuffer(); })
                .then(function (ab)  { return ctx.decodeAudioData(ab); })
                .then(function (buf) {
                    buffers[file] = buf;
                    tickLoad();
                })
                .catch(function (err) {
                    console.warn('[Orgel] load failed:', file, err);
                    tickLoad();
                });
        });
    }

    function tickLoad() {
        loadedCount++;
        var pct = loadedCount / allFiles.length * 100;
        var fill = document.getElementById('organ-loading-fill');
        if (fill) fill.style.width = pct + '%';
        if (loadedCount >= allFiles.length) onAllLoaded();
    }

    function onAllLoaded() {
        var btn  = document.getElementById('organ-play-btn');
        var icon = document.getElementById('organ-play-icon');
        var lbl  = document.getElementById('organ-play-label');
        if (btn)  btn.disabled = false;
        if (icon) icon.textContent = '▶';
        if (lbl)  lbl.textContent  = 'Play';
        // Hide loading bar
        var bar = document.getElementById('organ-loading-fill');
        if (bar) { bar.style.opacity = '0'; }
        updateStatus();
    }

    // ── Responsive canvas scaler ───────────────────────────────────────────
    function scaleCanvas() {
        var scaler = document.getElementById('organ-canvas-scaler');
        var canvas = document.getElementById('organ-canvas');
        if (!scaler || !canvas) return;
        var rect  = scaler.getBoundingClientRect();
        var avail = rect.width;
        if (avail < 10) avail = scaler.parentElement
            ? scaler.parentElement.clientWidth - 32
            : 800;
        var scale = Math.min(1, avail / 1000);
        canvas.style.transform = 'scale(' + scale + ')';
        scaler.style.height    = Math.round(566 * scale) + 'px';
    }

    // ── Sprite frame helper ────────────────────────────────────────────────
    function setFrame(btn, frame) {
        btn.style.backgroundPositionY = -(frame * KNOB_FRAME_H) + 'px';
    }

    // ── Toggle a stop ──────────────────────────────────────────────────────
    function toggleStop(btn) {
        var isNowActive = btn.classList.toggle('active');
        btn.setAttribute('aria-pressed', String(isNowActive));
        setFrame(btn, isNowActive ? FRAME_ON : FRAME_OFF);

        // If playing, just ramp the per-stop gain
        var file = btn.dataset.file;
        if (isPlaying && stopGains[file]) {
            var ctx = ensureCtx();
            var targetGain = isNowActive ? 1 : 0;
            stopGains[file].gain.setTargetAtTime(targetGain, ctx.currentTime, GAIN_FADE_S);
        }

        updateStatus();
    }

    // ── Playback: start ALL samples simultaneously ─────────────────────────
    function startPlayback() {
        var ctx = ensureCtx();
        ctx.resume().catch(function () {});

        // Auto-activate Principal 8' if nothing selected
        var activeBtns = document.querySelectorAll('.organ-stop-btn.active');
        if (activeBtns.length === 0) {
            var p = document.querySelector('[data-file="PRINCIPAL8"]');
            if (p) toggleStop(p);
        }

        stopAllSources(); // clean up any leftovers

        var startTime = ctx.currentTime + START_AHEAD_S;

        // Start ALL 17 samples at exactly the same time.
        // Each has its own GainNode: active stops get gain=1, others gain=0.
        allFiles.forEach(function (file) {
            if (!buffers[file]) return;

            var isActive = !!document.querySelector('[data-file="' + file + '"].active');

            // Per-stop gain
            var gain = ctx.createGain();
            gain.gain.value = isActive ? 1 : 0;
            gain.connect(masterGain);
            stopGains[file] = gain;

            // Source
            var src = ctx.createBufferSource();
            src.buffer = buffers[file];
            src.loop   = true;
            src.connect(gain);
            src.start(startTime);
            sources[file] = src;
        });

        isPlaying = true;
        updatePlayBtn();
        updateStatus();
    }

    function stopPlayback() {
        // Ramp master gain to zero first to avoid the click artifact,
        // then stop all sources after the fade completes.
        var ctx  = ensureCtx();
        var now  = ctx.currentTime;
        var FADE = 0.07;  // 70 ms de-click fade

        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value || 0.001, now);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + FADE);

        var savedVol = getVolume();
        setTimeout(function () {
            stopAllSources();
            // Restore gain for next Play press
            var c = ensureCtx();
            masterGain.gain.cancelScheduledValues(c.currentTime);
            masterGain.gain.setValueAtTime(savedVol, c.currentTime);
            isPlaying = false;
            updatePlayBtn();
            updateStatus();
        }, Math.ceil(FADE * 1000) + 30);

        // Update button state immediately so UI feels responsive
        isPlaying = false;
        updatePlayBtn();
        updateStatus();
    }

    function stopAllSources() {
        Object.keys(sources).forEach(function (file) {
            try { sources[file].stop(); }    catch (e) {}
            try { sources[file].disconnect(); } catch (e) {}
        });
        Object.keys(stopGains).forEach(function (file) {
            try { stopGains[file].disconnect(); } catch (e) {}
        });
        sources   = {};
        stopGains = {};
    }

    function updatePlayBtn() {
        var btn  = document.getElementById('organ-play-btn');
        var icon = document.getElementById('organ-play-icon');
        var lbl  = document.getElementById('organ-play-label');
        if (!btn) return;
        if (isPlaying) {
            btn.classList.add('is-playing');
            if (icon) icon.textContent = '⏸';
            if (lbl)  lbl.textContent  = 'Pause';
        } else {
            btn.classList.remove('is-playing');
            if (icon) icon.textContent = '▶';
            if (lbl)  lbl.textContent  = 'Play';
        }
    }

    // ── Status ─────────────────────────────────────────────────────────────
    function updateStatus() {
        var active  = document.querySelectorAll('.organ-stop-btn.active').length;
        var text    = document.getElementById('organ-status-text');
        var counter = document.getElementById('organ-active-count');

        if (counter) counter.textContent = active + ' Register aktiv';
        if (text) {
            if (isPlaying && active > 0) {
                text.textContent = active + ' Stop' + (active !== 1 ? 's' : '') + ' · läuft';
            } else {
                text.textContent = active + ' Stop' + (active !== 1 ? 's' : '') + ' bereit';
            }
        }
    }

    // ── Volume ─────────────────────────────────────────────────────────────
    function setupVolume() {
        var slider = document.getElementById('organ-volume');
        var lbl    = document.getElementById('organ-vol-label');
        if (!slider) return;
        slider.addEventListener('input', function () {
            if (lbl) lbl.textContent = this.value;
            if (masterGain) {
                masterGain.gain.setTargetAtTime(
                    parseInt(this.value, 10) / 100,
                    ensureCtx().currentTime,
                    0.05
                );
            }
        });
    }

    // ── Init ───────────────────────────────────────────────────────────────
    function init() {
        // Give the layout a tick to settle before first scale
        requestAnimationFrame(function () {
            scaleCanvas();
        });
        window.addEventListener('resize', scaleCanvas);

        // Wire stop knobs
        document.querySelectorAll('.organ-stop-btn').forEach(function (btn) {
            setFrame(btn, FRAME_OFF);
            btn.addEventListener('click', function () { toggleStop(btn); });
            btn.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStop(btn); }
            });
        });

        // Play / Pause
        var playBtn = document.getElementById('organ-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                if (isPlaying) { stopPlayback(); } else { startPlayback(); }
            });
        }

        // Scroll to demo from hero CTA
        var tryBtn = document.getElementById('hero-try-btn');
        if (tryBtn) {
            tryBtn.addEventListener('click', function () {
                var demo = document.getElementById('demo');
                if (demo) demo.scrollIntoView({ behavior: 'smooth' });
            });
        }

        // Clear all
        var clearBtn = document.getElementById('organ-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                stopPlayback();
                document.querySelectorAll('.organ-stop-btn.active').forEach(function (btn) {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-pressed', 'false');
                    setFrame(btn, FRAME_OFF);
                });
                updateStatus();
            });
        }

        setupVolume();

        document.addEventListener('visibilitychange', function () {
            if (document.hidden && isPlaying) stopPlayback();
        });
        window.addEventListener('pagehide', function () {
            if (isPlaying) stopPlayback();
        });

        loadAll();
        updateStatus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
