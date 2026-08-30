/**
 * Angebote und selbst geschriebene Rechnungen als PDF.
 *
 * Der Shop-Beleg nebenan kann genau eine Position, weil dort immer genau ein
 * Ding verkauft wird. Hier stehen mehrere Zeilen mit Menge, Einzelpreis und
 * Beschreibung, und die Beschreibungen sind lang genug, dass sie umbrochen
 * werden müssen und eine zweite Seite brauchen können.
 *
 * Aussehen, Schriften und Absenderblock kommen aus invoice-pdf.js, damit ein
 * Angebot und die Rechnung dazu nicht wie aus zwei Häusern aussehen.
 *
 * Was § 14 UStG verlangt, steht auf der Rechnung: beide Anschriften, die
 * Steuernummer, das Datum, eine fortlaufende Nummer, Art und Umfang der
 * Leistung, der Betrag und der Grund, warum keine Umsatzsteuer anfällt. Ein
 * Angebot muss nichts davon, bekommt aber dieselben Angaben — es soll ja
 * später zur Rechnung passen.
 */

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { A4, C, ISSUER, M, euro, germanDate, loadFonts } from './invoice-pdf.js';

/** Wie tief eine Seite beschrieben wird, bevor die nächste anfängt. */
const BOTTOM = M + 90;

/**
 * Text auf eine Breite umbrechen.
 *
 * pdf-lib bricht nicht selbst um; ohne das hier liefen die Beschreibungen aus
 * dem Katalog rechts aus dem Papier heraus.
 */
function wrap(text, font, size, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(probe, size) <= width) {
      current = probe;
      continue;
    }

    if (current) lines.push(current);

    /* Ein einzelnes Wort, das breiter ist als die Spalte — eine lange URL
       etwa — wird hart getrennt, sonst stünde es über den Rand hinaus. */
    if (font.widthOfTextAtSize(word, size) > width) {
      let rest = word;

      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }

      current = rest;
      continue;
    }

    current = word;
  }

  if (current) lines.push(current);

  return lines;
}

