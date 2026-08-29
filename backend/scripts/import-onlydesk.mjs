/**
 * Onlydesk-Auszug in den Kundenstamm übernehmen.
 *
 *   npm run import-onlydesk -- ~/Downloads/onlydesk-auszug.json          Probelauf
 *   npm run import-onlydesk -- ~/Downloads/onlydesk-auszug.json --apply  wirklich schreiben
 *
 * Ohne --apply wird nichts geschrieben. Der Probelauf zeigt, was entstünde,
 * und vor allem, was nicht zugeordnet werden konnte — das ist die Zahl, auf
 * die es ankommt, bevor man einen Datenbestand anfasst.
 *
 * Zweimal laufen zu lassen ist harmlos: Kunden werden über die Mailadresse
 * erkannt, Rechnungen über ihre Originalnummer. Beim zweiten Durchlauf
 * entsteht nichts Neues.
 *
 * Die Ausgabe nennt bewusst keine Namen und keine Adressen, sondern nur
 * Anzahlen und Nummern. Wer prüfen will, ob eine bestimmte Person richtig
 * angekommen ist, schaut im Adminbereich nach.
 */

import { readFileSync } from 'node:fs';

const [, , pfad, ...rest] = process.argv;
const schreiben = rest.includes('--apply');

/* Namen, die im alten System anders lauteten als im Kundenstamm — etwa nach
   einer Namensaenderung. Ausdruecklich anzugeben statt zu raten: eine falsch
   zugeordnete Rechnung haengt an der falschen Person, und das faellt spaeter
   niemandem mehr auf.

   --alias "alter Name=neuer Name", mehrfach erlaubt. */
const aliase = new Map();

for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] !== '--alias') continue;
  const paar = String(rest[i + 1] || '');
  const stelle = paar.indexOf('=');
  if (stelle > 0) aliase.set(paar.slice(0, stelle).trim(), paar.slice(stelle + 1).trim());
}

if (!pfad) {
  console.error('Aufruf: npm run import-onlydesk -- <datei.json> [--apply]');
  process.exit(1);
}

const farbe = process.stdout.isTTY;
const B = farbe ? '\x1b[1m' : '';
const DIM = farbe ? '\x1b[2m' : '';
const G = farbe ? '\x1b[32m' : '';
const R = farbe ? '\x1b[31m' : '';
const N = farbe ? '\x1b[0m' : '';

/* ---------------------------------------------------------------------------
   Umformen
   --------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   Einlesen
   --------------------------------------------------------------------------- */

const { kundenAus, rechnungenAus, zuordnen } = await import('../src/lib/onlydesk-import.js');

const auszug = JSON.parse(readFileSync(pfad, 'utf8'));

const kunden = kundenAus(auszug.kunden);
const rechnungen = rechnungenAus(auszug.rechnungen);

/* ---------------------------------------------------------------------------
   Zuordnen
   --------------------------------------------------------------------------- */

const { zugeordnet, offen } = zuordnen(kunden, rechnungen, aliase);

const ohneMail = kunden.filter((k) => !k.email).length;
const ohnePlz = kunden.filter((k) => !k.address.postalCode).length;

console.log(`
${B}Onlydesk-Import${schreiben ? '' : ` ${DIM}(Probelauf — es wird nichts geschrieben)${N}`}${N}

  Kunden im Auszug        ${B}${kunden.length}${N}
    davon ohne Mailadresse  ${ohneMail}${ohneMail ? `  ${DIM}(nur über den Namen zuzuordnen)${N}` : ''}
    davon ohne Postleitzahl ${ohnePlz}${ohnePlz ? `  ${DIM}(Adresse blieb ungetrennt)${N}` : ''}

  Rechnungen im Auszug    ${B}${rechnungen.length}${N}
    einem Kunden zugeordnet ${G}${zugeordnet.length}${N}
    offen                   ${offen.length ? R : G}${offen.length}${N}
`);

if (offen.length) {
  console.log(`  ${B}Ohne Kunden:${N}`);
  for (const r of offen) {
    console.log(`    ${r.number}  ${DIM}Kunde im Auszug: „${r.kundenName}"${N}`);
  }
  console.log(`\n  ${DIM}Gehoert eine davon zu einem Kunden, der heute anders heisst:${N}`);
  console.log(`  ${DIM}  --alias "${offen[0].kundenName}=So heisst die Person im Kundenstamm"${N}`);
  console.log();
}

const ohneBetrag = rechnungen.filter((r) => r.totalCents === null);
const ohneDatum = rechnungen.filter((r) => !r.date);

if (ohneBetrag.length || ohneDatum.length) {
  console.log(`  ${R}Unvollständig:${N}`);
  for (const r of ohneBetrag) console.log(`    ${r.number}  kein Betrag erkannt`);
  for (const r of ohneDatum) console.log(`    ${r.number}  kein Datum erkannt`);
  console.log();
}

if (!schreiben) {
  console.log(`${DIM}  Sieht das richtig aus, dasselbe noch einmal mit ${N}${B}--apply${N}${DIM}.${N}\n`);
  process.exit(0);
}

/* ---------------------------------------------------------------------------
   Schreiben
   --------------------------------------------------------------------------- */

const { upsertCustomer, addLegacyInvoice } = await import('../src/lib/customers.js');

let neu = 0;
let bekannt = 0;
const idFuer = new Map();

for (const kunde of kunden) {
  const { customer, created } = await upsertCustomer(kunde);
  idFuer.set(kunde, customer.id);
  if (created) neu += 1; else bekannt += 1;
}

let abgelegt = 0;
let schonDa = 0;

for (const { rechnung, kunde } of zugeordnet) {
  const { added } = await addLegacyInvoice(idFuer.get(kunde), rechnung);
  if (added) abgelegt += 1; else schonDa += 1;
}

console.log(`${G}${B}Übernommen.${N}

  Kunden neu angelegt     ${neu}
  Kunden schon vorhanden  ${bekannt}
  Rechnungen abgelegt     ${abgelegt}
  Rechnungen schon da     ${schonDa}
${offen.length ? `\n  ${DIM}Die ${offen.length} offenen Rechnungen wurden nicht abgelegt.${N}` : ''}
`);
