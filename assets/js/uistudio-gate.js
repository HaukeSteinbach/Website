/**
 * Anmeldung für das UI Studio von Steinbach Audio.
 *
 * Das Werkzeug selbst liegt nicht in diesem Repository. Es steht im privaten
 * Storage bei Supabase und wird von der Edge Function `cockpit-content` mit
 * `?doc=uistudio-audio` ausgeliefert — nur an Konten, die in
 * UISTUDIO_AUDIO_ALLOWED stehen. Diese Seite ist das Tor davor: sie meldet an
 * und schreibt das Werkzeug danach in dieses Dokument.
 *
 * Warum nicht der Node-Server dieser Seite mit seinem Admin-Passwort: dort
 * liegen die Kundenprojekte. Jakob soll an die Oberflächen, nicht an die
 * Kundendateien, also hängt das Studio an der Team-Anmeldung bei Supabase —
 * derselben, über die schon die Werbung läuft.
 *
 * Ausgelagert statt inline, weil die CSP dieser Seite nur eigene Skripte
 * erlaubt (script-src 'self').
 */
(function () {
  'use strict';

  var store = window.SteinbachStore;
  var el = function (id) { return document.getElementById(id); };

  var INHALT = function () {
    return window.STORE_CONFIG.supabaseUrl + '/functions/v1/cockpit-content?doc=uistudio-audio';
  };

  function zeige(welche) {
    ['studio-laden', 'studio-anmelden', 'studio-abgelehnt'].forEach(function (id) {
      el(id).hidden = id !== welche;
    });
  }

  /* Gleiche Mechanik wie in assets/js/admin.js: .handoff-status ist ohne
     .is-visible ausgeblendet, sonst stünde hier dauerhaft eine leere Zeile. */
  function fehler(text) {
    var box = el('studio-fehler');
    box.textContent = text || '';
    box.className = 'handoff-status' + (text ? ' is-visible error' : '');
  }

  /**
   * Angemeldet? Dann das Werkzeug holen und das Tor durch es ersetzen.
   *
   * Der Abbruch nach 12 s ist da, damit niemand in „Zugang wird geprüft"
   * hängen bleibt: die Datei ist ein gutes Stück groß, aber wenn nach zwölf
   * Sekunden nichts da ist, stimmt etwas nicht, und dann ist ein Anmeldefeld
   * hilfreicher als ein Wartetext.
   */
  function pruefen() {
    var fertig = false;
    var abbruch = setTimeout(function () {
      if (fertig) return;
      fertig = true;
      zeige('studio-anmelden');
      fehler('Das hat zu lange gedauert. Bitte noch einmal anmelden.');
    }, 12000);

    var aufgeben = function (text) {
      if (fertig) return;
      fertig = true;
      clearTimeout(abbruch);
      zeige('studio-anmelden');
      fehler(text);
    };

    store.getSession().then(function (s) {
      if (!s) { aufgeben(''); return; }

      return fetch(INHALT(), {
        headers: {
          'apikey': window.STORE_CONFIG.supabaseAnonKey,
          'Authorization': 'Bearer ' + s.access_token
        }
      }).then(function (res) {
        if (fertig) return null;
        if (res.status === 403) {
          fertig = true;
          clearTimeout(abbruch);
          zeige('studio-abgelehnt');
          el('studio-abmelden').hidden = false;
          return null;
        }
        if (!res.ok) {
          aufgeben('Die Anmeldung ist abgelaufen. Bitte noch einmal anmelden.');
          return null;
        }
        return res.text();
      }).then(function (html) {
        if (!html || fertig) return;
        fertig = true;
        clearTimeout(abbruch);
        /* Dasselbe Vorgehen wie bei Steinbach Instruments: das Werkzeug ist
           eine vollständige HTML-Datei und ersetzt diese Seite komplett. */
        document.open();
        document.write(html);
        document.close();
      });
    }).catch(function () {
      aufgeben('Verbindung fehlgeschlagen. Bitte noch einmal versuchen.');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!store || !window.STORE_CONFIG || !window.STORE_CONFIG.supabaseUrl) {
      el('studio-laden').textContent = 'Die Team-Anmeldung ist auf dieser Seite nicht eingerichtet.';
      return;
    }

    var adresse = '';

    el('studio-mail-form').addEventListener('submit', function (e) {
      e.preventDefault();
      fehler('');
      adresse = el('studio-mail').value.trim().toLowerCase();
      store.requestCode(adresse).then(function () {
        el('studio-mail-form').hidden = true;
        el('studio-code-form').hidden = false;
        el('studio-code').focus();
      }).catch(function (err) { fehler(err.message); });
    });

    el('studio-code-form').addEventListener('submit', function (e) {
      e.preventDefault();
      fehler('');
      store.verifyCode(adresse, el('studio-code').value.trim()).then(function () {
        zeige('studio-laden');
        pruefen();
      }).catch(function (err) { fehler(err.message); });
    });

    el('studio-abmelden').addEventListener('click', function () {
      store.signOut().then(function () { window.location.reload(); });
    });

    pruefen();
  });
})();
