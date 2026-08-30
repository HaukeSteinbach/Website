/**
 * Kontoumsätze einlesen und Rechnungen zuordnen.
 *
 * Eingabe ist der CSV-Export aus dem Banking — Vivid, aber nichts hier hängt
 * daran. Banken benennen ihre Spalten alle anders und ändern das gelegentlich,
 * deshalb wird die Kopfzeile gelesen statt eine feste Reihenfolge angenommen.
 * Was nicht erkannt wird, sagt der Bericht; geraten wird nichts.
 *
 * Zugeordnet wird zweistufig, und die Reihenfolge ist der Kern:
 *
 *   1. Steht die Rechnungsnummer im Verwendungszweck, ist die Sache klar.
 *      Deshalb bittet die Rechnung darum, sie anzugeben.
 *   2. Sonst über Betrag und Zeitfenster — aber nur, wenn genau eine offene
 *      Rechnung passt. Passen zwei, wird keine genommen: eine Zahlung der
 *      falschen Rechnung zuzuordnen ist schlimmer, als sie liegenzulassen,
 *      weil danach beide Buchungen falsch sind und es niemandem auffällt.
 *
 * Gespeichert wird am Ende nur, was zur Zahlung gehört — Datum, Betrag,
 * Verwendungszweck. Der Kontoauszug selbst gehört in die Buchhaltung und
 * nicht in eine Website.
 */

/* ---------------------------------------------------------------------------
   CSV
   --------------------------------------------------------------------------- */

/**
 * Das Trennzeichen aus der Kopfzeile erraten.
 *
 * Deutsche Ausfüge nutzen meist das Semikolon, weil das Komma schon im Betrag
 * steckt. Gezählt wird nur in der ersten Zeile: im Verwendungszweck steht
 * später alles Mögliche.
 */
function trennzeichen(kopfzeile) {
  const kandidaten = [';', ',', '\t', '|'];
  let bester = ';';
  let meiste = 0;

  for (const zeichen of kandidaten) {
    const anzahl = kopfzeile.split(zeichen).length - 1;

    if (anzahl > meiste) {
      meiste = anzahl;
      bester = zeichen;
    }
  }

  return bester;
}

/**
 * CSV zerlegen, mit Anführungszeichen und eingebetteten Zeilenumbrüchen.
 *
 * Von Hand statt mit einer Abhängigkeit: die Regeln passen in dreißig Zeilen,
 * und ein Kontoauszug ist nichts, wofür man ein Paket mitschleppen will.
 */
export function parseCsv(text) {
  const roh = String(text || '').replace(/^﻿/, '');
  const erste = roh.split(/\r?\n/)[0] || '';
  const trenner = trennzeichen(erste);

  const zeilen = [];
  let feld = '';
  let zeile = [];
  let inAnfuehrung = false;

  for (let i = 0; i < roh.length; i += 1) {
    const zeichen = roh[i];

    if (inAnfuehrung) {
      if (zeichen === '"') {
        /* Zwei Anführungszeichen hintereinander sind ein echtes. */
        if (roh[i + 1] === '"') { feld += '"'; i += 1; } else { inAnfuehrung = false; }
      } else {
        feld += zeichen;
      }
      continue;
    }

    if (zeichen === '"') { inAnfuehrung = true; continue; }
    if (zeichen === trenner) { zeile.push(feld); feld = ''; continue; }

    if (zeichen === '\n') {
      zeile.push(feld.replace(/\r$/, ''));
      zeilen.push(zeile);
      zeile = [];
      feld = '';
      continue;
    }

    feld += zeichen;
  }

  if (feld || zeile.length) {
    zeile.push(feld.replace(/\r$/, ''));
    zeilen.push(zeile);
  }

  return zeilen.filter((z) => z.some((v) => String(v).trim() !== ''));
}

/* ---------------------------------------------------------------------------
   Spalten erkennen
   --------------------------------------------------------------------------- */

