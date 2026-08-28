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

  /* Is the shop open? */
  fetch('/api/v1/public/shop/products/' + button.dataset.product)
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (product) {
      if (!product || !product.available) return;

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
