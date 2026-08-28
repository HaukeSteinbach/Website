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
   YYYY-MM-DD-NNNN, counted per day in Europe/Berlin — the same format the
   instruments shop uses, so both sets of books read alike. The counter lives
   in the same object as the orders, so drawing a number and storing the order
   it belongs to is one atomic write: a number can never be issued twice, and
   none can go missing between two writes.
   --------------------------------------------------------------------------- */

function berlinDate(now = new Date()) {
  /* en-CA gives YYYY-MM-DD, which is what the number wants. */
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
}

function nextInvoiceNumber(index, now) {
  const day = berlinDate(now);
  const next = (index.invoiceCounters[day] || 0) + 1;
  index.invoiceCounters[day] = next;
  return `${day}-${String(next).padStart(4, '0')}`;
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
