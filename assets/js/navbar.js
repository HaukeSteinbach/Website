/**
 * Navbar Scroll Effect + Dropdown
 * Adds milky transparent effect to navbar when scrolling
 * Handles "More" dropdown menu toggling
 */

document.addEventListener('DOMContentLoaded', function() {
    const navbar = document.querySelector('.navbar');
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');
    const mobileQuery = window.matchMedia('(max-width: 768px)');

    // ── Dropdown handling ──────────────────────────────────
    document.querySelectorAll('.nav-item-dropdown').forEach(function(item) {
        const trigger = item.querySelector('.nav-dropdown-trigger');
        if (!trigger) return;

        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = item.classList.toggle('open');
            trigger.setAttribute('aria-expanded', String(isOpen));

            // Close other open dropdowns
            document.querySelectorAll('.nav-item-dropdown.open').forEach(function(other) {
                if (other !== item) {
                    other.classList.remove('open');
                    const otherTrigger = other.querySelector('.nav-dropdown-trigger');
                    if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
                }
            });
        });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.nav-item-dropdown')) {
            document.querySelectorAll('.nav-item-dropdown.open').forEach(function(item) {
                item.classList.remove('open');
                const trigger = item.querySelector('.nav-dropdown-trigger');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            });
        }
    });

    // Close dropdowns when a dropdown link is clicked
    document.querySelectorAll('.nav-dropdown-menu a').forEach(function(link) {
        link.addEventListener('click', function() {
            document.querySelectorAll('.nav-item-dropdown.open').forEach(function(item) {
                item.classList.remove('open');
                const trigger = item.querySelector('.nav-dropdown-trigger');
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
            });
        });
    });
    // ── End dropdown handling ──────────────────────────────

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

    // ── Scroll: hide navbar on scroll-down, show on scroll-up ─────────
    var lastScrollY  = window.scrollY;
    var HIDE_THRESH  = 80;  // px from top before hide kicks in

    window.addEventListener('scroll', function () {
        var currentY = window.scrollY;

        // Scrolled badge
        if (currentY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        // Always show near the top
        if (currentY <= HIDE_THRESH) {
            navbar.classList.remove('navbar-hidden');
        } else if (currentY > lastScrollY + 4) {
            // Scrolling down
            navbar.classList.add('navbar-hidden');
            // Close open dropdowns so they don't float off-screen
            document.querySelectorAll('.nav-item-dropdown.open').forEach(function (item) {
                item.classList.remove('open');
                var t = item.querySelector('.nav-dropdown-trigger');
                if (t) t.setAttribute('aria-expanded', 'false');
            });
        } else if (currentY < lastScrollY - 4) {
            // Scrolling up
            navbar.classList.remove('navbar-hidden');
        }

        lastScrollY = currentY;
    }, { passive: true });
});