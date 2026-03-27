/**
 * Navbar Scroll Effect
 * Adds milky transparent effect to navbar when scrolling
 */

document.addEventListener('DOMContentLoaded', function() {
    const navbar = document.querySelector('.navbar');
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    
    if (!navbar) return;

    function closeMenu() {
        if (!navToggle) {
            return;
        }

        navbar.classList.remove('menu-open');
        document.body.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
    }

    if (navToggle && navMenu) {
        navToggle.addEventListener('click', function() {
            const isOpen = navbar.classList.toggle('menu-open');
            document.body.classList.toggle('nav-open', isOpen);
            navToggle.setAttribute('aria-expanded', String(isOpen));
        });

        navLinks.forEach(function(link) {
            link.addEventListener('click', closeMenu);
        });

        document.addEventListener('click', function(event) {
            if (!mobileQuery.matches) {
                return;
            }

            if (!navbar.contains(event.target)) {
                closeMenu();
            }
        });

        mobileQuery.addEventListener('change', function(event) {
            if (!event.matches) {
                closeMenu();
            }
        });
    }

    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
});