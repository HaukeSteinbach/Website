#!/usr/bin/env node
/**
 * Turn a password into the hash the server expects.
 *
 *   npm run admin-password -- "your password here"
 *
 * Copy the printed line into backend/.env.runtime on the server. The password
 * itself is never stored anywhere — only this hash, which cannot be turned
 * back into it.
 */

import { hashPassword } from '../src/middleware/auth.js';

const password = process.argv.slice(2).join(' ').trim();

if (!password) {
  console.error('Usage: npm run admin-password -- "your password here"');
  process.exit(1);
}

if (password.length < 12) {
  console.error(`Too short: ${password.length} characters. Use at least 12 — this is the only lock on the admin area.`);
  process.exit(1);
}

console.log('');
console.log('Put this line in backend/.env.runtime on the server:');
console.log('');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log('');
console.log('SESSION_SECRET must also be set, to any long random string:');
console.log('');
console.log(`SESSION_SECRET=${(await import('node:crypto')).randomBytes(32).toString('hex')}`);
console.log('');
