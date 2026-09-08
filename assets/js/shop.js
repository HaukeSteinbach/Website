/**
 * The buy button.
 *
 * Asks the server whether the shop is actually open before showing anything.
 * If it is not — no Stripe key, no bucket — the pre-order form stays where it
 * is, which is a working thing to offer rather than a button that fails on
 * click.
 *
 * The click itself hands off to Stripe's hosted page. Nothing about money or
 * card details happens here.
 */
(function () {
  'use strict';

  var buy = document.getElementById('shop-buy');
  var fallback = document.getElementById('shop-fallback');
  var button = document.getElementById('buy-button');
  if (!buy || !button) return;

  var status = document.getElementById('shop-status');

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'handoff-status' + (text ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function euro(cents) {
    return (cents / 100).toFixed(2).replace('.', ',') + ' €';
  }

  /* Die Demo und das Handbuch, falls die Seite einen Platz dafuer hat und der
     Server Adressen nennt. Beides faellt einzeln aus: eine Seite ohne den
     Block bleibt unberuehrt, ein Server ohne Adressen laesst den Hinweis
     stehen, dass die Dateien noch kommen. */
  function zeigeDateien(dateien) {
    var demo = document.getElementById('demo-links');
    if (!demo || !dateien.length) return;

    /* Eine Aufklappliste statt einer Reihe Knoepfe. Drei nebeneinander sahen
       aus wie drei Entscheidungen, dabei ist es eine: das Ding laden. Zu ist
       der Ausgangszustand, aufgeklappt stehen die Dateien untereinander mit
       ihrer Beschriftung, wie im Kontobereich -- dieselben Regeln, damit ein
       Kaeufer die Liste an beiden Orten wiedererkennt. */
    var zeilen = dateien.map(function (d) {
      return '<a class="konto-datei" href="' + d.url + '" rel="noopener">'
        + '<span>' + d.label + '</span>'
        + '<span class="konto-pfeil" aria-hidden="true">&#8595;</span></a>';
    }).join('');

    demo.innerHTML = '<details class="konto-klapp" open>'
      + '<summary>Downloads</summary>'
      + '<div class="konto-dateien">' + zeilen + '</div></details>';
    demo.hidden = false;

    var fehlt = document.getElementById('demo-fehlt');
    if (fehlt) fehlt.hidden = true;
  }

  /* Is the shop open? */
  fetch('/api/v1/public/shop/products/' + button.dataset.product)
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (product) {
      if (!product) return;

      /* ZUERST die Demo, DANN der Kaufknopf. Die beiden haengen an
         verschiedenen Bedingungen: die Dateien liegen, sobald ihre Adressen
         hinterlegt sind, der Kaufknopf braucht zusaetzlich Stripe und die
         Ablage. Stand das hier hinter der Pruefung auf available, verschwand
         mit einem geschlossenen Laden auch der Download -- also genau das,
         was jemand vor dem Kauf haben soll. */
      zeigeDateien(product.downloads || []);

      if (!product.available) return;

      button.textContent = 'Buy for ' + euro(product.priceCents);
      buy.hidden = false;
      if (fallback) fallback.hidden = true;

      if (product.testMode) {
        var note = document.getElementById('shop-test-note');
        if (note) note.hidden = false;
      }


    })
    .catch(function () { /* shop stays hidden, pre-order stays visible */ });

  button.addEventListener('click', function () {
    button.disabled = true;
    setStatus('Taking you to the payment page…');

    fetch('/api/v1/public/shop/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: button.dataset.product })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data.url) {
            throw new Error(data.message || 'The payment page could not be opened.');
          }
          return data.url;
        });
      })
      .then(function (url) { window.location.href = url; })
      .catch(function (error) {
        button.disabled = false;
        setStatus(error.message + ' You can also email mail@haukesteinbach.de.', 'error');
      });
  });
})();
