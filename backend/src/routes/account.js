/**
 * The customer account.
 *
 * One purpose: someone who bought a plug-in wants their licence key, the
 * installer and the manual again, months later, on a new machine. Nothing
 * else belongs here.
 *
 * NO PASSWORDS, EVER. Signing in means: name the address you bought with, get
 * a six-digit code, type it in. That is not a compromise, it is the better
 * fit — the address is the only thing that ties a person to their purchase
 * anyway (see orders.js: no accounts are created at checkout), so a password
 * would be a second secret guarding the same door, one more thing to forget
 * and one more thing to leak.
 *
 * WHAT IS AND IS NOT REVEALED. An address with no purchase gets no code and
 * no mail. The browser is told the same thing either way, so this page cannot
 * be used to find out who bought something. Sending a code to an address that
 * bought nothing would also mean mailing strangers on request, which is a
 * spam cannon with a nice interface.
 *
 * The session is a signed cookie carrying the address and its own expiry, like
 * the admin one. No session store, and a restart of the server does not throw
 * everyone out.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import express from 'express';

import { config } from '../lib/config.js';
import { fail, ok } from '../lib/http.js';
import { issueLoginCode, verifyLoginCode, LOGIN_CODE_TTL_MINUTES } from '../lib/login-codes.js';
import { sendAccountCodeEmail } from '../lib/mail.js';
import { listOrders } from '../lib/orders.js';
import { getProduct } from '../lib/shop.js';
import { getDownloadUrl, isStorageConfigured } from '../lib/storage.js';

const router = express.Router();

const COOKIE_NAME = 'steinbach_account';
const SESSION_HOURS = 24 * 30;

/* --------------------------------------------------------------------------
   Address handling
   --------------------------------------------------------------------------
   Compared in lower case with the ends trimmed, because that is how people
   type an address they have typed a hundred times. Nothing further is
   normalised: dots in a Gmail address are the same mailbox to Google and a
   different one elsewhere, so treating them as equal would silently hand one
   person another person's purchases.
   -------------------------------------------------------------------------- */

function tidyEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

async function ordersFor(email) {
  const all = await listOrders();
  return all.filter((order) => tidyEmail(order.buyer?.email) === email);
}

/* --------------------------------------------------------------------------
   Session cookie
   -------------------------------------------------------------------------- */

function sign(payload) {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

function issueAccountSession(response, email, secure) {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `${expiresAt}:${email}`;
  response.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/'
  });
}

/** The address in the cookie, or null. Never trust the body for identity. */
function sessionEmail(request) {
  const raw = request.cookies?.[COOKIE_NAME];

  if (!raw || !config.sessionSecret) return null;

  const separator = raw.lastIndexOf('.');
  if (separator === -1) return null;

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sign(payload);

  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const [expiresAt, ...rest] = payload.split(':');
  if (!Number(expiresAt) || Number(expiresAt) <= Date.now()) return null;

  /* The address may contain a colon in theory, so it is put back together
     rather than taken from index 1. */
  return rest.join(':') || null;
}

/* --------------------------------------------------------------------------
   What a signed-in customer gets to see
   -------------------------------------------------------------------------- */

function downloadsFor(product) {
  if (product?.slug !== 'chain') return [];

  const { mac, windows, manual } = config.chainDownloads;

  return [
    { id: 'mac', label: 'macOS, Apple Silicon und Intel', kind: 'installer', url: mac },
    { id: 'windows', label: 'Windows, 64 Bit', kind: 'installer', url: windows },
    { id: 'manual', label: 'Handbuch, PDF', kind: 'document', url: manual }
  ].filter((entry) => entry.url);
}

/**
 * One order in the shape the page draws.
 *
 * The invoice link is drawn fresh on every call and expires: unlike the
 * installer it is a personal document, and a lasting address for it would be
 * one leaked link away from a stranger reading somebody's name and address.
 */
