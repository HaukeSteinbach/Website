/* Prüft Angebote und Rechnungen: Nummern, Unveränderlichkeit, Versand. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';

const S3 = 9951, APP = 9952, SMTP = 9953;

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'dok'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'd'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(SMTP);
process.env.SMTP_USER = 'mail@haukesteinbach.de'; process.env.SMTP_PASSWORD = 'x';
process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM_EMAIL = 'mail@haukesteinbach.de';

const { createMiniSmtp } = await import('./mini-smtp.mjs');
const postfach = await createMiniSmtp(SMTP);
const { objects } = await createMiniS3(S3);

const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}/api/v1/admin`;

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

const anmeldung = await fetch(`${base}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'einLangesPasswort2026' })
});
const cookie = anmeldung.headers.get('set-cookie').split(';')[0];

const ruf = (weg, options = {}) => fetch(base + weg, {
  ...options,
  headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) }
});

try {
  /* ---- 1. Katalog --------------------------------------------------------- */

  const katalog = await (await ruf('/catalogue')).json();
  check('der Katalog steht', () => assert.equal(katalog.services.length, 12));
  check('Preise in Cent', () =>
    assert.equal(katalog.services.find((s) => s.slug === 'mastering').unitCents, 4000));
  check('auch der grosse Posten stimmt', () =>
    assert.equal(katalog.services.find((s) => s.slug === 'hoa-verlaengerung').unitCents, 1000000));

  /* ---- 2. Kunde von Hand anlegen ------------------------------------------ */

  const angelegt = await (await ruf('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Testkundin', email: 'kundin@example.org',
      address: { line1: 'Weg 1', postalCode: '20095', city: 'Hamburg', country: 'Deutschland' }
    })
  })).json();

  check('ein Kunde lässt sich anlegen', () => assert.equal(angelegt.created, true));

  const nochmal = await (await ruf('/customers', {
    method: 'POST', body: JSON.stringify({ name: 'Testkundin', email: 'kundin@example.org' })
  })).json();
  check('zweimal derselbe wird nicht doppelt angelegt', () => assert.equal(nochmal.created, false));

  const ohneName = await ruf('/customers', { method: 'POST', body: JSON.stringify({ email: 'x@y.de' }) });
  check('ohne Namen geht es nicht', () => assert.equal(ohneName.status, 422));

  const kundeId = angelegt.customer.id;

  /* ---- 3. Angebot --------------------------------------------------------- */

  const entwurf = await (await ruf('/documents', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'offer', customerId: kundeId, title: 'EP-Produktion',
      intro: 'wie besprochen.',
      items: [
        { slug: 'produktion', quantity: 1 },
        { slug: 'mastering', quantity: 3 }
      ]
    })
  })).json();

  check('der Entwurf rechnet die Summe aus', () =>
    assert.equal(entwurf.document.totalCents, 60000 + 3 * 4000));
  check('Beschreibung kommt aus dem Katalog', () =>
    assert.match(entwurf.document.items[0].description, /Online-Livesession/));
  check('ein Entwurf hat noch keine Nummer', () => assert.equal(entwurf.document.number, null));

  /* Der Preis darf nicht aus dem Browser kommen — sonst bestimmte die
     Oberfläche, was eine Leistung kostet. */
  const untergeschoben = await (await ruf('/documents', {
    method: 'POST',
    body: JSON.stringify({ kind: 'offer', items: [{ slug: 'mastering', quantity: 1 }] })
  })).json();
  check('ohne eigene Angabe gilt der Katalogpreis', () =>
    assert.equal(untergeschoben.document.items[0].unitCents, 4000));

  const id = entwurf.document.id;

  const geaendert = await (await ruf(`/documents/${id}`, {
    method: 'PATCH', body: JSON.stringify({ title: 'EP-Produktion „Nordlicht"' })
  })).json();
  check('ein Entwurf lässt sich ändern', () =>
    assert.equal(geaendert.document.title, 'EP-Produktion „Nordlicht"'));

  const vorschau = await ruf(`/documents/${id}/pdf`);
  check('der Entwurf lässt sich als Vorschau ansehen', () => {
    assert.equal(vorschau.status, 200);
    assert.match(vorschau.headers.get('content-type'), /application\/pdf/);
  });

  const ausgestellt = await (await ruf(`/documents/${id}/issue`, { method: 'POST' })).json();
  check('ausgestellt bekommt es eine Angebotsnummer', () =>
    assert.match(ausgestellt.document.number, /^AN-\d{4}-\d{2}-\d{2}-\d{4}$/));
  check('und liegt als PDF im Speicher', () => assert.ok(objects.has(ausgestellt.document.pdfKey)));

  const nachtraeglich = await ruf(`/documents/${id}`, {
    method: 'PATCH', body: JSON.stringify({ title: 'Doch anders' })
  });
  check('danach ist es nicht mehr zu ändern', () => assert.equal(nachtraeglich.status, 409));

  const weg = await ruf(`/documents/${id}`, { method: 'DELETE' });
  check('und auch nicht zu löschen', () => assert.equal(weg.status, 409));

  /* ---- 4. Rechnung -------------------------------------------------------- */

  const rechnungEntwurf = await (await ruf('/documents', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'invoice', customerId: kundeId, title: 'Mastering EP',
      items: [{ slug: 'mastering', quantity: 3 }]
    })
  })).json();

  const rechnung = await (await ruf(`/documents/${rechnungEntwurf.document.id}/issue`, { method: 'POST' })).json();

  check('eine Rechnung zieht aus der HS-Folge', () =>
    assert.match(rechnung.document.number, /^HS-\d{4}-\d{2}-\d{2}-\d{4}$/));
  check('die Anschrift ist eingefroren', () =>
    assert.equal(rechnung.document.recipient.name, 'Testkundin'));

  /* Zwei Rechnungen dürfen nie dieselbe Nummer tragen, auch nicht am selben
     Tag und auch nicht neben dem Shop. */
  const zweite = await (await ruf('/documents', {
    method: 'POST', body: JSON.stringify({ kind: 'invoice', customerId: kundeId, items: [{ slug: 'mixing', quantity: 1 }] })
  })).json();
  const zweiteAus = await (await ruf(`/documents/${zweite.document.id}/issue`, { method: 'POST' })).json();

  check('die nächste Rechnung bekommt die nächste Nummer', () =>
    assert.notEqual(zweiteAus.document.number, rechnung.document.number));

  const leer = await (await ruf('/documents', {
    method: 'POST', body: JSON.stringify({ kind: 'invoice', customerId: kundeId, items: [] })
  })).json();
  const leerAus = await ruf(`/documents/${leer.document.id}/issue`, { method: 'POST' });
  check('ohne Position wird nichts ausgestellt', () => assert.equal(leerAus.status, 422));

  /* ---- 4b. Dateinamen ----------------------------------------------------- */

  const { documentFileName } = await import('../src/lib/documents.js');

  check('eine Rechnung heisst wie ihre Nummer', () =>
    assert.equal(documentFileName(rechnung.document), `${rechnung.document.number}.pdf`));
  check('ein Angebot ebenso', () =>
    assert.equal(documentFileName(ausgestellt.document), `${ausgestellt.document.number}.pdf`));

  /* Das Kuerzel steht schon in der Nummer; ein A- oder R- davor saegte
     dasselbe zweimal. */
  check('kein doppeltes Kuerzel', () => {
    assert.ok(!documentFileName(ausgestellt.document).startsWith('A-AN-'));
    assert.ok(!documentFileName(rechnung.document).startsWith('R-HS-'));
  });

  /* Die alten Onlydesk-Nummern beginnen mit dem Datum und verraten fuer sich
     genommen nicht, was sie sind -- die bekommen ihr R-. */
  check('eine alte Rechnung bekommt ein R- davor', () =>
    assert.equal(documentFileName({ kind: 'invoice', number: '2026-05-18-0001' }), 'R-2026-05-18-0001.pdf'));
  check('ein Entwurf heisst Entwurf', () =>
    assert.equal(documentFileName({ kind: 'invoice', number: null }), 'Entwurf.pdf'));

  /* Der Ablageschluessel im Speicher ist nicht der Dateiname beim Download --
     ohne ausdruecklichen Namen hiess die Datei "download". */
  const link = await (await ruf(`/documents/${rechnung.document.id}/pdf`)).json();
  check('der Downloadlink traegt den Namen mit', () =>
    assert.equal(link.name, `${rechnung.document.number}.pdf`));
  check('und zwar auch in der Adresse selbst', () =>
    assert.match(decodeURIComponent(link.url), new RegExp(`filename="${rechnung.document.number}\\.pdf"`)));

  /* ---- 5. Versand --------------------------------------------------------- */

  const vorherigeMails = postfach.messages.length;

  const entwurfVersand = await ruf(`/documents/${leer.document.id}/send`, {
    method: 'POST', body: JSON.stringify({})
  });
  check('ein Entwurf wird nicht verschickt', () => assert.equal(entwurfVersand.status, 409));
  check('und löst auch keine Mail aus', () => assert.equal(postfach.messages.length, vorherigeMails));

  const versand = await (await ruf(`/documents/${rechnung.document.id}/send`, {
    method: 'POST', body: JSON.stringify({})
  })).json();

  check('die Rechnung geht raus', () => assert.equal(versand.sentTo, 'kundin@example.org'));
  check('und wird als versandt vermerkt', () => assert.ok(versand.document.sentAt));

  const mail = postfach.text();
  check('mit der Nummer im Betreff', () => assert.ok(mail.includes(rechnung.document.number)));
  check('und dem PDF im Anhang', () => assert.match(mail, /application\/pdf/i));
  check('als Anhang mit demselben Namen wie beim Download', () =>
    assert.ok(mail.includes(`${rechnung.document.number}.pdf`)));

  /* ---- 6. Listen und Zustände --------------------------------------------- */

  const liste = await (await ruf('/documents')).json();
  check('alles taucht in der Liste auf', () => assert.equal(liste.counts.total, 5));
  check('Entwürfe werden getrennt gezählt', () => assert.equal(liste.counts.drafts, 2));

  const storniert = await (await ruf(`/documents/${rechnung.document.id}/state`, {
    method: 'POST', body: JSON.stringify({ state: 'cancelled' })
  })).json();
  check('eine Rechnung lässt sich stornieren', () => assert.equal(storniert.document.state, 'cancelled'));

  const unsinn = await ruf(`/documents/${rechnung.document.id}/state`, {
    method: 'POST', body: JSON.stringify({ state: 'bezahlt-vielleicht' })
  });
  check('ausgedachte Zustände werden abgewiesen', () => assert.equal(unsinn.status, 422));

  /* ---- 7. Ohne Anmeldung nichts ------------------------------------------- */

  const fremd = await fetch(`${base}/documents`);
  check('die Belegliste ist ohne Anmeldung zu', () => assert.equal(fremd.status, 401));
} finally {
  server.close();
  postfach.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
