#!/usr/bin/env node
/**
 * Turn a password into the hash the server expects.
 *
 *   npm run admin-password -- "your password here"
 *
 * Copy the printed line into backend/.env.runtime on the server. The password
 * itself is never stored anywhere — only this hash, which cannot be turned
 * back into it.
 *
 * With --quiet it prints the bare hash and nothing else, which is how
 * setup.sh reads it.
 */

import { randomBytes } from 'node:crypto';

import { hashPassword } from '../src/middleware/auth.js';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const password = args.filter((arg) => arg !== '--quiet').join(' ').trim();

if (!password) {
  console.error('Usage: npm run admin-password -- "your password here"');
  process.exit(1);
}

if (password.length < 12) {
  console.error(`Too short: ${password.length} characters. Use at least 12 — this is the only lock on the admin area.`);
  process.exit(1);
}

if (quiet) {
  console.log(hashPassword(password));
  process.exit(0);
}

console.log('');
console.log('Put these two lines in backend/.env.runtime on the server:');
console.log('');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
console.log('');
