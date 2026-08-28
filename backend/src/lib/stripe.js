/**
 * Stripe.
 *
 * Card details never reach this server: the buyer pays on Stripe's own hosted
 * page and all this side ever learns is "paid" plus the address they typed
 * there. That is also why there are no accounts — there is nothing to log in
 * to, and nothing worth stealing here.
 */

import Stripe from 'stripe';

import { config } from './config.js';

let client = null;

export function isShopConfigured() {
  return Boolean(config.stripeSecretKey);
}

export function isWebhookConfigured() {
  return Boolean(config.stripeWebhookSecret);
}

export function getStripe() {
  if (!isShopConfigured()) {
    const error = new Error('The shop is not configured on this server.');
    error.statusCode = 503;
    error.code = 'shop_not_configured';
    throw error;
  }

  if (!client) {
    /* STRIPE_API_BASE points the real library at a local stand-in, which is how
       the shop can be exercised end to end without a Stripe account. Signature
       verification is unaffected — it runs inside the library either way. Never
       set in production; when it is, the boot log says so. */
    const base = process.env.STRIPE_API_BASE;
    const local = base ? new URL(base) : null;

    client = new Stripe(config.stripeSecretKey, {
      apiVersion: '2024-12-18.acacia',
      ...(local
        ? { host: local.hostname, port: Number(local.port), protocol: local.protocol.replace(':', '') }
        : {})
    });
  }

  return client;
}

/**
 * True while Stripe is in test mode.
 *
 * Worth showing on the page: a test key takes test cards and no real money,
 * and finding that out only when the first real customer's payment vanishes is
 * the wrong moment.
 */
export function isTestMode() {
  return config.stripeSecretKey.startsWith('sk_test_');
}

export function describeShopSetup() {
  if (!isShopConfigured()) {
    return { ok: false, reason: 'no_secret_key', missing: ['STRIPE_SECRET_KEY'] };
  }

  if (!isWebhookConfigured()) {
    return {
      ok: false,
      reason: 'no_webhook_secret',
      missing: ['STRIPE_WEBHOOK_SECRET'],
      note: 'Checkout would work, but a paid order could never be recorded.'
    };
  }

  return { ok: true, mode: isTestMode() ? 'test' : 'live' };
}

/**
 * Pull the buyer out of a completed session.
 *
 * Shipping address if there is one, billing otherwise — for a posted item the
 * two are usually the same, and an invoice needs an address either way.
 */
export function buyerFromSession(session) {
  const shipping = session.shipping_details || session.collected_information?.shipping_details;
  const billing = session.customer_details;
  const address = shipping?.address || billing?.address || {};

  return {
    name: shipping?.name || billing?.name || '',
    email: billing?.email || '',
    line1: address.line1 || '',
    line2: address.line2 || '',
    postalCode: address.postal_code || '',
    city: address.city || '',
    state: address.state || '',
    country: countryName(address.country) || address.country || '',
    countryCode: address.country || '',
    phone: billing?.phone || ''
  };
}

/** ISO code to the German country name the invoice prints. */
function countryName(code) {
  if (!code) return '';

  try {
    return new Intl.DisplayNames(['de'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

/** A human name for how it was paid, for the invoice line. */
export function paymentMethodLabel(session) {
  const types = session.payment_method_types || [];

  const names = {
    card: 'Karte',
    sepa_debit: 'SEPA-Lastschrift',
    paypal: 'PayPal',
    klarna: 'Klarna',
    giropay: 'Giropay',
    sofort: 'Sofortüberweisung',
    link: 'Link'
  };

  return names[types[0]] || 'Karte';
}
