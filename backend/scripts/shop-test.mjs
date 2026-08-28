/**
 * npm run shop-test
 *
 * Walks a purchase against the real backend: checkout, the paid webhook, the
 * invoice, the buyer's return page, and the studio marking it posted.
 *
 * Stripe itself is replaced by a stub — the point is our own handling of what
 * Stripe sends, not Stripe. The webhook signature is computed exactly as
 * Stripe computes it, so the verification path is the real one.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';
import { createMiniStripe } from './mini-stripe.mjs';

const S3 = 9911, APP = 9912, STRIPE = 9913;
const WEBHOOK_SECRET = 'whsec_testsecret';

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'shoptest';
process.env.S3_ACCESS_KEY = 'a';
process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto';
process.env.SESSION_SECRET = 's'.repeat(48);
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`;
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_API_BASE = `http://127.0.0.1:${STRIPE}`;
process.env.SMTP_HOST = '';
process.env.FORMSPREE_UPLOAD_ENDPOINT = '';

const { scryptSync } = await import('node:crypto');
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;

const { objects } = await createMiniS3(S3);

/* Nur Stripes Netzwerkseite wird ersetzt; die Bibliothek selbst läuft echt,
   inklusive ihrer Signaturprüfung im Webhook. */
const SESSION = {
  id: 'cs_test_abc123',
  object: 'checkout.session',
  payment_status: 'paid',
  payment_intent: 'pi_test_1',
  amount_total: 3490,
  currency: 'eur',
  payment_method_types: ['card'],
  metadata: { product_slug: 'reclight' },
  total_details: { amount_shipping: 490 },
  customer_details: {
    email: 'kaeufer@example.com',
    name: 'Jette Julia Müller-Groß',
    address: { line1: 'Beispielstraße 12a', line2: '', postal_code: '20095', city: 'Hamburg', country: 'DE' }
  },
  shipping_details: {
    name: 'Jette Julia Müller-Groß',
    address: { line1: 'Beispielstraße 12a', line2: 'Hinterhaus', postal_code: '20095', city: 'Hamburg', country: 'DE' }
  }
};

const { gesehen } = await createMiniStripe(STRIPE, SESSION);

