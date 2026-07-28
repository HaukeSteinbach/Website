/**
 * Scores & Sketches archive.
 * - Client-side name + password gate (session-scoped, not a security boundary).
 * - Renders a table of tracks with a simple canvas waveform per row.
 * - Audio is only fetched once "play" is pressed; a loading bar fills the
 *   waveform while the file downloads, then the real waveform peaks are drawn.
 * - Downloading a track fires a Formspree notification with the signed-in
 *   name and the track title.
 */

(function () {
    const SESSION_KEY = 'scoresArchiveSession';
    const ARCHIVE_PASSWORD = 'ScoresArchive';
    const NOTIFY_ENDPOINT = 'https://formspree.io/f/xgopedgb';
    const BAR_COUNT = 72;
    const CANVAS_WIDTH = 300;
    const CANVAS_HEIGHT = 44;

    const TRACKS = [
        {
            title: 'Infinite',
            file: 'assets/audio/ScoresArchive/Infinite.mp3',
            owner: 'Hauke Steinbach',
            email: 'mail@haukesteinbach.de'
        },
        {
            title: 'Steel and Water',
            file: 'assets/audio/ScoresArchive/Steel and Water.mp3',
            owner: 'Hauke Steinbach',
            email: 'mail@haukesteinbach.de'
        },
        {
            title: 'Tears of Past',
            file: 'assets/audio/ScoresArchive/Tears of Past.mp3',
            owner: 'Hauke Steinbach',
            email: 'mail@haukesteinbach.de'
        },
        {
            title: 'Tiny World',
            file: 'assets/audio/ScoresArchive/Tiny World.mp3',
            owner: 'Hauke Steinbach',
            email: 'mail@haukesteinbach.de'
        }
    ];

    let audioContext = null;
    let activeRow = null;

    document.addEventListener('DOMContentLoaded', () => {
        const gateSection = document.getElementById('scores-gate');
        const archiveSection = document.getElementById('scores-archive-content');
        const gateForm = document.getElementById('scores-gate-form');
        const gateStatus = document.getElementById('scores-gate-status');
        const nameInput = document.getElementById('scores-name');
        const passwordInput = document.getElementById('scores-password');
        const signedInName = document.getElementById('scores-signed-in-name');
        const logoutButton = document.getElementById('scores-logout');
        const tableBody = document.getElementById('scores-table-body');

        if (!gateSection || !archiveSection || !gateForm || !tableBody) {
            return;
        }

        renderTrackRows(tableBody);

        const existingSession = readSession();
        if (existingSession) {
            unlockArchive(existingSession.name);
        }

        gateForm.addEventListener('submit', (event) => {
            event.preventDefault();

            const fullName = (nameInput.value || '').trim().replace(/\s+/g, ' ');
            const password = passwordInput.value || '';

            if (!isFullName(fullName)) {
                setGateStatus('error', 'Please enter both your first and last name.');
                return;
            }

            if (password !== ARCHIVE_PASSWORD) {
                setGateStatus('error', 'Incorrect password.');
                return;
            }

            setGateStatus('', '');
            writeSession(fullName);
            unlockArchive(fullName);
        });

        if (logoutButton) {
            logoutButton.addEventListener('click', () => {
                stopActiveRow();
                sessionStorage.removeItem(SESSION_KEY);
                archiveSection.hidden = true;
                gateSection.hidden = false;
                gateForm.reset();
                setGateStatus('', '');
            });
        }

        function unlockArchive(fullName) {
            signedInName.textContent = fullName;
            gateSection.hidden = true;
            archiveSection.hidden = false;
        }

        function setGateStatus(type, message) {
            if (!gateStatus) {
                return;
            }
            gateStatus.textContent = message;
            gateStatus.className = 'form-status' + (type ? ' ' + type : '');
        }

        function isFullName(value) {
            const parts = value.split(' ').filter(Boolean);
            return parts.length >= 2;
        }

        function readSession() {
            try {
                const raw = sessionStorage.getItem(SESSION_KEY);
                if (!raw) {
                    return null;
                }
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.name === 'string' && isFullName(parsed.name)) {
                    return parsed;
                }
            } catch (_error) {
                /* ignore malformed session data */
            }
            return null;
        }

        function writeSession(fullName) {
            try {
                sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name: fullName, ts: Date.now() }));
            } catch (_error) {
                /* sessionStorage unavailable (private mode, etc.) — gate still works for this page view */
            }
        }
    });

    function renderTrackRows(tableBody) {
        TRACKS.forEach((track, index) => {
            const row = buildTrackRow(track, index);
            tableBody.appendChild(row);
        });
    }

    function buildTrackRow(track, index) {
        const tr = document.createElement('tr');
        tr.className = 'scores-row';

        const titleCell = document.createElement('td');
        titleCell.className = 'scores-title-cell';
        titleCell.setAttribute('data-label', 'Title');
        titleCell.textContent = track.title;
        tr.appendChild(titleCell);

        const waveformCell = document.createElement('td');
        waveformCell.className = 'scores-waveform-cell';
        waveformCell.setAttribute('data-label', 'Waveform');
        waveformCell.appendChild(buildWaveform(track));
        tr.appendChild(waveformCell);

        const ownerCell = document.createElement('td');
        ownerCell.className = 'scores-owner-cell';
        ownerCell.setAttribute('data-label', 'Owner');
        ownerCell.textContent = track.owner;
        tr.appendChild(ownerCell);

        const contactCell = document.createElement('td');
        contactCell.className = 'scores-contact-cell';
        contactCell.setAttribute('data-label', 'Contact');
        const mailLink = document.createElement('a');
        mailLink.className = 'scores-contact-link';
        mailLink.href = buildMailtoHref(track);
        mailLink.textContent = track.email;
        contactCell.appendChild(mailLink);
        tr.appendChild(contactCell);

        const downloadCell = document.createElement('td');
        downloadCell.className = 'scores-download-cell';
        downloadCell.setAttribute('data-label', 'Download');
        const downloadWrap = document.createElement('div');
        downloadWrap.className = 'scores-download-wrap';
        const downloadButton = document.createElement('button');
        downloadButton.type = 'button';
        downloadButton.className = 'btn btn-secondary scores-download-btn';
        downloadButton.textContent = 'Download';
        const downloadStatus = document.createElement('span');
        downloadStatus.className = 'scores-download-status';
        downloadStatus.setAttribute('aria-live', 'polite');
        downloadButton.addEventListener('click', () => {
            handleDownload(track, downloadStatus);
        });
        downloadWrap.appendChild(downloadButton);
        downloadWrap.appendChild(downloadStatus);
        downloadCell.appendChild(downloadWrap);
        tr.appendChild(downloadCell);

        return tr;
    }

    function buildMailtoHref(track) {
        const subject = `Inquiry regarding use - "${track.title}"`;
        return `mailto:${track.email}?subject=${encodeURIComponent(subject)}`;
    }

    function buildWaveform(track) {
        const wrap = document.createElement('div');
        wrap.className = 'scores-waveform';

        const playButton = document.createElement('button');
        playButton.type = 'button';
        playButton.className = 'scores-play-btn';
        playButton.setAttribute('aria-label', `Play ${track.title}`);
        playButton.innerHTML = ICON_PLAY;

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'scores-waveform-canvas-wrap';

        const baseCanvas = document.createElement('canvas');
        baseCanvas.className = 'scores-waveform-canvas scores-waveform-base';
        baseCanvas.width = CANVAS_WIDTH;
        baseCanvas.height = CANVAS_HEIGHT;

        const progressWrap = document.createElement('div');
        progressWrap.className = 'scores-waveform-progress-wrap';

        const progressCanvas = document.createElement('canvas');
        progressCanvas.className = 'scores-waveform-canvas scores-waveform-progress';
        progressCanvas.width = CANVAS_WIDTH;
        progressCanvas.height = CANVAS_HEIGHT;
        progressWrap.appendChild(progressCanvas);

        const label = document.createElement('span');
        label.className = 'scores-waveform-label';
        label.textContent = 'Click play to load';

        canvasWrap.appendChild(baseCanvas);
        canvasWrap.appendChild(progressWrap);
        canvasWrap.appendChild(label);

        const timeLabel = document.createElement('span');
        timeLabel.className = 'scores-time';
        timeLabel.textContent = '0:00';

        wrap.appendChild(playButton);
        wrap.appendChild(canvasWrap);
        wrap.appendChild(timeLabel);

        const state = {
            track,
            playButton,
            baseCanvas,
            progressCanvas,
            progressWrap,
            canvasWrap,
            label,
            timeLabel,
            buffer: null,
            duration: 0,
            source: null,
            gain: null,
            startTime: 0,
            offset: 0,
            isPlaying: false,
            isLoading: false,
            hasError: false,
            rafId: null,
            peaks: null
        };

        drawPlaceholderWaveform(baseCanvas, track.title);
        syncProgressCanvasWidth(canvasWrap, progressCanvas);

        if (window.ResizeObserver) {
            const observer = new ResizeObserver(() => {
                syncProgressCanvasWidth(canvasWrap, progressCanvas);
            });
            observer.observe(canvasWrap);
        } else {
            window.addEventListener('resize', () => {
                syncProgressCanvasWidth(canvasWrap, progressCanvas);
            });
        }

        playButton.addEventListener('click', () => {
            handlePlayPause(state);
        });

        canvasWrap.addEventListener('click', (event) => {
            handleSeek(state, event);
        });

        return wrap;
    }

    function syncProgressCanvasWidth(canvasWrap, progressCanvas) {
        const width = canvasWrap.getBoundingClientRect().width;
        if (width > 0) {
            progressCanvas.style.width = `${width}px`;
        }
    }

    const ICON_PLAY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7 5l13 7-13 7V5z"/></svg>';
    const ICON_PAUSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';

    async function handlePlayPause(state) {
        if (state.hasError || state.isLoading) {
            return;
        }

        if (state.isPlaying) {
            pauseTrack(state);
            return;
        }

        if (activeRow && activeRow !== state) {
            stopTrack(activeRow);
        }

        if (!state.buffer) {
            await loadTrack(state);
            if (!state.buffer) {
                return;
            }
        }

        playTrack(state);
    }

    async function loadTrack(state) {
        state.isLoading = true;
        state.playButton.disabled = true;
        state.playButton.classList.add('is-loading');
        state.label.textContent = 'Loading… 0%';
        state.label.hidden = false;

        try {
            const context = getAudioContext();
            const url = new URL(state.track.file, window.location.href).toString();
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to load audio: ${response.status}`);
            }

            const total = Number(response.headers.get('content-length')) || 0;
            const arrayBuffer = await readWithProgress(response, total, (fraction) => {
                setLoadingProgress(state, fraction);
            });

            setLoadingProgress(state, 1);

            const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

            state.buffer = audioBuffer;
            state.duration = audioBuffer.duration;
            state.peaks = computePeaks(audioBuffer, BAR_COUNT);

            drawWaveform(state.baseCanvas, state.peaks, 'rgba(234, 234, 234, 0.28)');
            drawWaveform(state.progressCanvas, state.peaks, '#e94560');

            state.label.hidden = true;
            state.timeLabel.textContent = formatTime(0);
        } catch (_error) {
            state.hasError = true;
            state.label.textContent = 'Could not load audio';
            state.playButton.classList.add('is-error');
        } finally {
            state.isLoading = false;
            state.playButton.disabled = false;
            state.playButton.classList.remove('is-loading');
        }
    }

    async function readWithProgress(response, total, onProgress) {
        if (!response.body || !response.body.getReader) {
            const buffer = await response.arrayBuffer();
            onProgress(1);
            return buffer;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            chunks.push(value);
            received += value.length;
            if (total > 0) {
                onProgress(Math.min(received / total, 0.99));
            } else {
                onProgress(Math.min(0.05 + received / (received + 500000), 0.95));
            }
        }

        const merged = new Uint8Array(received);
        let offset = 0;
        chunks.forEach((chunk) => {
            merged.set(chunk, offset);
            offset += chunk.length;
        });

        return merged.buffer;
    }

    function setLoadingProgress(state, fraction) {
        const percent = Math.round(fraction * 100);
        state.progressWrap.style.width = `${percent}%`;
        state.label.textContent = fraction >= 1 ? 'Decoding…' : `Loading… ${percent}%`;
    }

    function playTrack(state) {
        const context = getAudioContext();

        if (context.state === 'suspended') {
            context.resume();
        }

        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = state.buffer;
        source.connect(gain);
        gain.connect(context.destination);

        const offset = Math.min(state.offset, Math.max(state.duration - 0.05, 0));
        source.start(0, offset);

        state.source = source;
        state.gain = gain;
        state.startTime = context.currentTime - offset;
        state.isPlaying = true;
        activeRow = state;

        state.playButton.innerHTML = ICON_PAUSE;
        state.playButton.classList.add('playing');
        state.playButton.setAttribute('aria-label', `Pause ${state.track.title}`);

        source.addEventListener('ended', () => {
            if (state.isPlaying) {
                finishTrack(state);
            }
        });

        tickProgress(state);
    }

    function pauseTrack(state) {
        state.offset = getElapsed(state);
        stopSourceOnly(state);
        state.isPlaying = false;
        cancelAnimationFrame(state.rafId);

        state.playButton.innerHTML = ICON_PLAY;
        state.playButton.classList.remove('playing');
        state.playButton.setAttribute('aria-label', `Play ${state.track.title}`);
    }

    function finishTrack(state) {
        stopSourceOnly(state);
        state.isPlaying = false;
        state.offset = 0;
        cancelAnimationFrame(state.rafId);

        state.progressWrap.style.width = '0%';
        state.timeLabel.textContent = formatTime(0);
        state.playButton.innerHTML = ICON_PLAY;
        state.playButton.classList.remove('playing');
        state.playButton.setAttribute('aria-label', `Play ${state.track.title}`);

        if (activeRow === state) {
            activeRow = null;
        }
    }

    function stopTrack(state) {
        if (!state.isPlaying) {
            return;
        }
        finishTrack(state);
    }

    function stopSourceOnly(state) {
        if (state.source) {
            try {
                state.source.stop();
            } catch (_error) {
                /* already stopped */
            }
            state.source.disconnect();
            state.source = null;
        }
        if (state.gain) {
            state.gain.disconnect();
            state.gain = null;
        }
    }

    function getElapsed(state) {
        const context = getAudioContext();
        return Math.max(context.currentTime - state.startTime, 0);
    }

    function tickProgress(state) {
        if (!state.isPlaying) {
            return;
        }

        const elapsed = getElapsed(state);

        if (elapsed >= state.duration) {
            finishTrack(state);
            return;
        }

        const fraction = state.duration > 0 ? elapsed / state.duration : 0;
        state.progressWrap.style.width = `${fraction * 100}%`;
        state.timeLabel.textContent = formatTime(elapsed);

        state.rafId = requestAnimationFrame(() => tickProgress(state));
    }

    function handleSeek(state, event) {
        if (!state.buffer || state.hasError) {
            return;
        }

        const rect = state.canvasWrap.getBoundingClientRect();
        const fraction = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const wasPlaying = state.isPlaying;

        stopSourceOnly(state);
        cancelAnimationFrame(state.rafId);
        state.offset = fraction * state.duration;
        state.progressWrap.style.width = `${fraction * 100}%`;
        state.timeLabel.textContent = formatTime(state.offset);

        if (wasPlaying) {
            playTrack(state);
        } else {
            state.isPlaying = false;
        }
    }

    function stopActiveRow() {
        if (activeRow) {
            stopTrack(activeRow);
        }
    }

    function getAudioContext() {
        if (!audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContextClass();
        }
        return audioContext;
    }

    function computePeaks(audioBuffer, barCount) {
        const channelData = audioBuffer.getChannelData(0);
        const bucketSize = Math.max(Math.floor(channelData.length / barCount), 1);
        const peaks = [];

        for (let i = 0; i < barCount; i += 1) {
            const start = i * bucketSize;
            const end = Math.min(start + bucketSize, channelData.length);
            let max = 0;
            for (let j = start; j < end; j += 1) {
                const value = Math.abs(channelData[j]);
                if (value > max) {
                    max = value;
                }
            }
            peaks.push(max);
        }

        const overallMax = Math.max(...peaks, 0.01);
        return peaks.map((value) => Math.max(value / overallMax, 0.06));
    }

    function drawWaveform(canvas, peaks, color) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const barWidth = width / peaks.length;
        const gap = barWidth * 0.35;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;

        peaks.forEach((value, index) => {
            const barHeight = Math.max(value * height, 2);
            const x = index * barWidth;
            const y = (height - barHeight) / 2;
            ctx.fillRect(x, y, Math.max(barWidth - gap, 1), barHeight);
        });
    }

    function drawPlaceholderWaveform(canvas, seedText) {
        const random = mulberry32(hashString(seedText));
        const peaks = [];
        for (let i = 0; i < BAR_COUNT; i += 1) {
            peaks.push(0.15 + random() * 0.55);
        }
        drawWaveform(canvas, peaks, 'rgba(234, 234, 234, 0.16)');
    }

    function hashString(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = (hash << 5) - hash + value.charCodeAt(i);
            hash |= 0;
        }
        return hash >>> 0;
    }

    function mulberry32(seed) {
        let a = seed;
        return function () {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function formatTime(seconds) {
        const total = Math.max(Math.floor(seconds), 0);
        const minutes = Math.floor(total / 60);
        const secs = total % 60;
        return `${minutes}:${String(secs).padStart(2, '0')}`;
    }

    function encodeFilePath(filePath) {
        return filePath
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
    }

    async function handleDownload(track, statusElement) {
        const encodedPath = encodeFilePath(track.file);
        const url = new URL(encodedPath, window.location.href).toString();
        const fileName = track.file.split('/').pop() || `${track.title}.wav`;

        const session = readActiveSession();
        const downloaderName = session ? session.name : 'Unknown';

        triggerDownload(url, fileName);

        statusElement.textContent = 'Downloaded';
        statusElement.classList.add('is-success');

        try {
            await notifyDownload(downloaderName, track.title);
        } catch (_error) {
            /* Notification failure should not block the download itself. */
        }
    }

    function triggerDownload(url, fileName) {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function readActiveSession() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_error) {
            return null;
        }
    }

    async function notifyDownload(downloaderName, trackTitle) {
        const formData = new FormData();
        formData.append('form_source', 'Scores Archive Download');
        formData.append('name', downloaderName);
        formData.append('track', trackTitle);
        formData.append('message', `${downloaderName} downloaded "${trackTitle}" from the Scores & Sketches archive.`);

        await fetch(NOTIFY_ENDPOINT, {
            method: 'POST',
            body: formData,
            headers: {
                Accept: 'application/json'
            }
        });
    }
})();
