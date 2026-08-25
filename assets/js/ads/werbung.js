/**
 * Anmeldung und Einhängen der Anzeigen-Oberfläche für Steinbach Audio.
 *
 * Die Werbung läuft über denselben Dienst wie bei Steinbach Instruments
 * (ads-api bei Supabase). Damit gibt es hier zwei getrennte Anmeldungen, und
 * das ist Absicht: der Projektbereich dieser Seite gehört dem Node-Server mit
 * seinem eigenen Passwort, die Werbung gehört dem Team-Konto bei Supabase.
 * Beide zu vermischen hieße, dem einen Server die Rechte des anderen zu
 * geben.
 *
 * Ausgelagert statt inline, weil die CSP dieser Seite nur eigene Skripte
 * erlaubt (script-src 'self').
 */
(function () {
  'use strict';

  var store = window.SteinbachStore;
  var el = function (id) { return document.getElementById(id); };

  function zeige(welche) {
    ['ads-laden', 'ads-anmelden', 'ads-abgelehnt', 'ads-inhalt'].forEach(function (id) {
      el(id).hidden = id !== welche;
    });
  }

  function starten() {
    zeige('ads-inhalt');
    window.SteinbachAds.mount(el('ads-behaelter'), { only: 'steinbach-audio' });
    el('ads-abmelden').hidden = false;
  }

  /* Ist schon jemand angemeldet? Ob die Person auch darf, entscheidet der
     Server — die Oberfläche fragt einmal an und richtet sich danach. */
  function pruefen() {
    store.getSession().then(function (s) {
      if (!s) { zeige('ads-anmelden'); return; }
      return fetch(window.STORE_CONFIG.supabaseUrl + '/functions/v1/ads-api', {
        method: 'POST',
        headers: {
          'apikey': window.STORE_CONFIG.supabaseAnonKey,
          'Authorization': 'Bearer ' + s.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'presets' })
      }).then(function (res) {
        if (res.ok) starten();
        else zeige(res.status === 403 ? 'ads-abgelehnt' : 'ads-anmelden');
      });
    }).catch(function () { zeige('ads-anmelden'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!store || !window.STORE_CONFIG || !window.STORE_CONFIG.supabaseUrl) {
      el('ads-laden').textContent = 'Der Anzeigen-Dienst ist auf dieser Seite nicht eingerichtet.';
      return;
    }

    var adresse = '';

    el('ads-mail-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fehler = el('ads-fehler');
      fehler.textContent = '';
      adresse = el('ads-mail').value.trim().toLowerCase();
      store.requestCode(adresse).then(function () {
        el('ads-mail-form').hidden = true;
        el('ads-code-form').hidden = false;
        el('ads-code').focus();
      }).catch(function (err) { fehler.textContent = err.message; });
    });

    el('ads-code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var fehler = el('ads-fehler');
      fehler.textContent = '';
      store.verifyCode(adresse, el('ads-code').value.trim()).then(function () {
        zeige('ads-laden');
        pruefen();
      }).catch(function (err) { fehler.textContent = err.message; });
    });

    el('ads-abmelden').addEventListener('click', function () {
      store.signOut().then(function () { window.location.reload(); });
    });

    pruefen();
  });
})();
