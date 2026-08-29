/**
 * Time-based one-time passwords, RFC 6238.
 *
 * The second step in front of the admin area. A password can be read over a
 * shoulder, phished, or reused somewhere that later leaks; a code that is only
 * valid for half a minute cannot be any of those things later.
 *
 * Written out here rather than pulled in as a dependency: the whole algorithm
 * is an HMAC and a modulo, Node brings both, and an authentication path is the
 * last place to add a package that nobody reads.
 *
 * Compatible with every common authenticator app — SHA-1, 6 digits, 30-second
 * steps. Those are not choices, they are what the apps assume when the setup
 * URI does not say otherwise, and deviating buys nothing here.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const STEP_SECONDS = 30;

/* One step either side. Phone clocks drift, and a code typed at the very end
   of its window arrives after it. Wider than this starts to matter: every
   extra step is another code an attacker may guess. */
const DRIFT_STEPS = 1;

/* ---------------------------------------------------------------------------
   Base32, because that is what the apps and the otpauth:// URI speak
   --------------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function fromBase32(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');

  if (!clean || /[^A-Z2-7]/.test(clean)) {
    throw new Error('Not a base32 secret.');
  }

  let bits = 0;
  let value = 0;
  const out = [];

  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/** A fresh secret, 20 bytes — the length RFC 4226 asks for with SHA-1. */
export function generateSecret() {
  return toBase32(randomBytes(20));
}

/* ---------------------------------------------------------------------------
   The code itself
   --------------------------------------------------------------------------- */

function codeForCounter(key, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(message).digest();
  /* Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
     where in the digest to read from, so every byte of it can matter. */
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentCode(secret, now = Date.now()) {
  return codeForCounter(fromBase32(secret), Math.floor(now / 1000 / STEP_SECONDS));
}

/**
 * Check a code and say which step it belonged to.
 *
 * Returns the counter on success and null on failure. The caller needs the
 * counter, not just a yes: a code stays valid for its whole window, so without
 * remembering which one was spent, anyone who catches a code in flight can use
 * it again seconds later.
 */
export function verifyCode(secret, code, now = Date.now()) {
  const entered = String(code || '').replace(/\s/g, '');

  if (!new RegExp(`^\\d{${DIGITS}}$`).test(entered)) {
    return null;
  }

  let key;

  try {
    key = fromBase32(secret);
  } catch {
    return null;
  }

  const current = Math.floor(now / 1000 / STEP_SECONDS);
  const entry = Buffer.from(entered, 'utf8');

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const counter = current + drift;
    const expected = Buffer.from(codeForCounter(key, counter), 'utf8');

    /* Constant time, so the number of leading digits that happened to match
       cannot be read off the response time. */
    if (timingSafeEqual(entry, expected)) {
      return counter;
    }
  }

  return null;
}

/**
 * The otpauth:// URI an authenticator app scans or accepts as text.
 *
 * The label is what shows up in the app's list, so it names both the site and
 * the account — a phone holds a dozen of these.
 */
export function setupUri(secret, account = 'admin', issuer = 'haukesteinbach.de') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS)
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

export const TOTP_STEP_SECONDS = STEP_SECONDS;
