/**
 * Audio comparison based on the Web Audio API.
 * Both tracks are fetched and decoded before playback, then started together.
 */

class SimpleAudioComparison {
    constructor() {
        this.audioContext = null;
        this.cardStates = new Map();
    }

    init() {
        const toggles = document.querySelectorAll('.toggle-checkbox:not([data-comparison-bound="true"])');
        const playButtons = document.querySelectorAll('.btn-play-pause:not([data-comparison-bound="true"])');

        toggles.forEach((toggle) => {
            toggle.addEventListener('change', (event) => {
                this.handleToggle(event);
            });
            toggle.dataset.comparisonBound = 'true';
        });

        playButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                void this.handlePlayPause(event);
            });
            button.dataset.comparisonBound = 'true';
        });

        this.initializeCards();
    }

    initializeCards() {
        const cards = document.querySelectorAll('[data-comparison-id]:not([data-comparison-initialized="true"])');

        cards.forEach((card) => {
            const toggle = card.querySelector('.toggle-checkbox');
            const button = card.querySelector('.btn-play-pause');
            const primaryAudio = card.querySelector('.mix-audio, .raw-audio');
            const secondaryAudio = card.querySelector('.master-audio, .mixed-audio');

            if (!toggle || !button || !primaryAudio || !secondaryAudio) {
                return;
            }

            toggle.checked = false;

            const state = {
                cardId: card.dataset.comparisonId,
                card,
                toggle,
                button,
                primarySrc: this.getAudioSource(primaryAudio),
                secondarySrc: this.getAudioSource(secondaryAudio),
                primaryBuffer: null,
                secondaryBuffer: null,
                primarySource: null,
                secondarySource: null,
                primaryGain: null,
                secondaryGain: null,
                startTime: 0,
                offset: 0,
                duration: 0,
                isPlaying: false,
                endTimerId: null,
                ready: false,
                hasError: false
            };

            this.cardStates.set(state.cardId, state);
            this.setLoadingState(state, false, false);
            card.dataset.comparisonInitialized = 'true';
            void this.loadCardAudio(state);
        });
    }

    getAudioSource(audioElement) {
        const sourceElement = audioElement.querySelector('source');

        if (sourceElement) {
            return sourceElement.getAttribute('src') || '';
        }

        return audioElement.getAttribute('src') || '';
    }

    async getAudioContext() {
        if (!this.audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;

            if (!AudioContextClass) {
                throw new Error('Web Audio API is not supported in this browser.');
            }

            this.audioContext = new AudioContextClass();
        }

        return this.audioContext;
    }

    async ensureAudioContextRunning() {
        const context = await this.getAudioContext();

        if (context.state === 'suspended') {
            await context.resume();
        }

        return context;
    }

    async fetchBuffer(sourcePath) {
        const context = await this.getAudioContext();
        const url = new URL(sourcePath, window.location.href);
        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Failed to load audio: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        return context.decodeAudioData(buffer.slice(0));
    }

    async loadCardAudio(state) {
        try {
            this.setLoadingState(state, false, false);

            const [primaryBuffer, secondaryBuffer] = await Promise.all([
                this.fetchBuffer(state.primarySrc),
                this.fetchBuffer(state.secondarySrc)
            ]);

            state.primaryBuffer = primaryBuffer;
            state.secondaryBuffer = secondaryBuffer;
            state.duration = Math.min(primaryBuffer.duration, secondaryBuffer.duration);
            state.ready = true;
            state.hasError = false;

            this.setLoadingState(state, true, false);
        } catch (_error) {
            state.ready = false;
            state.hasError = true;
            this.setLoadingState(state, false, true);
        }
    }

    setLoadingState(state, isReady, hasError) {
        state.ready = isReady;
        state.hasError = hasError;
        state.toggle.disabled = !isReady || hasError;
        state.button.disabled = !isReady || hasError;
        state.button.classList.toggle('is-loading', !isReady && !hasError);
        state.button.classList.toggle('is-error', hasError);
        state.button.classList.remove('playing');

        if (hasError) {
            state.button.textContent = 'Audio unavailable';
            return;
        }

        if (!isReady) {
            state.button.textContent = 'Loading audio';
            return;
        }

        state.button.textContent = state.isPlaying ? 'Pause' : 'Play';
    }

    setButtonState(state, isPlaying) {
        state.isPlaying = isPlaying;
        state.button.textContent = isPlaying ? 'Pause' : 'Play';
        state.button.classList.toggle('playing', isPlaying);
        state.button.classList.remove('is-loading', 'is-error');
    }

    getActiveKey(state) {
        return state.toggle.checked ? 'secondary' : 'primary';
    }

    applyOutputMix(state, immediate = false) {
        if (!state.primaryGain || !state.secondaryGain || !this.audioContext) {
            return;
        }

        const now = this.audioContext.currentTime;
        const fadeDuration = immediate ? 0 : 0.02;
        const activeKey = this.getActiveKey(state);
        const primaryTarget = activeKey === 'primary' ? 1 : 0;
        const secondaryTarget = activeKey === 'secondary' ? 1 : 0;

        state.primaryGain.gain.cancelScheduledValues(now);
        state.secondaryGain.gain.cancelScheduledValues(now);

        state.primaryGain.gain.setValueAtTime(state.primaryGain.gain.value, now);
        state.secondaryGain.gain.setValueAtTime(state.secondaryGain.gain.value, now);
        state.primaryGain.gain.linearRampToValueAtTime(primaryTarget, now + fadeDuration);
        state.secondaryGain.gain.linearRampToValueAtTime(secondaryTarget, now + fadeDuration);
    }

    clearEndTimer(state) {
        if (!state.endTimerId) {
            return;
        }

        window.clearTimeout(state.endTimerId);
        state.endTimerId = null;
    }

    scheduleEnd(state) {
        this.clearEndTimer(state);

        const remaining = Math.max(state.duration - state.offset, 0);
        state.endTimerId = window.setTimeout(() => {
            this.finishPlayback(state, true);
        }, remaining * 1000);
    }

    getCurrentOffset(state) {
        if (!state.isPlaying || !this.audioContext) {
            return state.offset;
        }

        return Math.min(
            Math.max(this.audioContext.currentTime - state.startTime, 0),
            state.duration
        );
    }

    destroySources(state) {
        [state.primarySource, state.secondarySource].forEach((source) => {
            if (!source) {
                return;
            }

            try {
                source.stop();
            } catch (_error) {
                // Source may already be stopped.
            }

            source.disconnect();
        });

        [state.primaryGain, state.secondaryGain].forEach((gain) => {
            if (gain) {
                gain.disconnect();
            }
        });

        state.primarySource = null;
        state.secondarySource = null;
        state.primaryGain = null;
        state.secondaryGain = null;
    }

    finishPlayback(state, resetOffset = false) {
        this.clearEndTimer(state);

        if (!resetOffset) {
            state.offset = this.getCurrentOffset(state);
        } else {
            state.offset = 0;
            state.toggle.checked = false;
        }

        state.isPlaying = false;
        this.destroySources(state);
        this.setButtonState(state, false);
    }

    async startPlayback(state) {
        if (!state.ready || state.hasError) {
            return;
        }

        await this.ensureAudioContextRunning();
        this.pauseOtherCards(state.cardId);
        this.finishPlayback(state, false);

        const startOffset = Math.min(state.offset, Math.max(state.duration - 0.01, 0));
        const startAt = this.audioContext.currentTime + 0.03;

        state.primarySource = this.audioContext.createBufferSource();
        state.secondarySource = this.audioContext.createBufferSource();
        state.primaryGain = this.audioContext.createGain();
        state.secondaryGain = this.audioContext.createGain();

        state.primarySource.buffer = state.primaryBuffer;
        state.secondarySource.buffer = state.secondaryBuffer;

        state.primarySource.connect(state.primaryGain);
        state.secondarySource.connect(state.secondaryGain);
        state.primaryGain.connect(this.audioContext.destination);
        state.secondaryGain.connect(this.audioContext.destination);

        state.primaryGain.gain.setValueAtTime(0, startAt);
        state.secondaryGain.gain.setValueAtTime(0, startAt);

        state.offset = startOffset;
        state.startTime = startAt - startOffset;

        this.applyOutputMix(state, true);

        state.primarySource.start(startAt, startOffset);
        state.secondarySource.start(startAt, startOffset);

        this.setButtonState(state, true);
        this.scheduleEnd(state);
    }

    pauseOtherCards(activeCardId) {
        this.cardStates.forEach((state, cardId) => {
            if (cardId === activeCardId) {
                return;
            }

            if (!state.isPlaying && state.offset === 0) {
                return;
            }

            this.finishPlayback(state, true);
        });
    }

    handleToggle(event) {
        const cardId = event.target.getAttribute('data-card-id');
        const state = this.cardStates.get(cardId);

        if (!state || !state.ready || state.hasError) {
            return;
        }

        if (state.isPlaying) {
            this.applyOutputMix(state, false);
        }
    }

    async handlePlayPause(event) {
        const cardId = event.currentTarget.getAttribute('data-card-id');
        const state = this.cardStates.get(cardId);

        if (!state || !state.ready || state.hasError) {
            return;
        }

        if (state.isPlaying) {
            this.finishPlayback(state, false);
            return;
        }

        await this.startPlayback(state);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const comparison = new SimpleAudioComparison();
    comparison.init();

    document.addEventListener('steinbach:portfolio-ready', () => {
        comparison.init();
    });
});