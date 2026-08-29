/**
 * One-time codes sent by email, as the second step of signing in.
 *
 * The flow: the password is checked first and, if it holds, a six-digit code
 * goes to the studio address. The browser gets back a challenge — a short
 * signed note saying "this password was correct at this moment" — and nothing
 * else. Only the code turns that into a session.
 *
 * Why a challenge rather than a half-open session: without it the second step
 * would have to trust whoever asks, and anyone could skip straight to guessing
 * codes for a login they never passed the password of.
 *
 * The codes live in memory. A restart forgets the pending ones, which costs a
 * fresh login and nothing else — and it means a code cannot survive on disk
 * anywhere.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { config } from './config.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

/* challengeId -> { codeHash, expiresAt, attempts } */
const pending = new Map();

function sign(value) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

function sweep(now) {
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) {
      pending.delete(id);
    }
  }
}

/**
 * Draw a code and the challenge that belongs to it.
 *
 * Returns { challenge, code }. The code goes out by email and is never stored
 * in the clear — what stays here is its HMAC, so a memory dump does not hand
 * over a working code.
 */
export function issueLoginCode(now = Date.now()) {
  sweep(now);

  /* Kein Punkt im Bezeichner: der trennt gleich Kennung von Signatur. */
  const challengeId = `${now.toString(36)}-${randomBytes(9).toString('hex')}`;
  /* randomInt, not Math.random: this is the whole second factor. */
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  pending.set(challengeId, {
    codeHash: sign(`${challengeId}:${code}`),
    expiresAt: now + CODE_TTL_MS,
    attempts: 0
  });

  /* The browser holds the id plus a signature over it, so it cannot invent a
     challenge of its own. */
  return { challenge: `${challengeId}.${sign(challengeId)}`, code };
}

/**
 * Check a code against its challenge.
 *
 * Returns one of: 'ok', 'expired', 'invalid'. A used or exhausted challenge is
 * dropped, so a code works exactly once and guessing gets five tries.
 */
export function verifyLoginCode(challenge, code, now = Date.now()) {
  sweep(now);

  const [challengeId, signature] = String(challenge || '').split('.');

  if (!challengeId || !signature || sign(challengeId) !== signature) {
    return 'invalid';
  }

  const entry = pending.get(challengeId);

  if (!entry) {
    return 'expired';
  }

  if (entry.expiresAt <= now) {
    pending.delete(challengeId);
    return 'expired';
  }

  const entered = String(code || '').replace(/\s/g, '');

  if (!/^\d{6}$/.test(entered)) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_CODE_ATTEMPTS) pending.delete(challengeId);
    return 'invalid';
  }

  const candidate = Buffer.from(sign(`${challengeId}:${entered}`), 'utf8');
  const expected = Buffer.from(entry.codeHash, 'utf8');

  if (!timingSafeEqual(candidate, expected)) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_CODE_ATTEMPTS) pending.delete(challengeId);
    return 'invalid';
  }

  /* Spent. */
  pending.delete(challengeId);
  return 'ok';
}

export const LOGIN_CODE_TTL_MINUTES = CODE_TTL_MS / 60000;
