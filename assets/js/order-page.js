/**
 * The page a buyer lands on after paying.
 *
 * Stripe puts the session id in the return URL; that is the only handle there
 * is, because there are no accounts. The server answers with a deliberately
 * thin summary — enough to recognise the purchase, nothing that would matter
 * if the link were forwarded.
 *
 * The webhook and this redirect race each other and the redirect often wins,
 * so a first miss is normal rather than an error. It retries a few times
 * before saying anything worrying.
 */
(function () {
  'use strict';

  var deck = document.getElementById('order-deck');
  var card = document.getElementById('order-card');
  var summary = document.getElementById('order-summary');
  var reference = document.getElementById('order-reference');
  var mailNote = document.getElementById('order-mail-note');
  var status = document.getElementById('order-status');
  if (!deck) return;

  var session = new URLSearchParams(window.location.search).get('session');

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'handoff-status' + (text ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function euro(cents, currency) {
    var value = (cents / 100).toFixed(2).replace('.', ',');
    return currency && currency !== 'eur' ? value + ' ' + currency.toUpperCase() : value + ' €';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  if (!session) {
    deck.textContent = 'This page needs the link from your payment confirmation.';
    setStatus('No order reference in the address.', 'error');
    return;
  }

  var versuche = 0;

  function laden() {
    versuche += 1;

    fetch('/api/v1/public/shop/order/' + encodeURIComponent(session))
      .then(function (response) {
        if (response.status === 404 && versuche < 5) {
          /* Stripe has not told us yet — wait and ask again. */
          window.setTimeout(laden, 1200);
          return null;
        }

        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.message || 'Your order could not be loaded.');
          return data;
        });
      })
      .then(function (order) {
        if (!order) return;

        reference.textContent = 'Invoice ' + order.invoiceNumber;
        deck.textContent = order.buyerName
          ? 'Thanks, ' + order.buyerName.split(' ')[0] + ' — your ' + order.product.name + ' is on its way to ' + order.city + '.'
          : 'Your ' + order.product.name + ' is on its way.';

        summary.innerHTML =
          '<div><dt>Product</dt><dd>' + escapeHtml(order.product.name) + '</dd></div>' +
          '<div><dt>Total</dt><dd>' + euro(order.totalCents, order.currency) + '</dd></div>' +
          '<div><dt>Invoice</dt><dd>' + escapeHtml(order.invoiceNumber) + '</dd></div>';

        mailNote.textContent = order.mailSent
          ? 'The invoice is in your inbox at ' + order.email + '.'
          : 'Your invoice is on its way by email. If nothing arrives within the hour, write to mail@haukesteinbach.de and it gets sent again.';

        card.hidden = false;
        setStatus('');
      })
      .catch(function (error) {
        deck.textContent = 'Your payment went through.';
        setStatus(error.message + ' Your order is safe — write to mail@haukesteinbach.de and it will be sorted.', 'error');
      });
  }

  laden();
})();
