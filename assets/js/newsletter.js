/* =============================================================================
   newsletter.js — das Anmeldefeld im Fuß jeder Seite.

   ES ERSCHEINT ERST, WENN ES ETWAS TAUGT. Ohne Ablage und ohne Postausgang
   antwortet der Server mit 503, und dann bleibt der Kasten verborgen. Ein
   Formular, das beim Abschicken sagt "geht gerade nicht", ist schlimmer als
   keins: es hat vorher so ausgesehen, als ginge es.

   Gefragt wird über /api/v1/public/newsletter/status. Vorher stand hier eine
   leere Anmeldung als Probe, und die kam als roter 400 in der Konsole jedes
   Besuchers an. Eine Frage, die eine Frage ist, kostet nichts.

   KEIN <script> IM MARKUP: die Content Security Policy blockt Inline-Skripte
   still, siehe chain-page.js.
   ============================================================================= */

(function () {
  'use strict';

  var kasten = document.querySelector('.foot-brief');
  if (!kasten) return;

  var form = kasten.querySelector('form');
  var feld = kasten.querySelector('input[type="email"]');
  var knopf = kasten.querySelector('button');
  var melder = kasten.querySelector('[data-brief-status]');
  var WEG = '/api/v1/public/newsletter/subscribe';

  function sag(text, schlimm) {
    melder.textContent = text || '';
    melder.style.color = schlimm ? 'var(--bad)' : 'var(--grey-2)';
  }

  /* Ist der Dienst da? */
  fetch('/api/v1/public/newsletter/status')
    .then(function (antwort) { return antwort.ok ? antwort.json() : null; })
    .then(function (daten) {
      /* Flach, nicht in einem data-Umschlag: siehe lib/http.js. */
      if (daten && daten.available) kasten.hidden = false;
    })
    .catch(function () { /* kein Netz, kein Kasten */ });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();

    var adresse = (feld.value || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adresse)) {
      sag('Diese Adresse sieht nicht wie eine E-Mail-Adresse aus.', true);
      feld.focus();
      return;
    }

    knopf.disabled = true;
    sag('Moment.');

    fetch(WEG, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adresse, source: 'footer' })
    })
      .then(function (antwort) {
        return antwort.json().catch(function () { return {}; }).then(function (daten) {
          if (!antwort.ok) {
            throw new Error((daten.message) || 'Das hat gerade nicht geklappt.');
          }
          return daten;
        });
      })
      .then(function () {
        /* Immer dieselbe Auskunft, egal ob neu oder längst dabei: sonst
           verrät dieses Feld, wer auf dem Verteiler steht. */
        form.hidden = true;
        sag('Fast geschafft. In deinem Postfach liegt eine Mail mit einem Link, '
          + 'den du einmal anklicken musst.');
      })
      .catch(function (fehler) {
        sag(fehler.message, true);
      })
      .then(function () { knopf.disabled = false; });
  });
})();
