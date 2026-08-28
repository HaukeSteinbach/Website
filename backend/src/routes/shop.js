/**
 * The shop.
 *
 * Three routes: start a checkout, take Stripe's word that it was paid, and
 * show the buyer what happened afterwards. No accounts anywhere — the order is
 * found again by the Stripe session id that Stripe itself puts in the return
 * URL, and that is the only thing tying a person to their purchase.
 */

import express from 'express';

import { config } from '../lib/config.js';
import { fail, ok } from '../lib/http.js';
import { buildInvoicePdf } from '../lib/invoice-pdf.js';
import { sendOrderConfirmationEmail, sendOrderNoticeEmail } from '../lib/mail.js';
import {
  addOrderEvent,
  createOrder,
  findBySession,
  invoiceKey,
  updateOrder
} from '../lib/orders.js';
import { getProduct, shippingOptions, ALLOWED_COUNTRIES, CURRENCY } from '../lib/shop.js';
import { getDownloadUrl, isStorageConfigured, putObject } from '../lib/storage.js';
import {
  buyerFromSession,
  getStripe,
  isShopConfigured,
  isTestMode,
  isWebhookConfigured,
  paymentMethodLabel
} from '../lib/stripe.js';

const router = express.Router();

function requireShop(_request, response, next) {
  if (!isShopConfigured() || !isStorageConfigured()) {
    return fail(response, 503, 'shop_not_configured',
      'The shop is not available right now. Please email mail@haukesteinbach.de.');
  }

  return next();
}

/* --------------------------------------------------------------------------
   What the page needs to know before showing a buy button
   -------------------------------------------------------------------------- */

router.get('/products/:slug', (request, response) => {
  const product = getProduct(request.params.slug);

  if (!product) {
    return fail(response, 404, 'not_found', 'Unknown product.');
  }

  return ok(response, {
    slug: product.slug,
    name: product.name,
    priceCents: product.priceCents,
    currency: CURRENCY,
    available: isShopConfigured() && isStorageConfigured(),
    testMode: isShopConfigured() && isTestMode()
  });
});

/* --------------------------------------------------------------------------
   Start a checkout
   -------------------------------------------------------------------------- */

router.post('/checkout', requireShop, async (request, response, next) => {
  try {
    const product = getProduct(request.body?.product);

    if (!product) {
      return fail(response, 400, 'unknown_product', 'That product is not for sale.');
    }

    const origin = config.appOrigin.replace(/\/$/, '');

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        /* Price built here rather than referenced from the dashboard: what is
           charged then lives in the repository, versioned and reviewable, and
           setting the shop up needs no click-path through Stripe. */
        price_data: {
          currency: CURRENCY,
          unit_amount: product.priceCents,
          product_data: {
            name: product.name,
            description: product.description
          }
        }
      }],
      /* A parcel needs somewhere to go. */
      shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
      shipping_options: shippingOptions(),
      billing_address_collection: 'required',
      phone_number_collection: { enabled: false },
      /* Shown above Stripe's pay button. Both notices are required of a German
         seller and this is the last moment the buyer sees before paying. */
      custom_text: {
        submit: {
          message: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet. '
            + 'Es gilt das gesetzliche Widerrufsrecht von 14 Tagen — eine E-Mail '
            + 'an mail@haukesteinbach.de genügt.'
        }
      },
      success_url: `${origin}/order.html?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${product.page}#order`,
      metadata: { product_slug: product.slug }
    });

    return ok(response, { url: session.url });
  } catch (error) {
    console.error('[shop] checkout failed:', error?.message || error);
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Stripe tells us it was paid
   --------------------------------------------------------------------------
   Mounted with a raw body parser in app.js: the signature is computed over the
   exact bytes Stripe sent, so anything that re-serialises the JSON first
   breaks it.
   -------------------------------------------------------------------------- */

router.post('/webhook', async (request, response) => {
  if (!isShopConfigured() || !isWebhookConfigured()) {
    return fail(response, 503, 'shop_not_configured', 'Shop not configured.');
  }

  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      request.body,
      request.get('stripe-signature'),
      config.stripeWebhookSecret
    );
  } catch (error) {
    /* Unsigned or tampered with — never act on it. */
    console.warn('[shop] webhook signature rejected:', error?.message || error);
    return fail(response, 400, 'bad_signature', 'Signature verification failed.');
  }

  if (event.type !== 'checkout.session.completed') {
    return ok(response, { received: true, ignored: event.type });
  }

  try {
    const session = event.data.object;

    if (session.payment_status !== 'paid') {
      return ok(response, { received: true, ignored: 'unpaid' });
    }

    const order = await recordPaidSession(session);

    /* 200 either way: a purchase from the other shop is handled correctly by
       being ignored, and a retry would change nothing. */
    return ok(response, order ? { received: true } : { received: true, ignored: 'other_shop' });
  } catch (error) {
    /* A 500 makes Stripe retry, which is what we want for a transient storage
       failure — createOrder is idempotent, so a repeat is harmless. */
    console.error('[shop] webhook handling failed:', error?.stack || error);
    return fail(response, 500, 'webhook_failed', 'Could not record the order.');
  }
});

