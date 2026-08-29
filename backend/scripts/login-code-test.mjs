/* Prüft die Anmeldung per Mailcode: zwei Schritte, einmalig, begrenzt. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';

const S3 = 9981, APP = 9982, SMTP = 9983;

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'lc'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'q'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.ADMIN_2FA = 'email';
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;
/* Ein Mailserver, der nur mitschreibt — so lässt sich der Code auslesen,
   ohne dass er je das Testverzeichnis verlässt. */
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(SMTP);
process.env.SMTP_USER = 'mail@haukesteinbach.de';
process.env.SMTP_PASSWORD = 'x';
process.env.SMTP_SECURE = 'false';
process.env.MAIL_FROM_EMAIL = 'mail@haukesteinbach.de';

const { createMiniSmtp } = await import('./mini-smtp.mjs');
const postfach = await createMiniSmtp(SMTP);
await createMiniS3(S3);

const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}`;

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };
const post = (weg, body) => fetch(`${base}/api/v1/admin${weg}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

function letzterCode() {
  const alle = postfach.text().split('\n---\n');
  const treffer = (alle[alle.length - 1] || '').match(/Adminbereich:\s*(\d{6})/);
  return treffer ? treffer[1] : null;
}

try {
  /* ---- 1. Das Passwort öffnet nichts mehr ------------------------------- */

  const schritt1 = await post('/auth/login', { password: 'einLangesPasswort2026' });
  const antwort = await schritt1.json();

  check('Passwort allein gibt keine Sitzung', () =>
    assert.equal(schritt1.headers.get('set-cookie'), null));
  check('sondern verlangt einen Code', () => assert.equal(antwort.step, 'code'));
  check('und liefert eine Challenge', () => assert.match(antwort.challenge || '', /.+\..+/));
  check('die Adresse wird nur angedeutet', () => {
    assert.match(antwort.sentTo || '', /^ma\*+@haukesteinbach\.de$/);
    assert.ok(!/mail@/.test(antwort.sentTo));
  });

  const code = letzterCode();
  check('der Code ging per Mail raus', () => assert.match(code || '', /^\d{6}$/));

  /* ---- 2. Falsches Passwort löst gar nichts aus ------------------------- */

  const vorher = postfach.messages.length;
  const falsch = await post('/auth/login', { password: 'daneben' });
  check('falsches Passwort: 401', () => assert.equal(falsch.status, 401));
  check('und keine Mail — sonst wäre das ein Weg, das Postfach zu fluten', () =>
    assert.equal(postfach.messages.length, vorher));

  /* ---- 3. Der Code löst die Challenge ein ------------------------------- */

  const erfunden = await post('/auth/verify', { challenge: 'ausgedacht.abc', code });
  check('erfundene Challenge wird abgewiesen', () => assert.equal(erfunden.status, 401));

  const falscherCode = await post('/auth/verify', { challenge: antwort.challenge, code: '000000' });
  check('falscher Code wird abgewiesen', () => assert.equal(falscherCode.status, 401));

  const richtig = await post('/auth/verify', { challenge: antwort.challenge, code });
  check('richtiger Code öffnet', () => assert.equal(richtig.status, 200));
  check('und setzt die Sitzung', () =>
    assert.match(richtig.headers.get('set-cookie') || '', /steinbach_admin=/));

  const nochmal = await post('/auth/verify', { challenge: antwort.challenge, code });
  check('derselbe Code öffnet kein zweites Mal', () => assert.equal(nochmal.status, 401));

  /* ---- 4. Raten hat ein Ende -------------------------------------------- */

  /* Direkt gegen das Modul: über HTTP käme hier die IP-Sperre dazwischen, und
     dann prüfte der Test zwei Riegel auf einmal und keinen davon genau. */
  const { issueLoginCode, verifyLoginCode } = await import('../src/lib/login-codes.js');
  const eigene = issueLoginCode();

  const urteile = [];
  for (let i = 0; i < 6; i += 1) {
    urteile.push(verifyLoginCode(eigene.challenge, '111111'));
  }

  check('fünf Fehlversuche werden als falsch gewertet', () =>
    assert.deepEqual(urteile.slice(0, 5), Array(5).fill('invalid')));
  check('danach ist die Challenge verbraucht', () => assert.equal(urteile[5], 'expired'));

  const abgelaufen = issueLoginCode(Date.now() - 11 * 60 * 1000);
  check('nach zehn Minuten gilt der Code nicht mehr', () =>
    assert.equal(verifyLoginCode(abgelaufen.challenge, abgelaufen.code), 'expired'));

  const frisch = issueLoginCode();
  check('ein frischer Code passt zu seiner Challenge', () =>
    assert.equal(verifyLoginCode(frisch.challenge, frisch.code), 'ok'));
  check('aber nicht zu einer fremden', () => {
    const andere = issueLoginCode();
    assert.notEqual(verifyLoginCode(andere.challenge, frisch.code), 'ok');
  });

} finally {
  server.close();
  postfach.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
