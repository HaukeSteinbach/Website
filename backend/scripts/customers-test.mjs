/* Prüft die Umformung des Onlydesk-Auszugs und den Kundenstamm dahinter.
   Alle Zeilen hier sind erfunden — echte Kundendaten haben in Tests nichts
   zu suchen, und die Fälle lassen sich so gezielter stellen. */
import assert from 'node:assert/strict';

import { createMiniS3 } from './mini-s3.mjs';
import {
  adresse, centsAus, datumAus, kontakt, schluessel,
  kundenAus, rechnungenAus, zuordnen
} from '../src/lib/onlydesk-import.js';

const S3 = 9961;
process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'kunden'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto';

const { objects } = await createMiniS3(S3);

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };
const checkAsync = async (n, f) => { try { await f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

/* ---- 1. Adressen ------------------------------------------------------- */

check('Straße, PLZ, Ort', () =>
  assert.deepEqual(adresse('Musterweg 3\n22765 Hamburg'),
    { line1: 'Musterweg 3', line2: '', postalCode: '22765', city: 'Hamburg', country: '' }));

check('Land als letzte Zeile', () =>
  assert.equal(adresse('Musterweg 3\n27572 Bremerhaven\nGermany').country, 'Germany'));

check('vierstellige Postleitzahl', () =>
  assert.equal(adresse('Ringstrasse 1\n8001 Zürich\nSchweiz').postalCode, '8001'));

check('mehrzeilige Straße bleibt beisammen', () =>
  assert.equal(adresse('Firma XY\nHinterhaus 2\n10965 Berlin').line1, 'Firma XY, Hinterhaus 2'));

/* Ohne Postleitzahlzeile lieber gar nicht trennen, als etwas zu erfinden. */
check('keine erkennbare PLZ: alles bleibt Straße', () => {
  const a = adresse('Irgendwo im Nirgendwo');
  assert.equal(a.line1, 'Irgendwo im Nirgendwo');
  assert.equal(a.postalCode, '');
  assert.equal(a.city, '');
});

/* ---- 2. Kontakt --------------------------------------------------------- */

check('Mail und Telefon auseinanderhalten', () => {
  const k = kontakt('0170 1234567\nwer@example.org');
  assert.equal(k.email, 'wer@example.org');
  assert.equal(k.phone, '0170 1234567');
});

check('nur eine Mailadresse', () => {
  const k = kontakt('wer@example.org');
  assert.equal(k.phone, '');
});

check('Richtungsmarken aus der Nummer entfernt', () =>
  assert.equal(kontakt('‪+49 174 6729620‬').phone, '+49 174 6729620'));

/* ---- 3. Beträge und Daten ---------------------------------------------- */

check('380,00€', () => assert.equal(centsAus('380,00€'), 38000));
check('Tausenderpunkt', () => assert.equal(centsAus('1.234,56€'), 123456));
check('negativer Betrag', () => assert.equal(centsAus('-90,00€'), -9000));
check('kein Betrag erkennbar', () => assert.equal(centsAus('—'), null));
check('deutsches Datum', () => assert.equal(datumAus('29.08.2026'), '2026-08-29'));
check('kein Datum erkennbar', () => assert.equal(datumAus(''), ''));

/* ---- 4. Namensvergleich ------------------------------------------------- */

check('Anrede stört nicht', () =>
  assert.equal(schluessel('Herr Max Muster'), schluessel('Max Muster')));
check('Rechtsform stört nicht', () =>
  assert.equal(schluessel('Beispiel GmbH & Co. KG'), schluessel('Beispiel')));
check('verschiedene Namen bleiben verschieden', () =>
  assert.notEqual(schluessel('Max Muster'), schluessel('Moritz Muster')));

/* ---- 5. Zusammensetzen und Zuordnen ------------------------------------- */

const kundenReihen = [
  ['Herr Max Muster', 'Musterweg 3\n22765 Hamburg', '0170 1234567\nmax@example.org', 'DE123456789', 'Stammkunde', ''],
  ['Beispiel GmbH\nAnsprechpartnerin Ada', 'Hauptstr. 1\n10115 Berlin', 'info@example.com', '', '', ''],
  ['Ohne Kontakt', 'Nirgendwo 1\n12345 Ort', '', '', '', '']
];

const kunden = kundenAus(kundenReihen);

check('drei Kunden entstehen', () => assert.equal(kunden.length, 3));
check('Anrede bleibt im Namen erhalten', () => assert.equal(kunden[0].name, 'Herr Max Muster'));
check('zweite Namenszeile landet in der Notiz', () =>
  assert.match(kunden[1].note, /Ansprechpartnerin Ada/));
check('Notizspalte kommt dazu', () => assert.match(kunden[0].note, /Stammkunde/));
check('Kunde ohne Mailadresse ist erlaubt', () => assert.equal(kunden[2].email, ''));

const rechnungen = rechnungenAus([
  ['2026-05-18-0001', '380,00€', 'Max Muster', 'Bezahlt', '18.05.2026', ''],
  ['2026-06-01-0001', '90,00€', 'Beispiel GmbH & Co. KG', 'Ausgestellt', '01.06.2026', ''],
  ['2026-06-02-0001', '10,00€', 'Wer Anders', 'Storniert', '02.06.2026', '']
]);

check('Status wird übersetzt', () =>
  assert.deepEqual(rechnungen.map((r) => r.status), ['paid', 'issued', 'cancelled']));

const { zugeordnet, offen } = zuordnen(kunden, rechnungen);

check('zwei Rechnungen finden ihren Kunden', () => assert.equal(zugeordnet.length, 2));
check('eine bleibt offen statt geraten zu werden', () => {
  assert.equal(offen.length, 1);
  assert.equal(offen[0].number, '2026-06-02-0001');
});

const mitAlias = zuordnen(kunden, rechnungen, new Map([['Wer Anders', 'Ohne Kontakt']]));
check('ein Alias schließt die Lücke', () => assert.equal(mitAlias.offen.length, 0));

/* ---- 6. Der Kundenstamm ------------------------------------------------- */

const { upsertCustomer, addLegacyInvoice, listCustomers, deleteCustomer } =
  await import('../src/lib/customers.js');

const ersteAnlage = await upsertCustomer(kunden[0]);
await checkAsync('ein Kunde wird angelegt', async () => assert.equal(ersteAnlage.created, true));

const zweiteAnlage = await upsertCustomer(kunden[0]);
await checkAsync('derselbe Kunde entsteht kein zweites Mal', async () => {
  assert.equal(zweiteAnlage.created, false);
  assert.equal(zweiteAnlage.customer.id, ersteAnlage.customer.id);
});

await checkAsync('gleiche Adresse in Großbuchstaben ist dieselbe Person', async () => {
  const gross = await upsertCustomer({ ...kunden[0], email: 'MAX@EXAMPLE.ORG' });
  assert.equal(gross.created, false);
});

const id = ersteAnlage.customer.id;
const abgelegt = await addLegacyInvoice(id, rechnungen[0]);
await checkAsync('alte Rechnung wird abgelegt', async () => assert.equal(abgelegt.added, true));

await checkAsync('und zwar nur einmal', async () =>
  assert.equal((await addLegacyInvoice(id, rechnungen[0])).added, false));

await checkAsync('mit unveränderter Originalnummer', async () => {
  const alle = await listCustomers();
  const kunde = alle.find((k) => k.id === id);
  assert.equal(kunde.legacyInvoices[0].number, '2026-05-18-0001');
  assert.ok(!kunde.legacyInvoices[0].number.startsWith('HS-'));
});

await checkAsync('ein Kunde mit Rechnungen lässt sich nicht löschen', async () => {
  const versuch = await deleteCustomer(id);
  assert.equal(versuch.deleted, false);
  assert.equal(versuch.reason, 'has_invoices');
});

await checkAsync('ein Kunde ohne Rechnungen schon', async () => {
  const ohne = await upsertCustomer(kunden[2]);
  assert.equal((await deleteCustomer(ohne.customer.id)).deleted, true);
});

await checkAsync('der Bestand überlebt einen Neustart, weil er nur ein Objekt ist', async () => {
  assert.ok(objects.has('customers/index.json'));
  const wieder = await listCustomers();
  assert.ok(wieder.some((k) => k.id === id));
});

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