const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}`;

const pass = [], fail = [];
const check = (name, fn) => { try { fn(); pass.push(name); } catch (e) { fail.push(`${name}: ${e.message}`); } };

let cookie = '';
async function call(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { ...options, headers, redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, payload: type.includes('json') ? await res.json() : await res.text() };
}

function signed(payload) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

try {
  /* ---- what the page asks before showing a buy button ---- */
  const produkt = await call('/api/v1/public/shop/products/reclight');
  check('Produktangaben kommen vom Server, nicht aus dem Browser', () => {
    assert.equal(produkt.status, 200);
    assert.equal(produkt.payload.priceCents, 3000);
    assert.equal(produkt.payload.available, true);
    assert.equal(produkt.payload.testMode, true);
  });

  const unbekannt = await call('/api/v1/public/shop/products/gibtsnicht');
  check('unbekanntes Produkt gibt 404', () => assert.equal(unbekannt.status, 404));

  /* ---- checkout ---- */
  const checkout = await call('/api/v1/public/shop/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: 'reclight' })
  });
  check('Checkout liefert eine Stripe-URL', () => {
    assert.equal(checkout.status, 200);
    assert.match(checkout.payload.url, /^https:\/\/checkout\.stripe\.com/);
  });
  const p = gesehen.checkoutParams;
  check('Preis kommt aus dem Katalog, nicht aus dem Browser', () =>
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '3000'));
  check('zwei Versandoptionen', () =>
    assert.ok(p.get('shipping_options[1][shipping_rate_data][fixed_amount][amount]')));
  check('Lieferländer werden mitgegeben', () =>
    assert.ok([...p.keys()].some((k) => k.startsWith('shipping_address_collection'))));
  check('§ 19 UStG und Widerruf stehen vor dem Bezahlknopf', () => {
    const m = p.get('custom_text[submit][message]');
    assert.match(m, /§ 19 UStG/);
    assert.match(m, /Widerruf/);
  });

  const falschesProdukt = await call('/api/v1/public/shop/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: 'gibtsnicht' })
  });
  check('Checkout für ein fremdes Produkt wird abgelehnt', () => assert.equal(falschesProdukt.status, 400));

  /* ---- webhook ---- */
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: SESSION } });

  const ohneSignatur = await call('/api/v1/public/shop/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body
  });
  check('Webhook ohne gültige Signatur wird abgewiesen', () => assert.equal(ohneSignatur.status, 400));

  const webhook = await call('/api/v1/public/shop/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signed(body) }, body
  });
  check('Webhook mit gültiger Signatur wird angenommen', () => assert.equal(webhook.status, 200));

  const nochmal = await call('/api/v1/public/shop/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signed(body) }, body
  });
  check('Wiederholung erzeugt keine zweite Bestellung', () => assert.equal(nochmal.status, 200));

  /* ---- ein Kauf aus dem anderen Shop ---- */
  const FREMD = {
    ...SESSION,
    id: 'cs_test_instruments',
    amount_total: 4900,
    total_details: { amount_shipping: 0 },
    metadata: { product_slug: 'historic-organ' }
  };
  const fremdBody = JSON.stringify({ type: 'checkout.session.completed', data: { object: FREMD } });
  const fremdAntwort = await call('/api/v1/public/shop/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signed(fremdBody) },
    body: fremdBody
  });
  check('ein Kauf aus dem Instruments-Shop wird angenommen und ignoriert', () => {
    assert.equal(fremdAntwort.status, 200);
    assert.equal(fremdAntwort.payload.ignored, 'other_shop');
  });

  /* ---- was gespeichert wurde ---- */
  const keys = [...objects.keys()];
  check('Bestellung und Rechnung liegen im Bucket', () => {
    assert.ok(keys.includes('orders/index.json'));
    assert.ok(keys.some((k) => k.endsWith('.pdf')), 'kein PDF gefunden');
  });

  const index = JSON.parse(objects.get('orders/index.json').body.toString());
  check('genau eine Bestellung trotz zweier Webhooks', () => assert.equal(index.orders.length, 1));
  check('der fremde Kauf hat keine Bestellung und keine Rechnungsnummer erzeugt', () => {
    assert.ok(!index.orders.some((o) => o.stripeSessionId === 'cs_test_instruments'));
    assert.equal(Object.values(index.invoiceCounters).reduce((a, b) => a + b, 0), 1);
  });

  const order = index.orders[0];
  check('Beträge stimmen', () => {
    assert.equal(order.itemCents, 3000);
    assert.equal(order.shippingCents, 490);
    assert.equal(order.totalCents, 3490);
  });
  check('Rechnungsnummer im Format YYYY-MM-DD-NNNN', () =>
    assert.match(order.invoiceNumber, /^\d{4}-\d{2}-\d{2}-\d{4}$/));
  check('Lieferadresse ist vollständig', () => {
    assert.equal(order.buyer.name, 'Jette Julia Müller-Groß');
    assert.equal(order.buyer.postalCode, '20095');
    assert.equal(order.buyer.country, 'Deutschland');
    assert.equal(order.buyer.email, 'kaeufer@example.com');
  });
  check('ohne Mailserver wird das ehrlich vermerkt', () => assert.equal(order.mailSentAt, null));

  const pdfKey = keys.find((k) => k.endsWith('.pdf'));
  check('das PDF ist ein PDF', () =>
    assert.equal(objects.get(pdfKey).body.subarray(0, 5).toString(), '%PDF-'));

  /* ---- die Rückkehr des Käufers ---- */
  const rueckkehr = await call(`/api/v1/public/shop/order/${SESSION.id}`);
  check('Bestätigungsseite findet die Bestellung', () => {
    assert.equal(rueckkehr.status, 200);
    assert.equal(rueckkehr.payload.invoiceNumber, order.invoiceNumber);
    assert.equal(rueckkehr.payload.totalCents, 3490);
  });
  check('sie verrät keine vollständige Adresse', () => {
    assert.equal(rueckkehr.payload.buyer, undefined);
    assert.equal(rueckkehr.payload.line1, undefined);
    assert.equal(rueckkehr.payload.city, 'Hamburg');
  });

  const fremd = await call('/api/v1/public/shop/order/cs_test_gibtsnicht');
  check('eine erfundene Session findet nichts', () => assert.equal(fremd.status, 404));

  /* ---- Studio ---- */
  const zu = await call('/api/v1/admin/orders');
  check('Bestellliste ist ohne Anmeldung zu', () => assert.equal(zu.status, 401));

  await call('/api/v1/admin/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'einLangesPasswort2026' })
  });

  const liste = await call('/api/v1/admin/orders');
  check('Bestellung erscheint in der Liste', () => {
    assert.equal(liste.status, 200);
    assert.equal(liste.payload.orders.length, 1);
    assert.equal(liste.payload.counts.toShip, 1);
    assert.equal(liste.payload.counts.revenueCents, 3490);
  });

  const rechnung = await call(`/api/v1/admin/orders/${order.id}/invoice`);
  check('Rechnung ist herunterladbar', () => {
    assert.equal(rechnung.status, 200);
    assert.match(rechnung.payload.url, /^http/);
  });

  const versandt = await call(`/api/v1/admin/orders/${order.id}/shipped`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'DHL 00340434161094042557' })
  });
  check('als versandt markieren funktioniert', () => {
    assert.equal(versandt.status, 200);
    assert.equal(versandt.payload.order.status, 'shipped');
    assert.equal(versandt.payload.order.trackingNote, 'DHL 00340434161094042557');
  });

  const danach = await call('/api/v1/admin/orders');
  check('danach steht nichts mehr zum Versand an', () => assert.equal(danach.payload.counts.toShip, 0));
} catch (error) {
  fail.push('Lauf: ' + (error.stack || error.message));
} finally {
  server.close();
  console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen\n`);
  pass.forEach((n) => console.log('  ok   ' + n));
  fail.forEach((n) => console.log('  FAIL ' + n));
  process.exit(fail.length ? 1 : 0);
}