/**
 * Turn a paid Stripe session into an order, an invoice and two emails.
 *
 * Safe to run twice: the order is keyed on the session id, and everything
 * after it is skipped when the order already existed.
 */
async function recordPaidSession(session) {
  /* This Stripe account also serves steinbach-instruments.de, and Stripe
     delivers checkout.session.completed to every endpoint subscribed to it.
     A purchase from the other shop therefore arrives here too. Anything not in
     this catalogue is not ours: falling back to a default product would invent
     an order, issue an invoice in our number sequence and tell that buyer a
     parcel was on its way. */
  const product = getProduct(session.metadata?.product_slug);

  if (!product) {
    return null;
  }
  const shippingCents = session.total_details?.amount_shipping || 0;
  const totalCents = session.amount_total || 0;

  const { order, created } = await createOrder({
    stripeSessionId: session.id,
    stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    product: {
      slug: product.slug,
      name: product.name,
      description: product.description,
      invoiceDescription: product.invoiceDescription
    },
    quantity: 1,
    itemCents: totalCents - shippingCents,
    shippingCents,
    totalCents,
    currency: session.currency || CURRENCY,
    paymentMethod: paymentMethodLabel(session),
    buyer: buyerFromSession(session)
  });

  if (!created) {
    return order;                       /* Stripe retried; nothing left to do */
  }

  /* Invoice first, mail second: a customer should never get a mail promising
     an attachment that failed to build. */
  const pdf = await buildInvoicePdf(order);
  const key = invoiceKey(order);
  await putObject(key, Buffer.from(pdf), { contentType: 'application/pdf' });

  const { order: withInvoice } = await updateOrder(order.id, (draft) => {
    draft.invoiceKey = key;
    addOrderEvent(draft, 'invoice_created', { number: draft.invoiceNumber });
  });

  const toBuyer = await sendOrderConfirmationEmail({ order: withInvoice, invoicePdf: pdf });
  await sendOrderNoticeEmail({ order: withInvoice });

  await updateOrder(order.id, (draft) => {
    draft.mailSentAt = toBuyer.sent ? new Date().toISOString() : null;
    addOrderEvent(draft, toBuyer.sent ? 'confirmation_sent' : 'confirmation_failed',
      toBuyer.sent ? null : { reason: toBuyer.reason });
  });

  return withInvoice;
}

/* --------------------------------------------------------------------------
   The buyer comes back from Stripe
   -------------------------------------------------------------------------- */

/**
 * What order.html shows after a purchase.
 *
 * Keyed on the Stripe session id, which only the buyer's own return URL
 * carries. It reveals what someone just bought and the town they gave, so it
 * stays deliberately thin: no full address, no invoice link, nothing that
 * would matter if the URL were shared. The invoice arrives by email.
 */
router.get('/order/:sessionId', requireShop, async (request, response, next) => {
  try {
    let order = await findBySession(request.params.sessionId);

    /* The webhook and the redirect race each other, and the redirect often
       wins. Rather than tell the buyer their order does not exist, ask Stripe
       directly and record it now — the webhook will find it already there. */
    if (!order) {
      const session = await getStripe().checkout.sessions.retrieve(request.params.sessionId);

      if (session?.payment_status === 'paid') {
        order = await recordPaidSession(session);
      }

      /* Not one of ours — someone pasted a session id from the other shop. */
      if (!order) {
        return fail(response, 404, 'not_found', 'No order found for this link.');
      }
    }

    if (!order) {
      return fail(response, 404, 'not_found', 'No order found for this link.');
    }

    return ok(response, {
      invoiceNumber: order.invoiceNumber,
      product: { name: order.product?.name },
      totalCents: order.totalCents,
      currency: order.currency,
      buyerName: order.buyer?.name || '',
      city: order.buyer?.city || '',
      email: order.buyer?.email || '',
      mailSent: Boolean(order.mailSentAt),
      status: order.status
    });
  } catch (error) {
    return next(error);
  }
});

export { recordPaidSession };
export default router;
