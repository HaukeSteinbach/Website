/* =============================================================================
   account.js — Anmelden mit Code, danach die eigenen Käufe.

   Drei Zustände, immer genau einer sichtbar: Adresse, Code, Käufe. Beim Laden
   wird zuerst gefragt, ob schon eine Sitzung besteht; wer gestern angemeldet
   war, landet also direkt bei seinen Käufen und tippt nichts.

   KEIN <script> IM MARKUP. Der Server schickt eine Content Security Policy mit
   script-src 'self' und ohne 'unsafe-inline'. Ein Block in der Seite würde
   still blockiert, und still heißt hier: die Anmeldung tut einfach nichts.
   ============================================================================= */

(function () {
  'use strict';

  var API = '/api/v1/account';

  var teile = {
    adresse: document.getElementById('schritt-adresse'),
    code: document.getElementById('schritt-code'),
    kaeufe: document.getElementById('schritt-kaeufe')
  };
  var feldAdresse = document.getElementById('feld-adresse');
  var feldCode = document.getElementById('feld-code');
  var meldung = document.getElementById('meldung');
  var liste = document.getElementById('kaeufe');
  var wer = document.getElementById('angemeldet-als');

  if (!teile.adresse || !teile.code || !teile.kaeufe) return;

  /* Die Aufforderung aus Schritt eins, damit Schritt zwei sie wieder benutzen
     kann, wenn der Code nicht stimmt. */
  var challenge = '';
  var adresse = '';

  function zeige(name) {
    Object.keys(teile).forEach(function (k) { teile[k].hidden = (k !== name); });
  }

  function sag(text, schlimm) {
    meldung.textContent = text || '';
    meldung.style.color = schlimm ? 'var(--bad)' : 'var(--grey-2)';
  }

  /* Ein Aufruf, eine Fehlerbehandlung. Der Server antwortet immer mit
     { ok, data } oder { ok:false, error:{ message } }, also wird hier genau
     das ausgepackt und nichts geraten. */
  async function ruf(pfad, körper) {
    var antwort = await fetch(API + pfad, {
      method: körper ? 'POST' : 'GET',
      headers: körper ? { 'Content-Type': 'application/json' } : undefined,
      body: körper ? JSON.stringify(körper) : undefined,
      credentials: 'same-origin'
    });

    var daten = null;
    try { daten = await antwort.json(); } catch (e) { daten = null; }

    if (!antwort.ok) {
      var grund = (daten && daten.error && daten.error.message)
        || 'Das hat gerade nicht geklappt. Versuch es später noch einmal.';
      var fehler = new Error(grund);
      fehler.status = antwort.status;
      throw fehler;
    }

    return (daten && daten.data) || {};
  }

  /* --------------------------------------------------------------------
     Die Käufe zeichnen
     -------------------------------------------------------------------- */

  function datum(iso) {
    try {
      return new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' })
        .format(new Date(iso));
    } catch (e) {
      return '';
    }
  }

  function knopfleiste(downloads) {
    /* Aufklappen statt einer Reihe von Knöpfen: vier Zeilen für ein Produkt
       drücken den Schlüssel aus dem Bild, und der ist der Grund, warum
       jemand hier ist. Zu ist der Ausgangszustand. */
    if (!downloads.length) {
      return '<p class="note" style="margin-top:1rem;color:var(--grey-3)">'
        + 'Die Dateien werden gerade bereitgestellt. Sobald sie liegen, stehen sie hier.</p>';
    }

    var zeilen = downloads.map(function (d) {
      return '<a class="konto-datei" href="' + d.url + '" rel="noopener">'
        + '<span>' + d.label + '</span>'
        + '<span class="konto-pfeil" aria-hidden="true">&#8595;</span></a>';
    }).join('');

    return '<details class="konto-klapp"><summary>Download und Handbuch</summary>'
      + '<div class="konto-dateien">' + zeilen + '</div></details>';
  }

  function zeichne(bestellungen) {
    if (!bestellungen.length) {
      liste.innerHTML = '<p class="copy">Zu dieser Adresse liegt kein Kauf vor.</p>';
      return;
    }

    liste.innerHTML = bestellungen.map(function (b) {
      var schluessel = b.licenceKey
        ? '<div class="konto-schluessel">'
          + '<span class="konto-schluessel-titel">Lizenzschl&uuml;ssel</span>'
          + '<code id="key-' + b.invoiceNumber + '">' + b.licenceKey + '</code>'
          + '<button type="button" class="konto-kopie" data-kopie="' + b.licenceKey + '">Kopieren</button>'
          + '</div>'
          /* Der Satz steht bewusst hier und nicht im Handbuch: er nimmt die
             häufigste Rückfrage vorweg, nämlich wo man den Schlüssel einträgt
             und warum die Demo schon alles kann. */
          + '<p class="note" style="margin-top:.75rem">Die Demo ist die vollst&auml;ndige Fassung. '
          + 'Installieren, Schl&uuml;ssel einmal eintragen, fertig. Gepr&uuml;ft wird er auf deinem Rechner.</p>'
        : '';

      var rechnung = b.invoiceUrl
        ? '<a class="konto-link" href="' + b.invoiceUrl + '" rel="noopener">Rechnung ' + b.invoiceNumber + ' als PDF</a>'
        : '<span class="note" style="color:var(--grey-3)">Rechnung ' + b.invoiceNumber + '</span>';

      return '<article class="konto-kauf">'
        + '<h2 class="konto-produkt">' + (b.product && b.product.name ? b.product.name : 'Kauf') + '</h2>'
        + '<p class="mono konto-wann">' + datum(b.boughtAt) + '</p>'
        + schluessel
        + knopfleiste(b.downloads || [])
        + '<p style="margin-top:1.25rem">' + rechnung + '</p>'
        + '</article>';
    }).join('');
  }

  /* Kopieren: eine Bestätigung am Knopf selbst, keine Meldung woanders auf
     der Seite, sonst sucht man sie. */
  liste.addEventListener('click', function (ev) {
    var knopf = ev.target.closest('[data-kopie]');
    if (!knopf) return;

    var text = knopf.getAttribute('data-kopie');
    var fertig = function () {
      var alt = knopf.textContent;
      knopf.textContent = 'Kopiert';
      setTimeout(function () { knopf.textContent = alt; }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(fertig, function () {});
      return;
    }

    /* Ohne Zwischenablage-Recht: markieren, dann kann man selbst kopieren. */
    var feld = document.getElementById('key-' + knopf.previousElementSibling.id);
    var ziel = knopf.parentElement.querySelector('code');
    if (ziel) {
      var bereich = document.createRange();
      bereich.selectNodeContents(ziel);
      var auswahl = window.getSelection();
      auswahl.removeAllRanges();
      auswahl.addRange(bereich);
    }
    void feld;
  });

  /* --------------------------------------------------------------------
     Ablauf
     -------------------------------------------------------------------- */

  async function ladeKaeufe() {
    var daten = await ruf('/me');
    adresse = daten.email || adresse;
    wer.textContent = 'Angemeldet als ' + adresse;
    zeichne(daten.orders || []);
    zeige('kaeufe');
    sag('');
  }

  document.getElementById('form-adresse').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var knopf = document.getElementById('knopf-adresse');
    adresse = (feldAdresse.value || '').trim().toLowerCase();

    knopf.disabled = true;
    sag('Code wird verschickt.');

    try {
      var daten = await ruf('/request-code', { email: adresse });
      challenge = daten.challenge;
      zeige('code');
      sag('');
      feldCode.focus();
    } catch (fehler) {
      sag(fehler.message, true);
    } finally {
      knopf.disabled = false;
    }
  });

  document.getElementById('form-code').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var knopf = document.getElementById('knopf-code');

    knopf.disabled = true;
    sag('Code wird geprüft.');

    try {
      await ruf('/verify', {
        email: adresse,
        code: (feldCode.value || '').trim(),
        challenge: challenge
      });
      feldCode.value = '';
      await ladeKaeufe();
    } catch (fehler) {
      sag(fehler.message, true);
      /* Ein abgelaufener Code ist kein Tippfehler: dann zurück auf Anfang,
         sonst tippt man in ein Feld, das nichts mehr annehmen kann. */
      if (fehler.status === 400) {
        challenge = '';
        zeige('adresse');
      }
    } finally {
      knopf.disabled = false;
    }
  });

  document.getElementById('andere-adresse').addEventListener('click', function () {
    challenge = '';
    feldCode.value = '';
    zeige('adresse');
    sag('');
    feldAdresse.focus();
  });

  document.getElementById('abmelden').addEventListener('click', async function () {
    try { await ruf('/signout', {}); } catch (e) { /* egal */ }
    adresse = '';
    challenge = '';
    liste.innerHTML = '';
    feldAdresse.value = '';
    zeige('adresse');
    sag('Du bist abgemeldet.');
  });

  /* Beim Laden: besteht schon eine Sitzung? 401 ist hier keine Störung,
     sondern die normale Antwort für alle, die noch nicht angemeldet sind. */
  ladeKaeufe().catch(function () {
    zeige('adresse');
  });
})();
