/**
 * Orders — one record per paid checkout.
 *
 * Same shape as projects.js: a single JSON object in R2, written with an
 * If-Match on its ETag so two webhooks landing together cannot overwrite each
 * other. Stripe retries a webhook until it gets a 2xx, so every write here has
 * to be safe to repeat — `createOrder` is keyed on the Stripe session id and
 * returns the existing record instead of making a second one.
 *
 * No customer accounts: the buyer is whatever Stripe collected at checkout,
 * and that is all that is kept.
 */

import { randomUUID } from 'node:crypto';

import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'orders/index.json';
const WRITE_ATTEMPTS = 5;

export const STATUS = ['paid', 'shipped', 'cancelled', 'refunded'];

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { orders: [], invoiceCounters: {} }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);
    return {
      index: {
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        invoiceCounters: parsed.invoiceCounters || {}
      },
      etag: stored.etag
    };
  } catch (error) {
    /* Never start a fresh index on a parse error — that would turn an
       unreadable file into lost orders. */
    throw new StorageError('The order index could not be parsed.', error);
  }
}

async function writeIndex(index, etag) {
  await putObject(INDEX_KEY, JSON.stringify(index, null, 2), {
    contentType: 'application/json',
    ifMatch: etag || undefined,
    ifNoneMatch: etag ? undefined : '*'
  });
}

/* ---------------------------------------------------------------------------
   Invoice numbers
   ---------------------------------------------------------------------------
   HS-YYYY-MM-DD-NNNN, counted per day in Europe/Berlin. The prefix is not
   decoration: steinbach-instruments.de issues YYYY-MM-DD-NNNN from its own
   counter under the same tax number, and § 14 UStG wants every invoice number
   the issuer hands out to be unique. Without the prefix both shops would print
   2026-08-28-0001 on the same day. The counter lives
   in the same object as the orders, so drawing a number and storing the order
   it belongs to is one atomic write: a number can never be issued twice, and
   none can go missing between two writes.
   --------------------------------------------------------------------------- */

const INVOICE_PREFIX = 'HS-';

function berlinDate(now = new Date()) {
  /* en-CA gives YYYY-MM-DD, which is what the number wants. */
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
}

function nextInvoiceNumber(index, now) {
  const day = berlinDate(now);
  const next = (index.invoiceCounters[day] || 0) + 1;
  index.invoiceCounters[day] = next;
  return `${INVOICE_PREFIX}${day}-${String(next).padStart(4, '0')}`;
}

/**
 * Eine Rechnungsnummer ziehen, ohne dass eine Bestellung dahintersteht.
 *
 * Von Hand geschriebene Rechnungen brauchen dieselbe Folge wie die aus dem
 * Shop, sonst gäbe es zwei Zähler unter einer Steuernummer und damit früher
 * oder später zweimal dieselbe Nummer — was § 14 UStG gerade verbietet. Der
 * Zähler liegt weiter in diesem einen Objekt, und weil das Ziehen und das
 * Speichern ein Schreibvorgang sind, kann keine Nummer doppelt vergeben
 * werden und keine verlorengehen.
 */
export async function drawInvoiceNumber() {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();
    const number = nextInvoiceNumber(index, new Date());

    try {
      await writeIndex(index, etag);
      return number;
    } catch (error) {
      /* Jemand anders war schneller; noch einmal lesen und neu ziehen. */
      if (attempt === WRITE_ATTEMPTS) throw error;
    }
  }

  throw new StorageError('Es konnte keine Rechnungsnummer gezogen werden.');
}

/* ---------------------------------------------------------------------------
   Reading
   --------------------------------------------------------------------------- */

export async function listOrders() {
  const { index } = await readIndex();
  return index.orders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getOrder(id) {
  const { index } = await readIndex();
  return index.orders.find((order) => order.id === id) || null;
}

export async function findBySession(sessionId) {
  if (!sessionId) return null;
  const { index } = await readIndex();
  return index.orders.find((order) => order.stripeSessionId === sessionId) || null;
}

/* ---------------------------------------------------------------------------
   Writing
   --------------------------------------------------------------------------- */

/**
 * Record a paid checkout. Idempotent on the Stripe session id.
 *
 * Returns `{ order, created }` — `created` is false when the webhook had
 * already been handled, which happens routinely because Stripe retries.
 */
export async function createOrder(input) {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();

    const existing = index.orders.find((order) => order.stripeSessionId === input.stripeSessionId);
    if (existing) {
      return { order: existing, created: false };
    }

    const now = new Date();
    const order = {
      id: randomUUID(),
      invoiceNumber: nextInvoiceNumber(index, now),
      stripeSessionId: input.stripeSessionId,
      stripePaymentIntent: input.stripePaymentIntent || null,
      product: input.product,
      quantity: input.quantity || 1,
      itemCents: input.itemCents,
      shippingCents: input.shippingCents || 0,
      totalCents: input.totalCents,
      currency: input.currency || 'eur',
      paymentMethod: input.paymentMethod || 'Card',
      buyer: input.buyer,
      status: 'paid',
      shippedAt: null,
      trackingNote: null,
      invoiceKey: null,
      mailSentAt: null,
      noticeSentAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      events: [{ type: 'paid', at: now.toISOString() }]
    };

    index.orders.push(order);

    try {
      await writeIndex(index, etag);
      return { order, created: true };
    } catch (error) {
      if (error.code !== 'precondition_failed' || attempt === WRITE_ATTEMPTS) {
        throw error;
      }
      /* Lost the race: read again, and the number is drawn again from the
         fresh counter. Nothing was written, so nothing is left dangling. */
    }
  }

  throw new StorageError('The order index is busy. Try again.');
}

export async function updateOrder(id, mutate) {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();
    const position = index.orders.findIndex((order) => order.id === id);

    if (position === -1) {
      const error = new Error('Order not found.');
      error.statusCode = 404;
      error.code = 'not_found';
      throw error;
    }

    const order = structuredClone(index.orders[position]);
    const result = await mutate(order);
    order.updatedAt = new Date().toISOString();
    index.orders[position] = order;

    try {
      await writeIndex(index, etag);
      return { order, result };
    } catch (error) {
      if (error.code !== 'precondition_failed' || attempt === WRITE_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new StorageError('The order index is busy. Try again.');
}

export function addOrderEvent(order, type, detail) {
  order.events = order.events || [];
  order.events.push({ type, at: new Date().toISOString(), detail: detail || null });
}

/** Where an order's invoice PDF lives. */
export function invoiceKey(order) {
  return `orders/${order.id}/invoice-${order.invoiceNumber}.pdf`;
}