/* Erst die genauen Muster, dann die weiten. Vivid schreibt "Payment amount"
   und "Completed date", andere Banken "Betrag" und "Buchungstag" — verankerte
   Muster allein finden das eine oder das andere, nie beides. Die Reihenfolge
   entscheidet dabei: "Zahlungsdatum" soll als Datum durchgehen und nicht als
   Zahlungsart, deshalb steht das Genaue vorn. */
const SPALTEN = {
  date: [
    /^(buchungs|wert)?(datum|tag)$/, /^date$/, /^completed/, /^created/,
    /booking.?date/, /value.?date/, /datum/, /\bdate\b/
  ],
  amount: [/^betrag/, /^amount/, /^summe/, /^value$/, /umsatz/, /amount/, /betrag/],
  currency: [/^währung/, /^waehrung/, /^currency/, /currency/, /währung/, /waehrung/],
  reference: [
    /verwendungszweck/, /^referenz/, /^reference/, /reference/,
    /description/, /^betreff/, /^zweck/, /^note/, /details/
  ],
  counterparty: [
    /counterparty/, /empfänger/, /empfaenger/, /zahlungspflichtig/, /auftraggeber/,
    /^name/, /payer/, /beneficiary/, /^partner/, /\bname\b/
  ],
  type: [/^typ$/, /^type$/, /^art$/, /richtung/, /direction/]
};

/**
 * Aus der Kopfzeile ableiten, welche Spalte was ist.
 *
 * Der erste Treffer gewinnt, und die Muster stehen nach Verlässlichkeit
 * sortiert — "Verwendungszweck" ist eindeutiger als "description", das auch
 * an einer Gebührenzeile stehen kann.
 */
export function erkenneSpalten(kopf) {
  const sauber = kopf.map((h) => String(h || '').trim().toLowerCase());
  const gefunden = {};

  for (const [feld, muster] of Object.entries(SPALTEN)) {
    for (const regel of muster) {
      const treffer = sauber.findIndex((h) => regel.test(h));

      if (treffer !== -1 && !Object.values(gefunden).includes(treffer)) {
        gefunden[feld] = treffer;
        break;
      }
    }
  }

  return gefunden;
}

/**
 * "1.234,56", "-1234.56", "1 234,56 €" → Cent.
 *
 * Das Trennzeichen entscheidet sich am letzten Satzzeichen: was danach zwei
 * Stellen hat, sind Cent. Ohne diese Regel wird aus "1.234" mal Tausend und
 * mal ein Komma-Betrag, je nach Land.
 */
export function centsAus(wert) {
  const roh = String(wert || '').replace(/[^\d,.\-+]/g, '').trim();

  if (!roh || !/\d/.test(roh)) {
    return null;
  }

  const negativ = roh.startsWith('-');
  const ziffern = roh.replace(/[-+]/g, '');
  const letztesKomma = Math.max(ziffern.lastIndexOf(','), ziffern.lastIndexOf('.'));

  let ganze;
  let cent = '00';

  if (letztesKomma !== -1 && ziffern.length - letztesKomma - 1 <= 2) {
    ganze = ziffern.slice(0, letztesKomma).replace(/[.,]/g, '');
    cent = ziffern.slice(letztesKomma + 1).padEnd(2, '0');
  } else {
    ganze = ziffern.replace(/[.,]/g, '');
  }

  const betrag = Number(ganze || '0') * 100 + Number(cent);

  return negativ ? -betrag : betrag;
}

/** Verschiedene Datumsschreibweisen auf JJJJ-MM-TT bringen. */
export function datumAus(wert) {
  const roh = String(wert || '').trim();

  const iso = roh.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const deutsch = roh.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (deutsch) {
    const jahr = deutsch[3].length === 2 ? `20${deutsch[3]}` : deutsch[3];
    return `${jahr}-${deutsch[2].padStart(2, '0')}-${deutsch[1].padStart(2, '0')}`;
  }

  const schraeg = roh.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (schraeg) return `${schraeg[3]}-${schraeg[1].padStart(2, '0')}-${schraeg[2].padStart(2, '0')}`;

  return '';
}

