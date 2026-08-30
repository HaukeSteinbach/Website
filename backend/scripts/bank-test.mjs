/* Prüft das Einlesen von Kontoauszügen und die Zuordnung zu Rechnungen.
   Die Auszüge hier sind nachgebaut, nicht echt. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';
import { buchungenAus, centsAus, datumAus, erkenneSpalten, ordneZu, parseCsv } from '../src/lib/bank-import.js';

const S3 = 9931, APP = 9932;
process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'bank'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'b'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;

await createMiniS3(S3);
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
  ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) }
});

try {
  /* ---- 1. Zahlen und Daten ------------------------------------------------ */

  check('deutsches Format', () => assert.equal(centsAus('1.234,56'), 123456));
  check('englisches Format', () => assert.equal(centsAus('1,234.56'), 123456));
  check('ohne Trennzeichen', () => assert.equal(centsAus('40'), 4000));
  check('mit Währung und Leerzeichen', () => assert.equal(centsAus('260,00 €'), 26000));
  check('negativ', () => assert.equal(centsAus('-19,99'), -1999));
  check('leer', () => assert.equal(centsAus(''), null));

  /* Drei Ziffern nach dem Punkt sind ein Tausenderpunkt, keine Cent. */
  check('Tausenderpunkt ohne Cent', () => assert.equal(centsAus('1.234'), 123400));

  check('ISO-Datum', () => assert.equal(datumAus('2026-08-30T10:00:00Z'), '2026-08-30'));
  check('deutsches Datum', () => assert.equal(datumAus('30.08.2026'), '2026-08-30'));
  check('zweistelliges Jahr', () => assert.equal(datumAus('01.09.26'), '2026-09-01'));

  /* ---- 2. CSV ------------------------------------------------------------- */

  check('Semikolon wird erkannt', () =>
    assert.deepEqual(parseCsv('a;b;c\n1;2;3')[1], ['1', '2', '3']));
  check('Komma wird erkannt', () =>
    assert.deepEqual(parseCsv('a,b,c\n1,2,3')[1], ['1', '2', '3']));
  check('Anführungszeichen mit Trennzeichen darin', () =>
    assert.deepEqual(parseCsv('a;b\n"eins;zwei";drei')[1], ['eins;zwei', 'drei']));
  check('doppelte Anführungszeichen', () =>
    assert.deepEqual(parseCsv('a\n"sagte ""hallo"""')[1], ['sagte "hallo"']));
  check('Zeilenumbruch im Feld', () =>
    assert.equal(parseCsv('a;b\n"zwei\nZeilen";x')[1][0], 'zwei\nZeilen'));

  check('Spalten aus deutschem Kopf', () => {
    const spalten = erkenneSpalten(['Buchungsdatum', 'Betrag', 'Währung', 'Verwendungszweck', 'Name']);
    assert.equal(spalten.date, 0);
    assert.equal(spalten.amount, 1);
    assert.equal(spalten.reference, 3);
  });

  check('Spalten aus englischem Kopf', () => {
    const spalten = erkenneSpalten(['Date', 'Amount', 'Currency', 'Description', 'Counterparty']);
    assert.equal(spalten.date, 0);
    assert.equal(spalten.reference, 3);
    assert.equal(spalten.counterparty, 4);
  });

  /* Der echte Kopf eines Vivid-Exports. Er steht hier, weil genau daran meine
     erste Fassung gescheitert ist: "Payment amount" beginnt nicht mit "amount",
     und ein verankertes Muster fand die Spalte nicht. */
  const VIVID_KOPF = ['Completed date', 'Counterparty name', 'Reference', 'Payment amount', 'Payment currency'];

  check('Vivid: alle fünf Spalten werden erkannt', () => {
    assert.deepEqual(erkenneSpalten(VIVID_KOPF), {
      date: 0, counterparty: 1, reference: 2, amount: 3, currency: 4
    });
  });

  const vivid = buchungenAus([
    VIVID_KOPF.join('\t'),
    '',
    '06.02.2026\tPatreon, Inc.\tPatreon Withdrawal\t30.51\tEUR',
    '14.03.2026\tMILES MOBILITY GMBH, BERLIN, DE\tMILES MOBILITY GMBH, BERLIN, DE\t-18.52\tEUR'
  ].join('\n'));

  check('Vivid: Tabulator als Trennzeichen', () => assert.equal(vivid.buchungen.length, 1));
  check('Vivid: die Leerzeile stört nicht', () => assert.equal(vivid.zeilen, 2));
  check('Vivid: Punkt als Dezimaltrennzeichen', () =>
    assert.equal(vivid.buchungen[0].amountCents, 3051));
  check('Vivid: Datum und Gegenseite', () => {
    assert.equal(vivid.buchungen[0].date, '2026-02-06');
    assert.equal(vivid.buchungen[0].counterparty, 'Patreon, Inc.');
    assert.equal(vivid.buchungen[0].reference, 'Patreon Withdrawal');
  });
  check('Vivid: die Abbuchung fällt weg', () =>
    assert.ok(!vivid.buchungen.some((b) => b.amountCents < 0)));

  /* ---- 3. Nur Eingänge ---------------------------------------------------- */

  const auszug = [
    'Date;Amount;Currency;Description;Counterparty',
    '30.08.2026;260,00;EUR;HS-2026-08-30-0001 Mastering;Max Muster',
    '29.08.2026;-12,99;EUR;Spotify;Spotify AB',
    '28.08.2026;40,00;EUR;Ohne Nummer;Jemand',
    '27.08.2026;999,00;EUR;Passt zu nichts;Wer'
  ].join('\n');

  const gelesen = buchungenAus(auszug);
  check('Abgänge fallen weg', () => assert.equal(gelesen.buchungen.length, 3));
  check('der Verwendungszweck kommt an', () =>
    assert.match(gelesen.buchungen[0].reference, /HS-2026-08-30-0001/));

  /* ---- 4. Zuordnen -------------------------------------------------------- */

  const offene = [
    { id: 'a', kind: 'document', number: 'HS-2026-08-30-0001', totalCents: 26000, date: '2026-08-30', who: 'Max' },
    { id: 'b', kind: 'document', number: 'HS-2026-08-20-0001', totalCents: 4000, date: '2026-08-20', who: 'Jemand' }
  ];

  const zugeordnet = ordneZu(gelesen.buchungen, offene);

  check('Nummer im Verwendungszweck trifft sicher', () => {
    const treffer = zugeordnet.treffer.find((t) => t.grund === 'number');
    assert.equal(treffer.rechnung.number, 'HS-2026-08-30-0001');
    assert.equal(treffer.sicher, true);
  });

  check('ein eindeutiger Betrag trifft auch, aber unsicher', () => {
    const treffer = zugeordnet.treffer.find((t) => t.grund === 'amount');
    assert.equal(treffer.rechnung.number, 'HS-2026-08-20-0001');
    assert.equal(treffer.sicher, false);
  });

  check('was zu nichts passt, bleibt liegen', () => {
    assert.equal(zugeordnet.uebrig.length, 1);
    assert.equal(zugeordnet.uebrig[0].grund, 'no_match');
  });

  /* Der wichtigste Fall: zwei Rechnungen über denselben Betrag. Hier zu raten
     hiesse, zwei Buchungen falsch zu stellen, ohne dass es auffällt. */
  const zwilling = ordneZu(
    buchungenAus('Date;Amount;Description\n30.08.2026;40,00;Überweisung').buchungen,
    [
      { id: 'a', kind: 'document', number: 'HS-1', totalCents: 4000, date: '2026-08-01', who: 'Eine' },
      { id: 'b', kind: 'document', number: 'HS-2', totalCents: 4000, date: '2026-08-02', who: 'Andere' }
    ]
  );

  check('bei zwei gleich hohen Rechnungen wird nichts geraten', () => {
    assert.equal(zwilling.treffer.length, 0);
    assert.equal(zwilling.uebrig[0].grund, 'ambiguous');
    assert.deepEqual(zwilling.uebrig[0].kandidaten, ['HS-1', 'HS-2']);
  });

  check('eine Zahlung lange vor der Rechnung zählt nicht', () => {
    const frueh = ordneZu(
      buchungenAus('Date;Amount;Description\n01.01.2026;40,00;x').buchungen,
      [{ id: 'a', kind: 'document', number: 'HS-9', totalCents: 4000, date: '2026-08-01', who: 'X' }]
    );
    assert.equal(frueh.treffer.length, 0);
  });

  check('dieselbe Rechnung wird nicht zweimal getroffen', () => {
    const doppelt = ordneZu(
      buchungenAus('Date;Amount;Description\n30.08.2026;40,00;x\n31.08.2026;40,00;y').buchungen,
      [{ id: 'a', kind: 'document', number: 'HS-9', totalCents: 4000, date: '2026-08-01', who: 'X' }]
    );
    assert.equal(doppelt.treffer.length, 1);
    assert.equal(doppelt.uebrig.length, 1);
  });

  /* ---- 5. Durch die Route ------------------------------------------------- */

  const kunde = await (await ruf('/customers', {
    method: 'POST', body: JSON.stringify({ name: 'Zahlerin', email: 'zahlerin@example.org' })
  })).json();

  const entwurf = await (await ruf('/documents', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'invoice', customerId: kunde.customer.id, title: 'Mastering',
      items: [{ slug: 'mastering', quantity: 1 }]
    })
  })).json();
  const rechnung = await (await ruf(`/documents/${entwurf.document.id}/issue`, { method: 'POST' })).json();
  const nummer = rechnung.document.number;

  const leer = await ruf('/payments/preview', { method: 'POST', body: JSON.stringify({ csv: '' }) });
  check('eine leere Datei wird abgewiesen', () => assert.equal(leer.status, 422));

  const ohneSpalten = await ruf('/payments/preview', {
    method: 'POST', body: JSON.stringify({ csv: 'foo;bar\n1;2' })
  });
  check('unbekannte Spalten werden benannt, nicht geraten', async () => {
    assert.equal(ohneSpalten.status, 422);
  });
  const grund = await ohneSpalten.json();
  check('und der Kopf steht in der Meldung', () => assert.match(grund.message, /foo \| bar/));

  const vorschau = await (await ruf('/payments/preview', {
    method: 'POST',
    body: JSON.stringify({ csv: `Datum;Betrag;Verwendungszweck;Name\n30.08.2026;40,00;${nummer} danke;Zahlerin` })
  })).json();

  check('die Route findet die Rechnung über die Nummer', () => {
    assert.equal(vorschau.matches.length, 1);
    assert.equal(vorschau.matches[0].number, nummer);
    assert.equal(vorschau.matches[0].certain, true);
  });

  const eingetragen = await (await ruf('/payments/apply', {
    method: 'POST', body: JSON.stringify({ matches: vorschau.matches })
  })).json();

  check('und trägt sie als bezahlt ein', () => assert.equal(eingetragen.paid, 1));

  const danach = await (await ruf(`/documents/${entwurf.document.id}`)).json();
  check('der Beleg steht auf bezahlt', () => assert.equal(danach.document.state, 'paid'));
  check('mit Datum und Betrag der Zahlung', () => {
    assert.equal(danach.document.payment.amountCents, 4000);
    assert.equal(danach.document.payment.date, '2026-08-30');
  });

  const nochmal = await (await ruf('/payments/apply', {
    method: 'POST', body: JSON.stringify({ matches: vorschau.matches })
  })).json();
  check('zweimal dieselbe Zahlung ändert nichts mehr', () => {
    assert.equal(nochmal.paid, 0);
    assert.equal(nochmal.failed[0].reason, 'not_issued');
  });

  const wieder = await (await ruf('/payments/preview', {
    method: 'POST',
    body: JSON.stringify({ csv: `Datum;Betrag;Verwendungszweck\n30.08.2026;40,00;${nummer}` })
  })).json();
  check('eine bezahlte Rechnung steht nicht mehr offen', () => assert.equal(wieder.matches.length, 0));

  const fremd = await fetch(`${base}/payments/preview`, { method: 'POST' });
  check('ohne Anmeldung geht gar nichts', () => assert.equal(fremd.status, 401));
} finally {
  server.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
