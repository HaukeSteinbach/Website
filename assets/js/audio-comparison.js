/**
 * Audio comparison based on the Web Audio API.
 * Both tracks are fetched and decoded before playback, then started together.
 */

class SimpleAudioComparison {
    constructor() {
        this.audioContext = null;
        this.cardStates = new Map();
        this.useMediaElementFallback = this.isResourceConstrainedDevice();
        this.eagerPreload = !this.useMediaElementFallback;
    }

    isResourceConstrainedDevice() {
        const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const narrowViewport = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
        const touchDevice = navigator.maxTouchPoints > 0;

        return Boolean(coarsePointer || (touchDevice && narrowViewport));
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
                primaryElement: primaryAudio,
                secondaryElement: secondaryAudio,
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
                syncIntervalId: null,
                loadPromise: null,
                ready: false,
                hasError: false
            };

            if (this.useMediaElementFallback) {
                primaryAudio.preload = 'none';
                secondaryAudio.preload = 'none';
                this.applyMediaElementMix(state);
            }

            this.cardStates.set(state.cardId, state);
            this.updateControlState(state);
            card.dataset.comparisonInitialized = 'true';

            if (this.eagerPreload) {
                void this.loadCardAudio(state);
            }
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
        if (state.ready || state.loadPromise) {
            return state.loadPromise;
        }

        try {
            state.loadPromise = (async () => {
                this.updateControlState(state);

                if (this.useMediaElementFallback) {
                    const [primaryElement, secondaryElement] = await Promise.all([
                        this.loadMediaElement(state.primaryElement),
                        this.loadMediaElement(state.secondaryElement)
                    ]);

                    state.duration = Math.min(primaryElement.duration || Infinity, secondaryElement.duration || Infinity);
                    state.ready = Number.isFinite(state.duration) && state.duration > 0;
                    state.hasError = !state.ready;
                    return;
                }

                const [primaryBuffer, secondaryBuffer] = await Promise.all([
                    this.fetchBuffer(state.primarySrc),
                    this.fetchBuffer(state.secondarySrc)
                ]);

                state.primaryBuffer = primaryBuffer;
                state.secondaryBuffer = secondaryBuffer;
                state.duration = Math.min(primaryBuffer.duration, secondaryBuffer.duration);
                state.ready = true;
                state.hasError = false;
            })();

            await state.loadPromise;
        } catch (_error) {
            state.ready = false;
            state.hasError = true;
        } finally {
            state.loadPromise = null;
            this.updateControlState(state);
        }

