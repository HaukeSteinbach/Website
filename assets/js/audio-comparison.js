/**
 * Simple Audio Comparison Module
 * Handles toggling between mix and master with play/pause controls
 */

class SimpleAudioComparison {
    constructor() {
        this.syncIntervals = {};
    }

    /**
     * Initialize audio comparison for all mastering and mixing cards
     */
    init() {
        const toggles = document.querySelectorAll('.toggle-checkbox:not([data-comparison-bound="true"])');
        const playButtons = document.querySelectorAll('.btn-play-pause:not([data-comparison-bound="true"])');

        toggles.forEach(toggle => {
            toggle.addEventListener('change', (e) => this.handleToggle(e));
            toggle.dataset.comparisonBound = 'true';
        });

        playButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.handlePlayPause(e));
            btn.dataset.comparisonBound = 'true';
        });

        this.bindEndedHandlers();
    }

    getCardElements(cardId) {
        let card = document.getElementById(`mastering-${cardId}`);
        let primaryAudio;
        let secondaryAudio;

        if (card) {
            primaryAudio = card.querySelector('.mix-audio');
            secondaryAudio = card.querySelector('.master-audio');
        } else {
            card = document.getElementById(`mixing-${cardId}`);
            primaryAudio = card ? card.querySelector('.raw-audio') : null;
            secondaryAudio = card ? card.querySelector('.mixed-audio') : null;
        }

        return {
            card,
            primaryAudio,
            secondaryAudio,
            toggle: card ? card.querySelector('.toggle-checkbox') : null,
            button: card ? card.querySelector('.btn-play-pause') : null
        };
    }

    bindEndedHandlers() {
        const audios = document.querySelectorAll('.mix-audio, .master-audio, .raw-audio, .mixed-audio');

        audios.forEach(audio => {
            if (audio.dataset.comparisonEndedBound === 'true') {
                return;
            }

            audio.addEventListener('ended', () => {
                const card = audio.closest('article');
                if (!card) return;

                const cardId = card.id.replace('mastering-', '').replace('mixing-', '');
                const { primaryAudio, secondaryAudio, button } = this.getCardElements(cardId);

                if (primaryAudio) {
                    primaryAudio.pause();
                }
                if (secondaryAudio) {
                    secondaryAudio.pause();
                }

                this.stopSync(cardId);
                this.setButtonState(button, false);
            });

            audio.dataset.comparisonEndedBound = 'true';
        });
    }

    setButtonState(button, isPlaying) {
        if (!button) return;

        button.textContent = isPlaying ? 'Pause' : 'Play';
        button.classList.toggle('playing', isPlaying);
    }

    applyAudibility(toggle, primaryAudio, secondaryAudio) {
        if (!primaryAudio || !secondaryAudio) return;

        const secondaryIsActive = toggle ? toggle.checked : false;
        primaryAudio.muted = secondaryIsActive;
        secondaryAudio.muted = !secondaryIsActive;
    }

    stopSync(cardId) {
        if (!this.syncIntervals[cardId]) return;

        clearInterval(this.syncIntervals[cardId]);
        delete this.syncIntervals[cardId];
    }

    startSync(cardId, primaryAudio, secondaryAudio) {
        if (!primaryAudio || !secondaryAudio) return;

        this.stopSync(cardId);
        this.syncIntervals[cardId] = setInterval(() => {
            if (primaryAudio.paused || secondaryAudio.paused) {
                return;
            }

            const drift = Math.abs(primaryAudio.currentTime - secondaryAudio.currentTime);
            if (drift <= 0.12) {
                return;
            }

            if (primaryAudio.currentTime > secondaryAudio.currentTime) {
                secondaryAudio.currentTime = primaryAudio.currentTime;
            } else {
                primaryAudio.currentTime = secondaryAudio.currentTime;
            }
        }, 150);
    }

    pauseOtherCards(activeCardId) {
        const buttons = document.querySelectorAll('.btn-play-pause');
        buttons.forEach(button => {
            const cardId = button.getAttribute('data-card-id');
            if (cardId === activeCardId) return;

            const { primaryAudio, secondaryAudio } = this.getCardElements(cardId);
            if (primaryAudio) {
                primaryAudio.pause();
            }
            if (secondaryAudio) {
                secondaryAudio.pause();
            }

            this.stopSync(cardId);
            this.setButtonState(button, false);
        });
    }

    syncTimes(primaryAudio, secondaryAudio) {
        if (!primaryAudio || !secondaryAudio) return;

        const sharedTime = Math.max(primaryAudio.currentTime || 0, secondaryAudio.currentTime || 0);
        primaryAudio.currentTime = sharedTime;
        secondaryAudio.currentTime = sharedTime;
    }

    async playPair(cardId, primaryAudio, secondaryAudio, toggle, button) {
        if (!primaryAudio || !secondaryAudio) return;

        this.pauseOtherCards(cardId);
        this.syncTimes(primaryAudio, secondaryAudio);
        this.applyAudibility(toggle, primaryAudio, secondaryAudio);

        await Promise.allSettled([
            primaryAudio.play(),
            secondaryAudio.play()
        ]);

        this.startSync(cardId, primaryAudio, secondaryAudio);
        this.setButtonState(button, true);
    }

    /**
     * Handle mix/master or raw/mixed toggle
     */
    handleToggle(event) {
        const toggle = event.target;
        const cardId = toggle.getAttribute('data-card-id');
        const { card, primaryAudio, secondaryAudio, button } = this.getCardElements(cardId);
        if (!card) return;

        this.applyAudibility(toggle, primaryAudio, secondaryAudio);
        const isPlaying = (primaryAudio && !primaryAudio.paused) || (secondaryAudio && !secondaryAudio.paused);
        this.setButtonState(button, Boolean(isPlaying));
    }

    /**
     * Handle play/pause button click for both mastering and mixing cards
     */
    handlePlayPause(event) {
        const btn = event.target;
        const cardId = btn.getAttribute('data-card-id');
        const { card, primaryAudio, secondaryAudio, toggle } = this.getCardElements(cardId);
        if (!card) return;

        const isPlaying = (primaryAudio && !primaryAudio.paused) || (secondaryAudio && !secondaryAudio.paused);
        if (isPlaying) {
            if (primaryAudio) {
                primaryAudio.pause();
            }
            if (secondaryAudio) {
                secondaryAudio.pause();
            }

            this.stopSync(cardId);
            this.setButtonState(btn, false);
            return;
        }

        this.playPair(cardId, primaryAudio, secondaryAudio, toggle, btn);
    }
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', () => {
    const comparison = new SimpleAudioComparison();
    comparison.init();

    document.addEventListener('steinbach:portfolio-ready', () => {
        comparison.init();
    });
});