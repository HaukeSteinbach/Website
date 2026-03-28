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
        const distanceToEdge = heroRect.bottom - contentRect.bottom;
        const fadeWindow = 180;
        const rawProgress = (fadeWindow - distanceToEdge) / fadeWindow;
        const fadeProgress = Math.max(0, Math.min(1, rawProgress));
        const easedProgress = fadeProgress * fadeProgress;
        const opacity = 1 - (easedProgress * 0.92);
        const drift = easedProgress * 18;

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
