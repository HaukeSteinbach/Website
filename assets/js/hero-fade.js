/**
 * Hero exit on scroll
 * Starts fading the hero copy before it reaches the bottom edge, without clipping it.
 */

document.addEventListener('DOMContentLoaded', function() {
    const hero = document.querySelector('.hero');
    const heroContent = document.querySelector('.hero-content');
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    
    if (!hero || !heroContent) return;

    function resetHeroStyles() {
        heroContent.style.opacity = '1';
        heroContent.style.pointerEvents = 'auto';
        heroContent.style.transform = '';
    }

    function updateHeroFade() {
        if (mobileQuery.matches) {
            resetHeroStyles();
            return;
        }

        const heroRect = hero.getBoundingClientRect();
        const contentRect = heroContent.getBoundingClientRect();
        const scrollTop = Math.max(window.scrollY, 0);
        const fadeStart = 36;
        const fadeWindow = 220;
        const rawProgress = (scrollTop - fadeStart) / fadeWindow;
        const fadeProgress = Math.max(0, Math.min(1, rawProgress));
        const opacity = 1 - (fadeProgress * 0.92);
        const drift = fadeProgress * 18;

        if (scrollTop <= fadeStart) {
            resetHeroStyles();
            return;
        }

        if (heroRect.bottom <= contentRect.top) {
            heroContent.style.opacity = 0;
            heroContent.style.pointerEvents = 'none';
        } else {
            heroContent.style.opacity = String(opacity);
            heroContent.style.pointerEvents = opacity < 0.08 ? 'none' : 'auto';
        }

        heroContent.style.transform = `translate(-50%, calc(-50% + ${drift}px))`;
    }

    updateHeroFade();
    window.addEventListener('scroll', updateHeroFade, { passive: true });
    window.addEventListener('resize', updateHeroFade);
    mobileQuery.addEventListener('change', updateHeroFade);
});
