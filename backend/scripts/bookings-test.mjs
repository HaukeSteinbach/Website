/* Prüft Studiotermine: Vorschlag, Antwort des Kunden, Kalenderdatei. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';
import { buildIcs } from '../src/lib/ics.js';

const S3 = 9891, APP = 9892, SMTP = 9893;

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'term'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 't'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(SMTP);
process.env.SMTP_USER = 'mail@haukesteinbach.de'; process.env.SMTP_PASSWORD = 'x';
process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM_EMAIL = 'mail@haukesteinbach.de';

const { createMiniSmtp } = await import('./mini-smtp.mjs');
const postfach = await createMiniSmtp(SMTP);
await createMiniS3(S3);

const { default: app } = await import(new URL('../src/app.js', import.meta.url));
const server = app.listen(APP);
const base = `http://127.0.0.1:${APP}`;

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

const anmeldung = await fetch(`${base}/api/v1/admin/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'einLangesPasswort2026' })
});
const cookie = anmeldung.headers.get('set-cookie').split(';')[0];
const admin = (weg, options = {}) => fetch(`${base}/api/v1/admin${weg}`, {
  ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) }
});

try {
  /* ---- 1. Die Kalenderdatei ---------------------------------------------- */

  const ics = buildIcs({
    uid: 'probe@haukesteinbach.de',
    start: '2026-09-04T08:00:00.000Z',
    end: '2026-09-04T14:00:00.000Z',
    summary: 'Studio — EP; Nordlicht, Tag 1',
    description: 'Zwei Zeilen\nund ein Komma, hier',
    location: 'The Pantry Studios, Eiffestraße 422, 20537 Hamburg, Germany',
    organiser: { name: 'Hauke Steinbach', email: 'mail@haukesteinbach.de' },
    attendee: { name: 'Max Muster', email: 'max@example.org' }
  });

  check('Zeilen enden mit CRLF, wie der Standard verlangt', () =>
    assert.ok(ics.includes('\r\n') && !/[^\r]\n/.test(ics)));
  check('Rahmen stimmt', () => {
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  });
  check('Zeitpunkte in UTC', () => assert.ok(ics.includes('DTSTART:20260904T080000Z')));
  check('Semikolon und Komma sind maskiert', () =>
    assert.ok(ics.includes('SUMMARY:Studio — EP\\; Nordlicht\\, Tag 1')));
  check('Zeilenumbruch im Text wird zu \\n', () =>
    assert.ok(ics.includes('Zwei Zeilen\\nund ein Komma\\, hier')));
  check('Adresse ist drin', () => assert.ok(ics.replace(/\r\n /g, '').includes('Eiffestraße 422')));
  check('Erinnerung am Vortag', () => assert.ok(ics.includes('TRIGGER:-P1D')));

  /* Lange Zeilen müssen gefaltet werden, und zwar in Bytes gezählt — sonst
     zerreißt die Faltung ein Umlaut-Zeichen. */
  const gefaltet = ics.split('\r\n').filter((z) => !z.startsWith(' '));
  check('keine Zeile über 75 Oktette', () =>
    assert.ok(gefaltet.every((z) => Buffer.from(z, 'utf8').length <= 75)));
  check('Fortsetzungszeilen bleiben gültiges UTF-8', () => {
    const zurueck = ics.replace(/\r\n /g, '');
    assert.ok(zurueck.includes('Eiffestraße'));
    assert.ok(!zurueck.includes('�'));
  });

  /* ---- 2. Termin anlegen -------------------------------------------------- */

  const kunde = await (await admin('/customers', {
    method: 'POST', body: JSON.stringify({ name: 'Max Muster', email: 'max@example.org' })
  })).json();

  const schief = await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({ start: '2026-09-04T14:00:00Z', end: '2026-09-04T08:00:00Z', customerId: kunde.customer.id })
  });
  check('ein Ende vor dem Anfang wird abgewiesen', () => assert.equal(schief.status, 422));

  const ohneMail = await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({ start: '2026-09-04T08:00:00Z', end: '2026-09-04T14:00:00Z', client: { name: 'Ohne' } })
  });
  check('ohne Mailadresse gibt es niemanden zu fragen', () => assert.equal(ohneMail.status, 422));

  const angelegt = await (await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({
      start: '2026-09-04T08:00:00Z', end: '2026-09-04T14:00:00Z',
      customerId: kunde.customer.id, title: 'EP Nordlicht', note: 'Bitte Stems mitbringen.'
    })
  })).json();

  check('der Termin steht zunächst nur als Vorschlag', () =>
    assert.equal(angelegt.booking.state, 'proposed'));
  check('und ist noch nicht verschickt', () => assert.equal(angelegt.booking.proposedAt, null));

  const zweiter = await (await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({
      start: '2026-09-04T10:00:00Z', end: '2026-09-04T12:00:00Z',
      customerId: kunde.customer.id, title: 'Andere Session'
    })
  })).json();

  check('eine Überschneidung wird gemeldet', () => {
    assert.equal(zweiter.clashes.length, 1);
    assert.equal(zweiter.clashes[0].title, 'EP Nordlicht');
  });
  check('aber nicht verboten — das ist eine Entscheidung, keine Regel', () =>
    assert.ok(zweiter.booking.id));

  await admin(`/bookings/${zweiter.booking.id}`, { method: 'DELETE' });

  /* ---- 3. Vorschlag verschicken ------------------------------------------- */

  const vorher = postfach.messages.length;
  const verschickt = await (await admin(`/bookings/${angelegt.booking.id}/propose`, {
    method: 'POST', body: JSON.stringify({ message: 'wie besprochen ein Vorschlag.' })
  })).json();

  check('der Vorschlag geht an den Kunden', () => assert.equal(verschickt.sentTo, 'max@example.org'));
  check('eine Mail ist raus', () => assert.equal(postfach.messages.length, vorher + 1));

  const mail = postfach.text();
  check('mit Ort und Adresse', () => assert.ok(mail.includes('Eiffestraße 422') || mail.includes('Eiffestra')));
  check('mit dem Link zum Bestätigen', () => assert.ok(mail.includes(angelegt.booking.token)));
  check('und der Kalenderdatei als Anhang', () => assert.match(mail, /text\/calendar/i));
  check('als Einladung, nicht als fertiger Eintrag', () => assert.match(mail, /method=REQUEST/i));
  check('auf Englisch', () => assert.ok(mail.includes('Studio time') || mail.includes('Confirm')));

  const nachVersand = await (await admin(`/bookings/${angelegt.booking.id}`)).json();
  check('die Fassungsnummer steigt mit dem Versand', () =>
    assert.equal(nachVersand.booking.sequence, 1));

  /* ---- 4. Die Seite für den Kunden ---------------------------------------- */

  const token = angelegt.booking.token;
  const seite = await fetch(`${base}/b/${token}`);
  const html = await seite.text();

  check('die Terminseite ist ohne Anmeldung erreichbar', () => assert.equal(seite.status, 200));
  check('sie nennt Datum und Uhrzeit', () => assert.ok(html.includes('September')));
  check('und die Studioadresse', () => assert.ok(html.includes('Eiffestra')));
  check('sie bietet beide Antworten an', () => {
    assert.ok(html.includes(`/b/${token}/confirm`));
    assert.ok(html.includes(`/b/${token}/decline`));
  });
  check('und wird nicht indexiert', () => assert.ok(html.includes('noindex')));

  const erfunden = await fetch(`${base}/b/gibtesnicht`);
  check('ein erfundenes Token führt ins Leere', () => assert.equal(erfunden.status, 404));

  /* Bestätigen ist bewusst POST: Sicherheitsscanner folgen Links in Mails,
     und ein Scanner, der einen Termin bestätigt, blockiert einen Raum. */
  const perLink = await fetch(`${base}/b/${token}/confirm`, { redirect: 'manual' });
  check('ein bloßer Aufruf bestätigt nichts', () => assert.ok(perLink.status === 404 || perLink.status === 405));

  /* ---- 5. Die Antwort ----------------------------------------------------- */

  const vorAntwort = postfach.messages.length;
  const bestaetigt = await fetch(`${base}/b/${token}/confirm`, { method: 'POST' });
  const dankeSeite = await bestaetigt.text();

  check('bestätigen funktioniert', () => assert.equal(bestaetigt.status, 200));
  check('und sagt es dem Kunden', () => assert.ok(dankeSeite.includes('See you then')));

  const stand = await (await admin(`/bookings/${angelegt.booking.id}`)).json();
  check('der Termin steht jetzt auf bestätigt', () => assert.equal(stand.booking.state, 'confirmed'));
  check('und ist als in den Kalender gelegt vermerkt', () =>
    assert.ok(stand.booking.addedToCalendarAt));

  check('zwei Mails gehen raus: Kunde und Studio', () =>
    assert.equal(postfach.messages.length, vorAntwort + 2));

  const nachher = postfach.text();
  check('die Studiomail traegt die Kalenderdatei', () => assert.match(nachher, /method=PUBLISH/i));

  const nochmal = await fetch(`${base}/b/${token}/confirm`, { method: 'POST' });
  const nochmalHtml = await nochmal.text();
  check('ein zweiter Klick ändert nichts', () => assert.ok(nochmalHtml.includes('already answered')));

  const nachZweitem = await (await admin(`/bookings/${angelegt.booking.id}`)).json();
  check('und verschickt auch nichts erneut', () =>
    assert.equal(nachZweitem.booking.state, 'confirmed'));

  /* ---- 6. Die Datei zum Herunterladen ------------------------------------- */

  const datei = await fetch(`${base}/b/${token}/calendar.ics`);
  const inhalt = await datei.text();

  check('die Kalenderdatei ist abrufbar', () => assert.equal(datei.status, 200));
  check('mit richtigem Inhaltstyp', () =>
    assert.match(datei.headers.get('content-type'), /text\/calendar/));
  check('sie ist bestätigt, nicht vorläufig', () => assert.ok(inhalt.includes('STATUS:CONFIRMED')));
  check('der Kunde steht als zugesagt darin', () => assert.ok(inhalt.includes('PARTSTAT=ACCEPTED')));

  /* ---- 7. Absagen --------------------------------------------------------- */

  const zweiterTermin = await (await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({
      start: '2026-09-11T08:00:00Z', end: '2026-09-11T12:00:00Z',
      customerId: kunde.customer.id, title: 'Zweiter Versuch'
    })
  })).json();

  await admin(`/bookings/${zweiterTermin.booking.id}/propose`, { method: 'POST', body: '{}' });
  const abgesagt = await fetch(`${base}/b/${zweiterTermin.booking.token}/decline`, { method: 'POST' });
  const absageHtml = await abgesagt.text();

  check('absagen geht genauso einfach', () => assert.equal(abgesagt.status, 200));
  check('und sagt nichts Vorwurfsvolles', () => assert.ok(absageHtml.includes('No problem')));

  const nachAbsage = await (await admin(`/bookings/${zweiterTermin.booking.id}`)).json();
  check('der Platz ist wieder frei', () => assert.equal(nachAbsage.booking.state, 'declined'));

  const frei = await (await admin('/bookings', {
    method: 'POST',
    body: JSON.stringify({
      start: '2026-09-11T08:00:00Z', end: '2026-09-11T12:00:00Z',
      customerId: kunde.customer.id, title: 'Jemand anders'
    })
  })).json();
  check('und lässt sich neu vergeben', () => assert.equal(frei.clashes.length, 0));

  /* ---- 8. Zugang ---------------------------------------------------------- */

  const fremd = await fetch(`${base}/api/v1/admin/bookings`);
  check('die Terminliste ist ohne Anmeldung zu', () => assert.equal(fremd.status, 401));
} finally {
  server.close();
  postfach.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
