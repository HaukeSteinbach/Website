/**
 * Shared chrome for every page: the collapsed navigation, the sticky top
 * bar and the amplitude tick rail.
 *
 * Replaces the older navbar.js, which drove a different markup
 * (.nav-toggle / .nav-menu) and is gone.
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Collapsed navigation
     ---------------------------------------------------------------------- */
  function initNav() {
    var burger = document.querySelector('.burger');
    var nav = document.getElementById('nav');
    if (!burger || !nav) return;

    /* The tick rail is position:fixed on the body, so the panel — absolute
       inside the bar — sits in a stacking context that cannot reach over it,
       whatever z-index it carries. Marking the body instead lets the
       stylesheet take the rail out of the way while the panel is open. */
    function setOpen(open) {
      nav.classList.toggle('open', open);
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function close() {
      setOpen(false);
    }

    burger.addEventListener('click', function () {
      setOpen(!nav.classList.contains('open'));
    });

    /* tapping a destination closes the panel */
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
  }

  /* ----------------------------------------------------------------------
     Sticky top bar
     ----------------------------------------------------------------------
     The bar rides along, but scrolling down slides it out of the way so the
     layout stays as edge to edge as it was designed. Scrolling up is the
     gesture of someone who wants to navigate, so any upward movement brings
     it back at once. The long pages run to twelve screens, which is a long
     way back to a bar that only sits at the very top.
     ---------------------------------------------------------------------- */
  function initBar() {
    var bar = document.querySelector('.bar');
    if (!bar) return;
    var nav = document.getElementById('nav');

    var last = window.scrollY;
    var queued = false;

    /* Below this, a movement counts as noise: trackpad jitter and the rubber
       banding at either end of the page would otherwise flip the bar back and
       forth. `last` is deliberately left alone in that case, so a slow but
       deliberate scroll still accumulates past the threshold. */
    var NOISE = 6;

    function update() {
      queued = false;
      var y = Math.max(0, window.scrollY);

      bar.classList.toggle('bar-stuck', y > 8);

      /* the collapsed panel hangs off the bar, so hiding one hides the other */
      if (nav && nav.classList.contains('open')) {
        bar.classList.remove('bar-hidden');
        last = y;
        return;
      }

      var delta = y - last;
      if (Math.abs(delta) < NOISE) return;

      /* within the first bar height there is nothing to uncover yet */
      if (y <= bar.offsetHeight) {
        bar.classList.remove('bar-hidden');
      } else {
        bar.classList.toggle('bar-hidden', delta > 0);
      }
      last = y;
    }

    function onScroll() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    /* a keyboard user tabbing into the nav must not be left looking at a bar
       that has scrolled away */
    bar.addEventListener('focusin', function () {
      bar.classList.remove('bar-hidden');
    });

    update();
  }

  /* ----------------------------------------------------------------------
     Tick rail
     ----------------------------------------------------------------------
     Purely decorative, so it is built here rather than repeated as twenty
     elements in every page. The lengths only hint at an amplitude reading —
     it is deliberately not a drawn waveform. --w is scaled by --tick in the
     stylesheet, which shrinks the whole set on small screens.
     ---------------------------------------------------------------------- */
  var TICKS = [12, 18, 26, 20, 30, 24, 14, 22, 32, 26, 18, 28, 20, 12, 24, 30, 22, 16, 20, 14];

  function initRail() {
    var rail = document.querySelector('.rail');
    if (!rail) return;

    var frag = document.createDocumentFragment();
    TICKS.forEach(function (w) {
      var tick = document.createElement('i');
      tick.style.setProperty('--w', w);
      frag.appendChild(tick);
    });
    rail.appendChild(frag);

    /* The rail starts BELOW the bar. Its height is not a fixed number — it
       comes from the padding plus the nav line, and it changes with the
       breakpoints — so it is measured rather than guessed and handed to the
       stylesheet as --bar-h. Measured again on resize, because the nav wraps
       on narrow screens. Without this the first ticks sit behind the bar,
       which draws them over the black backdrop (rail z-index 60, bar 50). */
    /* Not just .bar: some pages stack a second sticky nav under it (the
       Chain page has .chain-nav). So the whole stack is walked from the top
       edge downwards — each strip must start where the one above ended, which
       is what keeps an unrelated fixed element, say a cookie bar in the
       middle of the screen, from pushing the rail down. */
    var kleber = [];
    function kleberSammeln() {
      kleber = Array.prototype.filter.call(document.querySelectorAll('body *'), function (e) {
        if (e.classList.contains('rail')) return false;
        var p = getComputedStyle(e).position;
        return p === 'fixed' || p === 'sticky';
      });
    }
    function kopfhoehe() {
      var alle = kleber.filter(function (e) {
        return e.getBoundingClientRect().height > 0;
      });
      var unten = 0;
      for (var runde = 0; runde < 5; runde += 1) {
        var weiter = false;
        for (var i = 0; i < alle.length; i += 1) {
          var r = alle[i].getBoundingClientRect();
          if (Math.abs(r.top - unten) <= 2 && r.bottom > unten) {
            unten = Math.round(r.bottom); weiter = true; break;
          }
        }
        if (!weiter) break;
      }
      return unten;
    }
    /* Measured on every scroll, not once on load: the Chain page has a second
       nav that only sticks further down, and the top bar hides itself when you
       scroll away. The stack is therefore not a fixed number. Only written
       when it actually changed, so the browser does not restyle for nothing. */
    var letzteHoehe = -1;
    function railUnterDieLeiste() {
      var h = kopfhoehe();
      if (h === letzteHoehe) return;
      letzteHoehe = h;
      document.documentElement.style.setProperty('--bar-h', h + 'px');
    }
    kleberSammeln();
    railUnterDieLeiste();
    window.addEventListener('scroll', railUnterDieLeiste, { passive: true });
    window.addEventListener('resize', function () {
      kleberSammeln(); letzteHoehe = -1; railUnterDieLeiste();
    });

    var ticks = Array.prototype.slice.call(rail.children);

    /* the live tick only changes colour; changing its length would break the
       contour the varying widths draw */
    function mark() {
      var max = document.body.scrollHeight - window.innerHeight;
      var progress = max > 0 ? window.scrollY / max : 0;
      var index = Math.min(ticks.length - 1, Math.round(progress * (ticks.length - 1)));
      ticks.forEach(function (tick, i) {
        tick.classList.toggle('on', i === index);
      });
    }

    mark();
    window.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', mark);
  }

  /* ----------------------------------------------------------------------
     Current page marker
     ----------------------------------------------------------------------
     Marks the .nav-item for the page you are on, so no page needs to carry
     a hand-set class of its own.
     ---------------------------------------------------------------------- */
  function markCurrent() {
    var here = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav > .nav-item').forEach(function (link) {
      if (link.getAttribute('href') === here) link.classList.add('on');
    });
  }

  function init() {
    initNav();
    initBar();
    initRail();
    markCurrent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