/**
 * Aus dem Auszug die Eingänge machen.
 *
 * Abgänge fallen weg: eine Rechnung wird durch Geld bezahlt, das ankommt.
 */
export function buchungenAus(text) {
  const zeilen = parseCsv(text);

  if (zeilen.length < 2) {
    return { spalten: {}, buchungen: [], kopf: zeilen[0] || [], zeilen: 0 };
  }

  const kopf = zeilen[0];
  const spalten = erkenneSpalten(kopf);
  const hole = (zeile, feld) => (spalten[feld] === undefined ? '' : zeile[spalten[feld]] || '');

  const buchungen = zeilen.slice(1).map((zeile, i) => ({
    zeile: i + 2,
    date: datumAus(hole(zeile, 'date')),
    amountCents: centsAus(hole(zeile, 'amount')),
    currency: String(hole(zeile, 'currency') || 'EUR').trim().toUpperCase(),
    reference: String(hole(zeile, 'reference') || '').trim(),
    counterparty: String(hole(zeile, 'counterparty') || '').trim()
  }));

  return {
    spalten,
    kopf,
    zeilen: zeilen.length - 1,
    buchungen: buchungen.filter((b) => b.amountCents !== null && b.amountCents > 0)
  };
}

/* ---------------------------------------------------------------------------
   Zuordnen
   --------------------------------------------------------------------------- */

/** Wie weit eine Zahlung nach dem Rechnungsdatum liegen darf. */
const FENSTER_TAGE = 120;

function tageZwischen(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

/**
 * Buchungen auf offene Rechnungen legen.
 *
 * `offene` sind Vorgänge der Form { id, number, totalCents, date, kind } —
 * gleich ob aus dem eigenen System oder aus dem Onlydesk-Archiv.
 */
export function ordneZu(buchungen, offene) {
  const nochOffen = offene.slice();
  const treffer = [];
  const uebrig = [];

  const nimm = (rechnung) => {
    const stelle = nochOffen.findIndex((r) => r.id === rechnung.id && r.number === rechnung.number);
    if (stelle !== -1) nochOffen.splice(stelle, 1);
  };

  /* Erst alle Buchungen mit Nummer im Verwendungszweck: die sind sicher, und
     sie nehmen ihre Rechnung aus dem Rennen, bevor über Beträge geraten wird. */
  for (const buchung of buchungen) {
    const text = `${buchung.reference} ${buchung.counterparty}`.toUpperCase().replace(/\s+/g, '');
    const rechnung = nochOffen.find((r) => r.number && text.includes(r.number.toUpperCase().replace(/\s+/g, '')));

    if (rechnung) {
      treffer.push({ buchung, rechnung, grund: 'number', sicher: true });
      nimm(rechnung);
    }
  }

  const schonZugeordnet = new Set(treffer.map((t) => t.buchung));

  for (const buchung of buchungen) {
    if (schonZugeordnet.has(buchung)) continue;

    const passende = nochOffen.filter((r) =>
      r.totalCents === buchung.amountCents
      && (!r.date || !buchung.date || (tageZwischen(buchung.date, r.date) >= -2
        && tageZwischen(buchung.date, r.date) <= FENSTER_TAGE)));

    if (passende.length === 1) {
      treffer.push({ buchung, rechnung: passende[0], grund: 'amount', sicher: false });
      nimm(passende[0]);
      continue;
    }

    uebrig.push({
      buchung,
      grund: passende.length > 1 ? 'ambiguous' : 'no_match',
      kandidaten: passende.map((r) => r.number)
    });
  }

  return { treffer, uebrig, nochOffen };
}