async function forThePage(order) {
  const product = getProduct(order.product?.slug);

  let invoiceUrl = null;

  if (order.invoiceKey && isStorageConfigured()) {
    try {
      invoiceUrl = await getDownloadUrl(order.invoiceKey, `${order.invoiceNumber}.pdf`);
    } catch {
      invoiceUrl = null;
    }
  }

  return {
    invoiceNumber: order.invoiceNumber,
    boughtAt: order.createdAt,
    product: { slug: order.product?.slug, name: order.product?.name },
    licenceKey: order.licenceKey || null,
    status: order.status,
    invoiceUrl,
    downloads: downloadsFor(product)
  };
}

/* --------------------------------------------------------------------------
   Step one: ask for a code
   -------------------------------------------------------------------------- */

router.post('/request-code', async (request, response, next) => {
  try {
    const email = tidyEmail(request.body?.email);

    if (!looksLikeEmail(email)) {
      return fail(response, 400, 'invalid_email', 'Diese Adresse sieht nicht wie eine E-Mail-Adresse aus.');
    }

    /* Ohne Sitzungsgeheimnis liesse sich kein Cookie unterschreiben, ohne
       Ablage gibt es keine Bestellungen zum Nachschlagen. Beides ist eine
       Sache des Servers und nicht des Besuchers, also 503 mit einem Weg, der
       weiterhilft -- und nicht ein 500, das nach einem Fehler bei ihm aussieht. */
    if (!config.sessionSecret || !isStorageConfigured()) {
      return fail(response, 503, 'not_configured',
        'Der Kontobereich ist gerade nicht verfügbar. Schreib an mail@haukesteinbach.de.');
    }

    const bestellungen = await ordersFor(email);
    const { challenge, code } = issueLoginCode(Date.now(), email);

    /* Only a real customer gets mail. The answer below is the same either way,
       so nothing about who bought what leaves this building. */
    if (bestellungen.length > 0) {
      await sendAccountCodeEmail({ to: email, code, minutes: LOGIN_CODE_TTL_MINUTES });
    }

    return ok(response, { challenge, minutes: LOGIN_CODE_TTL_MINUTES });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Step two: the code turns into a session
   -------------------------------------------------------------------------- */

router.post('/verify', async (request, response, next) => {
  try {
    if (!config.sessionSecret || !isStorageConfigured()) {
      return fail(response, 503, 'not_configured',
        'Der Kontobereich ist gerade nicht verfügbar. Schreib an mail@haukesteinbach.de.');
    }

    const email = tidyEmail(request.body?.email);
    const verdict = verifyLoginCode(request.body?.challenge, request.body?.code, Date.now(), email);

    if (verdict === 'expired') {
      return fail(response, 400, 'code_expired', 'Der Code ist abgelaufen. Fordere einen neuen an.');
    }

    if (verdict !== 'ok') {
      return fail(response, 401, 'code_invalid', 'Dieser Code stimmt nicht.');
    }

    const bestellungen = await ordersFor(email);

    /* A correct code for an address with nothing behind it can only happen if
       the purchase was refunded away in the meantime. No session in that case:
       an empty account area would leave the person wondering what they did
       wrong. */
    if (bestellungen.length === 0) {
      return fail(response, 404, 'nothing_found',
        'Zu dieser Adresse liegt kein Kauf vor. Hast du mit einer anderen bezahlt?');
    }

    issueAccountSession(response, email, request.secure || request.get('x-forwarded-proto') === 'https');

    return ok(response, { email });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   What I bought
   -------------------------------------------------------------------------- */

router.get('/me', async (request, response, next) => {
  try {
    if (!config.sessionSecret || !isStorageConfigured()) {
      return fail(response, 503, 'not_configured',
        'Der Kontobereich ist gerade nicht verfügbar. Schreib an mail@haukesteinbach.de.');
    }

    const email = sessionEmail(request);

    if (!email) {
      return fail(response, 401, 'not_signed_in', 'Bitte melde dich an.');
    }

    const bestellungen = await ordersFor(email);
    const items = [];

    for (const order of bestellungen) {
      items.push(await forThePage(order));
    }

    return ok(response, { email, orders: items });
  } catch (error) {
    return next(error);
  }
});

router.post('/signout', (_request, response) => {
  response.clearCookie(COOKIE_NAME, { path: '/' });
  return ok(response, {});
});

export default router;
