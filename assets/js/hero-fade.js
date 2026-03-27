/**
 * Hero Fade on Scroll
 * Makes the hero content fade out as user scrolls down
 */

document.addEventListener('DOMContentLoaded', function() {
    const hero = document.querySelector('.hero');
    const heroContent = document.querySelector('.hero-content');
    const subtitle = document.querySelector('.hero-content .subtitle');
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    
    if (!hero || !heroContent || !subtitle) return;

    function resetHeroStyles() {
        heroContent.style.opacity = '1';
        heroContent.style.pointerEvents = 'auto';
        subtitle.style.clipPath = 'none';
        subtitle.style.webkitClipPath = 'none';
    }

    function updateHeroFade() {
        if (mobileQuery.matches) {
            resetHeroStyles();
            return;
        }

        // Calculate fade based on scroll position
        const scrolled = window.scrollY;
        const fadeStart = 0;
        const fadeEnd = 200; // Fade out over 200px (faster)
        const heroRect = hero.getBoundingClientRect();
        const subtitleRect = subtitle.getBoundingClientRect();
        const clipBottom = Math.max(0, subtitleRect.bottom - heroRect.bottom);
        const maxClip = subtitleRect.height;
        const clippedAmount = Math.min(clipBottom, maxClip);
        
        if (scrolled <= fadeStart) {
            heroContent.style.opacity = 1;
        } else if (scrolled >= fadeEnd) {
            heroContent.style.opacity = 0;
            heroContent.style.pointerEvents = 'none'; // Disable interaction when fully faded
        } else {
            // Linear fade between fadeStart and fadeEnd
            const opacity = 1 - ((scrolled - fadeStart) / (fadeEnd - fadeStart));
            heroContent.style.opacity = opacity;
            heroContent.style.pointerEvents = 'auto';
        }

        subtitle.style.clipPath = `inset(0 0 ${clippedAmount}px 0)`;
        subtitle.style.webkitClipPath = `inset(0 0 ${clippedAmount}px 0)`;
    }

    updateHeroFade();
    window.addEventListener('scroll', updateHeroFade, { passive: true });
    window.addEventListener('resize', updateHeroFade);
    mobileQuery.addEventListener('change', updateHeroFade);
});