export async function buildDocumentPdf(document) {
  const istRechnung = document.kind === 'invoice';
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const display = await doc.embedFont(fonts.display, { subset: true });
  const body = await doc.embedFont(fonts.body, { subset: true });
  const semi = await doc.embedFont(fonts.bodySemi, { subset: true });
  const mono = await doc.embedFont(fonts.mono, { subset: true });

  let page;
  let y;

  const text = (s, x, yy, font, size, color = C.ink, spacing = 0) =>
    page.drawText(String(s ?? ''), { x, y: yy, font, size, color, characterSpacing: spacing });

  const right = (s, yy, font, size, color = C.ink) => {
    const value = String(s ?? '');
    page.drawText(value, { x: A4.w - M - font.widthOfTextAtSize(value, size), y: yy, font, size, color });
  };

  const rule = (yy, color = C.rule, thickness = 0.75, from = M, to = A4.w - M) =>
    page.drawLine({ start: { x: from, y: yy }, end: { x: to, y: yy }, thickness, color });

  function fusszeile() {
    const footY = M + 46;
    rule(footY + 16);

    const col = (lines, x) => {
      let ly = footY;
      for (const line of lines) {
        text(line, x, ly, body, 7.5, C.faint);
        ly -= 10;
      }
    };

    col([ISSUER.name, ISSUER.street, `${ISSUER.city}, ${ISSUER.country}`], M);
    col([`Steuernummer ${ISSUER.taxNumber}`, 'Kleinunternehmer gemäß § 19 UStG', ISSUER.web], M + 175);
    col([`IBAN ${ISSUER.iban}`, `BIC ${ISSUER.bic}`, ISSUER.bank], M + 340);
  }

  function neueSeite() {
    if (page) fusszeile();

    page = doc.addPage([A4.w, A4.h]);
    page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: rgb(1, 1, 1) });
    y = A4.h - M - 14;
  }

  /** Reicht der Platz noch, oder muss umgebrochen werden? */
  const platz = (hoehe) => {
    if (y - hoehe < BOTTOM) {
      neueSeite();
      /* Auf der Folgeseite steht die Tabelle ohne Briefkopf weiter, sonst
         verschenkte jede zweite Seite ihr oberes Drittel. */
      text(`${istRechnung ? 'Rechnung' : 'Angebot'} ${document.number || ''}`, M, y, mono, 7.5, C.faint);
      y -= 24;
    }
  };

  neueSeite();

  /* ---- Kopf -------------------------------------------------------------- */

  text('STEINBACH', M, y, display, 20, C.ink, 0.5);
  right(istRechnung ? 'RECHNUNG' : 'ANGEBOT', y + 3, mono, 8.5, C.dim);
  y -= 10;
  rule(y, C.accent, 2.5, M, M + 92);

  y -= 26;
  text(`${ISSUER.name} · ${ISSUER.street} · ${ISSUER.city}`, M, y, body, 7.5, C.faint);

  /* ---- Anschriften ------------------------------------------------------- */

  y -= 46;
  const oben = y;

  text(istRechnung ? 'RECHNUNG AN' : 'ANGEBOT FÜR', M, y, mono, 7, C.dim, 0.8);
  y -= 16;

  const an = document.recipient || {};
  const anschrift = [
    an.name,
    an.line1,
    an.line2,
    [an.postalCode, an.city].filter(Boolean).join(' '),
    an.country
  ].filter(Boolean);

  for (const zeile of anschrift) {
    text(zeile, M, y, body, 10);
    y -= 14;
  }

  if (an.email) {
    y -= 2;
    text(an.email, M, y, body, 8.5, C.dim);
    y -= 14;
  }

  let fy = oben;
  const labelX = A4.w - M - 190;
  const valueX = A4.w - M - 92;

  const fact = (label, value, font = mono) => {
    if (!value) return;
    text(label, labelX, fy, body, 8.5, C.dim);
    text(value, valueX, fy, font, 8.5, C.ink);
    fy -= 15;
  };

  fact(istRechnung ? 'Rechnungsnummer' : 'Angebotsnummer', document.number);
  fact(istRechnung ? 'Rechnungsdatum' : 'Datum', germanDate(document.issuedAt || document.createdAt));
  if (an.vatId) fact('USt-IdNr.', an.vatId);
  if (!istRechnung && document.validUntil) fact('Gültig bis', germanDate(document.validUntil));

  y = Math.min(y, fy) - 30;

  /* ---- Betreff und Anschreiben ------------------------------------------- */

  if (document.title) {
    text(document.title, M, y, semi, 12);
    y -= 22;
  }

  if (document.intro) {
    for (const zeile of wrap(document.intro, body, 9.5, A4.w - 2 * M)) {
      platz(14);
      text(zeile, M, y, body, 9.5, C.dim);
      y -= 13;
    }
    y -= 12;
  }

  /* ---- Positionen -------------------------------------------------------- */

  const spalteMenge = A4.w - M - 210;
  const spaltePreis = A4.w - M - 130;
  const textBreite = spalteMenge - M - 16;

  rule(y);
  y -= 15;
  text('POSITION', M, y, mono, 7, C.dim, 0.8);
  text('MENGE', spalteMenge, y, mono, 7, C.dim, 0.8);
  text('EINZELN', spaltePreis, y, mono, 7, C.dim, 0.8);
  right('BETRAG', y, mono, 7, C.dim);
  y -= 8;
  rule(y);
  y -= 20;

  for (const position of document.items || []) {
    const beschreibung = wrap(position.description, body, 8.5, textBreite);

    platz(16 + beschreibung.length * 11 + 10);

    text(position.name || 'Position', M, y, semi, 10);
    text(String(position.quantity), spalteMenge, y, mono, 9.5);
    text(euro(position.unitCents), spaltePreis, y, mono, 9.5, C.dim);
    right(euro(position.totalCents), y, mono, 10);
    y -= 13;

    for (const zeile of beschreibung) {
      text(zeile, M, y, body, 8.5, C.dim);
      y -= 11;
    }

    y -= 10;
  }

  /* ---- Summe ------------------------------------------------------------- */

  platz(70);
  y -= 4;
  rule(y);
  y -= 20;

  text(istRechnung ? 'Gesamtbetrag' : 'Angebotssumme', M, y, semi, 11.5);
  right(euro(document.totalCents), y, mono, 12.5);

  y -= 16;
  right('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', y, body, 7.5, C.dim);

  /* ---- Schluss ----------------------------------------------------------- */

  y -= 40;
  platz(60);

  if (istRechnung) {
    /* Ohne die Nummer im Verwendungszweck lässt sich die Zahlung später nicht
       automatisch zuordnen — dann sitzt man mit dem Kontoauszug daneben. */
    text('Zahlbar innerhalb von 14 Tagen ohne Abzug auf das unten genannte Konto.', M, y, body, 9, C.dim);
    y -= 13;
    text(`Bitte ${document.number} als Verwendungszweck angeben.`, M, y, body, 9, C.dim);
  } else {
    text('Dieses Angebot ist unverbindlich. Antworten Sie einfach auf diese Mail,', M, y, body, 9, C.dim);
    y -= 13;
    text('wenn Sie es annehmen möchten oder etwas geändert werden soll.', M, y, body, 9, C.dim);
  }

  fusszeile();

  return doc.save();
}
