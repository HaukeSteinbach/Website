/* Prüft den zweiten Anmeldeschritt — erst den Algorithmus gegen die
   Prüfwerte aus RFC 6238, dann das Verhalten der echten Anmelderoute. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';
import { currentCode, fromBase32, generateSecret, toBase32, verifyCode } from '../src/lib/totp.js';

const S3 = 9971, APP = 9972;
/* Der Prüfschlüssel aus RFC 6238, Anhang B: die ASCII-Ziffern 1 bis 0. */
const RFC_SECRET = toBase32(Buffer.from('12345678901234567890', 'utf8'));

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'totp'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'y'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.ADMIN_TOTP_SECRET = RFC_SECRET;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;

await createMiniS3(S3);
const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}`;

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

const anmelden = (body) => fetch(`${base}/api/v1/admin/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

try {
  /* ---- 1. Der Algorithmus ------------------------------------------------ */

  /* RFC 6238, Anhang B. Die Tabelle dort führt acht Zeitpunkte; hier stehen
     die mit SHA-1, denn genau die sprechen die Apps. */
  for (const [sekunden, erwartet] of [
    [59, '287082'], [1111111109, '081804'], [1111111111, '050471'],
    [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']
  ]) {
    check(`RFC-6238-Prüfwert bei ${sekunden}s`, () =>
      assert.equal(currentCode(RFC_SECRET, sekunden * 1000), erwartet));
  }

  check('Base32 hin und zurück', () => {
    const roh = Buffer.from('Steinbach-Testschlüssel!', 'utf8');
    assert.deepEqual(fromBase32(toBase32(roh)), roh);
  });

  check('erzeugter Schlüssel ist 32 Zeichen Base32', () => {
    const s = generateSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
  });

  check('ein Schritt Vorlauf wird akzeptiert', () =>
    assert.notEqual(verifyCode(RFC_SECRET, currentCode(RFC_SECRET, 1e9 * 1000 + 30000), 1e9 * 1000), null));
  check('ein Schritt Nachlauf wird akzeptiert', () =>
    assert.notEqual(verifyCode(RFC_SECRET, currentCode(RFC_SECRET, 1e9 * 1000 - 30000), 1e9 * 1000), null));
  check('zwei Schritte daneben nicht mehr', () =>
    assert.equal(verifyCode(RFC_SECRET, currentCode(RFC_SECRET, 1e9 * 1000 - 90000), 1e9 * 1000), null));

  check('Buchstaben statt Ziffern', () => assert.equal(verifyCode(RFC_SECRET, 'abcdef'), null));
  check('zu kurz', () => assert.equal(verifyCode(RFC_SECRET, '12345'), null));
  check('leer', () => assert.equal(verifyCode(RFC_SECRET, ''), null));
  check('kaputter Schlüssel wirft nicht, sondern lehnt ab', () =>
    assert.equal(verifyCode('nicht base32!', '123456'), null));

  /* ---- 2. Die Anmelderoute ---------------------------------------------- */

  const ohneCode = await anmelden({ password: 'einLangesPasswort2026' });
  check('Passwort allein reicht nicht mehr', () => assert.equal(ohneCode.status, 401));
  const grund = await ohneCode.json();
  check('Fehlerkennung ist invalid_code', () => assert.equal(grund.error, 'invalid_code'));

  const falschesPasswort = await anmelden({ password: 'falsch', code: currentCode(RFC_SECRET) });
  check('richtiger Code rettet ein falsches Passwort nicht', () =>
    assert.equal(falschesPasswort.status, 401));

  const code = currentCode(RFC_SECRET);
  const richtig = await anmelden({ password: 'einLangesPasswort2026', code });
  check('Passwort und Code zusammen öffnen', () => assert.equal(richtig.status, 200));
  check('und setzen die Sitzung', () => assert.match(richtig.headers.get('set-cookie') || '', /steinbach_admin=/));

  /* Derselbe Code ein zweites Mal: innerhalb seiner 30 Sekunden noch gültig,
     aber verbraucht. Ohne diese Sperre könnte ihn jemand wiederverwenden,
     der ihn abgefangen hat. */
  const nochmal = await anmelden({ password: 'einLangesPasswort2026', code });
  check('derselbe Code öffnet kein zweites Mal', () => assert.equal(nochmal.status, 401));

  /* ---- 3. Die Sperre gilt auch für Codes -------------------------------- */

  let gesperrt = null;
  for (let i = 0; i < 10; i += 1) {
    const r = await anmelden({ password: 'einLangesPasswort2026', code: '000000' });
    if (r.status === 429) { gesperrt = i; break; }
  }
  check('falsche Codes laufen in dieselbe Sperre wie falsche Passwörter', () =>
    assert.notEqual(gesperrt, null));
} finally {
  server.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
