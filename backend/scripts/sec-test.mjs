/* Prüft die beiden geschlossenen Lücken gegen den echten Server. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createMiniS3 } from './mini-s3.mjs';

const S3 = 9891, APP = 9892;
process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'sec'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026','s',64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = '/tmp/sec-uploads';
/* Die Seiten liegen im Repo-Wurzelverzeichnis, im Image unter public/. Ohne
   das hier lieferten die Seitenabrufe 404 und die CSP-Pruefungen unten haetten
   nur die Kopfzeile einer Fehlerseite geprueft. */
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;

await createMiniS3(S3);
const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}`;
const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

try {
  // 1. Ohne Anmeldung keine Release-Seite mehr
  const offen = await fetch(`${base}/api/v1/public/release-pages`, { method: 'POST' });
  check('Release-Seite anlegen verlangt jetzt eine Anmeldung', () => assert.equal(offen.status, 401));

  // 2. Angemeldet: SSRF-Ziele werden abgewiesen
  const login = await fetch(`${base}/api/v1/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'einLangesPasswort2026' })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  for (const ziel of ['http://169.254.169.254/latest/meta-data/',
                      'http://127.0.0.1:9892/health',
                      'http://192.168.1.1/',
                      'https://boesartig.example.com/seite']) {
    const form = new FormData();
    form.append('sourceUrl', ziel);
    form.append('artwork', new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), 'a.jpg');
    const r = await fetch(`${base}/api/v1/public/release-pages`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    const b = await r.json();
    check(`abgewiesen: ${ziel.slice(0, 42)}`, () => {
      assert.equal(r.status, 422);
      assert.ok(['host_not_allowed', 'validation_error'].includes(b.error), `bekam ${b.error}`);
    });
  }

  // 3. Ein erlaubter Host kommt durch die Prüfung (scheitert erst am Abruf)
  const ok = new FormData();
  ok.append('sourceUrl', 'https://listen.music-hub.com/release/xyz');
  ok.append('artwork', new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), 'a.jpg');
  const r2 = await fetch(`${base}/api/v1/public/release-pages`, { method: 'POST', headers: { Cookie: cookie }, body: ok });
  const b2 = await r2.json();
  check('erlaubter Host passiert die Hostprüfung', () => assert.notEqual(b2.error, 'host_not_allowed'));

  // 4. Die gelockerte CSP gilt NUR fuer das UI Studio
  const studio = await fetch(`${base}/uistudio.html`);
  const andere = await fetch(`${base}/impressum.html`);
  const cspStudio = studio.headers.get('content-security-policy') || '';
  const cspAndere = andere.headers.get('content-security-policy') || '';
  check('UI Studio darf eigene Skripte ausfuehren', () => {
    assert.ok(cspStudio.includes("script-src 'self' 'unsafe-inline'"), `bekam: ${cspStudio.slice(0, 120)}`);
  });
  check('der Rest der Seite darf es nicht', () => {
    assert.ok(!cspAndere.includes("'unsafe-inline'") || !/script-src[^;]*unsafe-inline/.test(cspAndere),
      `bekam: ${cspAndere.slice(0, 160)}`);
  });
  check('UI Studio erreicht Supabase, auch als WebSocket', () => {
    assert.ok(cspStudio.includes('wss://eojchbkieeqyfgfazydk.supabase.co'), `bekam: ${cspStudio.slice(0, 200)}`);
  });
} catch (e) {
  fail.push('Lauf: ' + e.message);
} finally {
  server.close();
  console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen\n`);
  pass.forEach(n => console.log('  ok   ' + n));
  fail.forEach(n => console.log('  FAIL ' + n));
  process.exit(fail.length ? 1 : 0);
}
