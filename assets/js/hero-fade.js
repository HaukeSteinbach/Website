/**
 * Hero exit on scroll
 * Fades the hero copy out as the hero section scrolls upward.
 */

document.addEventListener('DOMContentLoaded', function() {
    const hero = document.querySelector('.hero');
    const heroContent = document.querySelector('.hero-content');
    const mobileQuery = window.matchMedia('(max-width: 768px)');

    if (!hero || !heroContent) return;

    function resetHeroStyles() {
        heroContent.style.opacity = '1';
        heroContent.style.transform = '';
        heroContent.style.pointerEvents = 'auto';
    }

    function updateHeroFade() {
        if (mobileQuery.matches) {
            resetHeroStyles();
            return;
        }

        const heroRect = hero.getBoundingClientRect();
        const navHeight = 72;
        // scrolledPast: how far the hero top has moved above the nav bottom
        const scrolledPast = navHeight - heroRect.top;
        const fadeRange = hero.offsetHeight * 0.5;

        if (scrolledPast <= 0) {
            resetHeroStyles();
            return;
        }

        const progress = Math.min(1, scrolledPast / fadeRange);
        const opacity = 1 - progress * 0.97;
        const drift = -progress * 20;

        heroContent.style.opacity = String(Math.max(0, opacity));
        heroContent.style.transform = `translateY(${drift}px)`;
        heroContent.style.pointerEvents = opacity < 0.08 ? 'none' : 'auto';
    }

    updateHeroFade();
    window.addEventListener('scroll', updateHeroFade, { passive: true });
    window.addEventListener('resize', updateHeroFade);
    mobileQuery.addEventListener('change', updateHeroFade);
});

