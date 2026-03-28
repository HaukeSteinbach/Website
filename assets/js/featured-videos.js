document.addEventListener('DOMContentLoaded', function() {
    const featuredItems = Array.from(document.querySelectorAll('.featured-home .media-item'));
    let players = [];
    let initialized = false;
    let apiRequested = false;

    if (!featuredItems.length) {
        return;
    }

    const pauseResetTimers = new WeakMap();

    function getReadyIframes() {
        return featuredItems
            .map(function(item) {
                return item.querySelector('iframe[src]');
            })
            .filter(Boolean);
    }

    function clearPauseReset(item) {
        const timerId = pauseResetTimers.get(item);

        if (timerId) {
            window.clearTimeout(timerId);
            pauseResetTimers.delete(item);
        }
    }

    function pauseOtherPlayers(activeItem) {
        players.forEach(function(entry) {
            if (entry.item !== activeItem) {
                entry.player.pauseVideo();
            }
        });
    }

    function setPlayingItem(activeItem) {
        featuredItems.forEach(function(item) {
            item.classList.toggle('is-playing', item === activeItem);
        });
    }

    function clearPlayingItem(item) {
        clearPauseReset(item);

        if (item && item.classList.contains('is-playing')) {
            item.classList.remove('is-playing');
        }
    }

    function bindPlayers() {
        const iframes = getReadyIframes();

        if (!iframes.length || initialized || !window.YT || typeof window.YT.Player !== 'function') {
            return;
        }

        initialized = true;
        players = iframes.map(function(iframe) {
            const item = iframe.closest('.media-item');
            const player = new window.YT.Player(iframe, {
                events: {
                    onStateChange: function(event) {
                        if (
                            event.data === window.YT.PlayerState.PLAYING ||
                            event.data === window.YT.PlayerState.BUFFERING
                        ) {
                            clearPauseReset(item);
                            pauseOtherPlayers(item);
                            setPlayingItem(item);
                            return;
                        }

                        if (event.data === window.YT.PlayerState.PAUSED) {
                            clearPauseReset(item);

                            pauseResetTimers.set(item, window.setTimeout(function() {
                                if (player.getPlayerState() === window.YT.PlayerState.PAUSED) {
                                    clearPlayingItem(item);
                                }
                            }, 250));

                            return;
                        }

                        if (
                            event.data === window.YT.PlayerState.ENDED ||
                            event.data === window.YT.PlayerState.CUED
                        ) {
                            clearPlayingItem(item);
                        }
                    }
                }
            });

            return { item: item, player: player };
        });
    }

    function ensureYouTubeApi() {
        if (apiRequested || window.YT) {
            bindPlayers();
            return;
        }

        if (!getReadyIframes().length) {
            return;
        }

        apiRequested = true;

        const apiScript = document.createElement('script');
        apiScript.src = 'https://www.youtube.com/iframe_api';
        apiScript.async = true;
        document.head.appendChild(apiScript);
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() {
        if (typeof previousReady === 'function') {
            previousReady();
        }

        bindPlayers();
    };

    if (window.YT && typeof window.YT.Player === 'function') {
        bindPlayers();
    } else {
        ensureYouTubeApi();
    }

    document.addEventListener('steinbach:external-media-ready', function() {
        ensureYouTubeApi();
    });
});