        return state.loadPromise;
    }

    loadMediaElement(audioElement) {
        if (!audioElement) {
            return Promise.reject(new Error('Audio element not found.'));
        }

        if (audioElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            return Promise.resolve(audioElement);
        }

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                audioElement.removeEventListener('canplay', onReady);
                audioElement.removeEventListener('canplaythrough', onReady);
                audioElement.removeEventListener('loadeddata', onReady);
                audioElement.removeEventListener('error', onError);
            };

            const onReady = () => {
                if (audioElement.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
                    return;
                }

                cleanup();
                resolve(audioElement);
            };

            const onError = () => {
                cleanup();
                reject(new Error('Audio element failed to load.'));
            };

            audioElement.addEventListener('canplay', onReady);
            audioElement.addEventListener('canplaythrough', onReady);
            audioElement.addEventListener('loadeddata', onReady);
            audioElement.addEventListener('error', onError, { once: true });
            audioElement.preload = 'auto';
            audioElement.load();
        });
    }

    updateControlState(state) {
        const isLoading = Boolean(state.loadPromise);
        const isReady = state.ready;
        const hasError = state.hasError;

        state.toggle.disabled = !isReady || hasError;
        state.button.disabled = hasError || isLoading || (this.eagerPreload && !isReady);
        state.button.classList.toggle('is-loading', isLoading || (this.eagerPreload && !isReady && !hasError));
        state.button.classList.toggle('is-error', hasError);
        state.button.classList.toggle('playing', state.isPlaying);

        if (hasError) {
            state.button.textContent = 'Audio unavailable';
            return;
        }

        if (isLoading || (this.eagerPreload && !isReady)) {
            state.button.textContent = 'Loading audio';
            return;
        }

        if (!isReady) {
            state.button.textContent = 'Load audio';
            return;
        }

        state.button.textContent = state.isPlaying ? 'Pause' : 'Play';
    }

    setButtonState(state, isPlaying) {
        state.isPlaying = isPlaying;
        this.updateControlState(state);
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

    applyMediaElementMix(state) {
        if (!state.primaryElement || !state.secondaryElement) {
            return;
        }

        const activeKey = this.getActiveKey(state);
        state.primaryElement.muted = activeKey !== 'primary';
        state.secondaryElement.muted = activeKey !== 'secondary';
        state.primaryElement.volume = 1;
        state.secondaryElement.volume = 1;
    }

    stopMediaSync(state) {
        if (!state.syncIntervalId) {
            return;
        }

        window.clearInterval(state.syncIntervalId);
        state.syncIntervalId = null;
    }

    startMediaSync(state) {
        if (!state.primaryElement || !state.secondaryElement) {
            return;
        }

        this.stopMediaSync(state);
        state.syncIntervalId = window.setInterval(() => {
            if (state.primaryElement.paused || state.secondaryElement.paused) {
                return;
            }

            const activeElement = this.getActiveKey(state) === 'primary' ? state.primaryElement : state.secondaryElement;
            const inactiveElement = activeElement === state.primaryElement ? state.secondaryElement : state.primaryElement;
            const drift = Math.abs(activeElement.currentTime - inactiveElement.currentTime);

            if (drift <= 0.12) {
                return;
            }

            inactiveElement.currentTime = activeElement.currentTime;
        }, 200);
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

        if (this.useMediaElementFallback) {
            this.stopMediaSync(state);

            if (!resetOffset) {
                const activeElement = this.getActiveKey(state) === 'primary' ? state.primaryElement : state.secondaryElement;
                state.offset = activeElement ? activeElement.currentTime : state.offset;
            } else {
                state.offset = 0;
                state.toggle.checked = false;

                if (state.primaryElement) {
                    state.primaryElement.currentTime = 0;
                }

                if (state.secondaryElement) {
                    state.secondaryElement.currentTime = 0;
                }
            }

            if (state.primaryElement) {
                state.primaryElement.pause();
            }

            if (state.secondaryElement) {
                state.secondaryElement.pause();
            }

            state.isPlaying = false;
            this.applyMediaElementMix(state);
            this.setButtonState(state, false);
            return;
        }

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

    unloadCardAudio(state) {
        if (state.isPlaying) {
            return;
        }

        if (this.useMediaElementFallback) {
            this.stopMediaSync(state);
            state.primaryElement.pause();
            state.secondaryElement.pause();
            state.primaryElement.preload = 'none';
            state.secondaryElement.preload = 'none';
            state.primaryElement.currentTime = 0;
            state.secondaryElement.currentTime = 0;
        }

        state.primaryBuffer = null;
        state.secondaryBuffer = null;
        state.primarySource = null;
        state.secondarySource = null;
        state.primaryGain = null;
        state.secondaryGain = null;
        state.ready = false;
        state.hasError = false;
        state.duration = 0;
        state.offset = 0;
        state.toggle.checked = false;
        this.updateControlState(state);
    }

    async startPlayback(state) {
        if (!state.ready || state.hasError) {
            return;
        }

        if (this.useMediaElementFallback) {
            this.pauseOtherCards(state.cardId);
            this.finishPlayback(state, false);

            const startOffset = Math.min(state.offset, Math.max(state.duration - 0.01, 0));
            state.primaryElement.currentTime = startOffset;
            state.secondaryElement.currentTime = startOffset;
            this.applyMediaElementMix(state);

            const playbackResults = await Promise.allSettled([
                state.primaryElement.play(),
                state.secondaryElement.play()
            ]);

            if (playbackResults.some((result) => result.status === 'rejected')) {
                this.finishPlayback(state, false);
                return;
            }

            state.offset = startOffset;
            this.setButtonState(state, true);
            this.startMediaSync(state);
            this.scheduleEnd(state);
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

            if (!this.eagerPreload) {
                this.unloadCardAudio(state);
            }
        });
    }

    handleToggle(event) {
        const cardId = event.target.getAttribute('data-card-id');
        const state = this.cardStates.get(cardId);

        if (!state || !state.ready || state.hasError) {
            return;
        }

        if (state.isPlaying) {
            if (this.useMediaElementFallback) {
                const activeElement = this.getActiveKey(state) === 'primary' ? state.primaryElement : state.secondaryElement;
                const inactiveElement = activeElement === state.primaryElement ? state.secondaryElement : state.primaryElement;

                if (activeElement && inactiveElement) {
                    inactiveElement.currentTime = activeElement.currentTime;
                }

                this.applyMediaElementMix(state);
                return;
            }

            this.applyOutputMix(state, false);
        }
    }

    async handlePlayPause(event) {
        const cardId = event.currentTarget.getAttribute('data-card-id');
        const state = this.cardStates.get(cardId);

        if (!state || state.hasError) {
            return;
        }

        if (!state.ready) {
            await this.ensureAudioContextRunning();
            await this.loadCardAudio(state);

            if (!state.ready || state.hasError) {
                return;
            }
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