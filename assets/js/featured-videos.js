document.addEventListener('DOMContentLoaded', function() {
    const featuredItems = Array.from(document.querySelectorAll('.featured-home .media-item'));
    const iframes = featuredItems
        .map(function(item) {
            return item.querySelector('iframe');
        })
        .filter(Boolean);

    if (!featuredItems.length || !iframes.length) {
        return;
    }

    let players = [];
    const pauseResetTimers = new WeakMap();

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

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() {
        if (typeof previousReady === 'function') {
            previousReady();
        }

        bindPlayers();
    };

    if (window.YT && typeof window.YT.Player === 'function') {
        bindPlayers();
        return;
    }

    const apiScript = document.createElement('script');
    apiScript.src = 'https://www.youtube.com/iframe_api';
    apiScript.async = true;
    document.head.appendChild(apiScript);
});