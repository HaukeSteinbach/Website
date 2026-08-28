/**
 * The invoice PDF.
 *
 * Same document as the one the instruments shop issues — same number format,
 * same mandatory fields, same § 19 UStG wording — so both sets of books read
 * alike and an accountant sees one system, not two.
 *
 * What differs is the typography: Archivo Black, Poppins and JetBrains Mono,
 * the faces this site uses. What deliberately does *not* carry over is the
 * black ground. An invoice gets printed and filed; a full-bleed black page
 * costs a cartridge and reads badly in a folder. The brand shows in the type
 * and in one accent rule, on white.
 *
 * Everything § 14 UStG requires is here: both addresses, the tax number, the
 * date, a sequential number, what was sold, when it was delivered, the amount,
 * and — since no VAT is charged — the reason why.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets/invoice-fonts');

const A4 = { w: 595.28, h: 841.89 };
const M = 62;                                   /* page margin */

const C = {
  ink:    rgb(0.05, 0.04, 0.05),
  dim:    rgb(0.45, 0.42, 0.44),
  faint:  rgb(0.72, 0.70, 0.71),
  rule:   rgb(0.87, 0.85, 0.86),
  accent: rgb(0xe9 / 255, 0x45 / 255, 0x60 / 255)
};

export const ISSUER = {
  name: 'Hauke Steinbach',
  street: 'Eppendorfer Stieg 1',
  city: '22299 Hamburg',
  country: 'Deutschland',
  taxNumber: '49/237/04138',
  iban: 'DE82 2022 0800 0058 8858 42',
  bic: 'SXPYDEHHXXX',
  bank: 'Banking Circle S.A. — German Branch',
  email: 'mail@haukesteinbach.de',
  web: 'haukesteinbach.de'
};

let fontCache = null;

function loadFonts() {
  if (!fontCache) {
    fontCache = {
      display: fs.readFileSync(path.join(FONT_DIR, 'archivo-black-400.ttf')),
      body: fs.readFileSync(path.join(FONT_DIR, 'poppins-400.ttf')),
      bodySemi: fs.readFileSync(path.join(FONT_DIR, 'poppins-500.ttf')),
      mono: fs.readFileSync(path.join(FONT_DIR, 'jetbrains-mono-400.ttf'))
    };
  }

  return fontCache;
}

function euro(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function germanDate(iso) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin'
  }).format(new Date(iso));
}

/**
 * @param {object} order  as stored by orders.js
 * @returns {Promise<Uint8Array>}
 */
export async function buildInvoicePdf(order) {
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const display = await doc.embedFont(fonts.display, { subset: true });
  const body = await doc.embedFont(fonts.body, { subset: true });
  const semi = await doc.embedFont(fonts.bodySemi, { subset: true });
  const mono = await doc.embedFont(fonts.mono, { subset: true });

  const page = doc.addPage([A4.w, A4.h]);
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: rgb(1, 1, 1) });

  const text = (s, x, y, font, size, color = C.ink, spacing = 0) =>
    page.drawText(String(s ?? ''), { x, y, font, size, color, characterSpacing: spacing });

  const right = (s, y, font, size, color = C.ink) => {
    const s2 = String(s ?? '');
    page.drawText(s2, { x: A4.w - M - font.widthOfTextAtSize(s2, size), y, font, size, color });
  };

  const rule = (y, color = C.rule, thickness = 0.75, from = M, to = A4.w - M) =>
    page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness, color });

  /* ---- header ---------------------------------------------------------- */
  let y = A4.h - M - 14;

  text('STEINBACH', M, y, display, 20, C.ink, 0.5);
  right('RECHNUNG', y + 3, mono, 8.5, C.dim);
  y -= 10;
  /* the one piece of brand colour, where it cannot cost anyone toner */
  rule(y, C.accent, 2.5, M, M + 92);

  y -= 26;
  text(`${ISSUER.name} · ${ISSUER.street} · ${ISSUER.city}`, M, y, body, 7.5, C.faint);

  /* ---- addresses ------------------------------------------------------- */
  y -= 46;
  const addressTop = y;

  text('RECHNUNG AN', M, y, mono, 7, C.dim, 0.8);
  y -= 16;

  const buyer = order.buyer || {};
  const buyerLines = [
    buyer.name,
    buyer.company,
    buyer.line1,
    buyer.line2,
    [buyer.postalCode, buyer.city].filter(Boolean).join(' '),
    buyer.country
  ].filter(Boolean);

  for (const line of buyerLines) {
    text(line, M, y, body, 10);
    y -= 14;
  }

  if (buyer.email) {
    y -= 2;
    text(buyer.email, M, y, body, 8.5, C.dim);
    y -= 14;
  }

  /* facts, in a column of their own on the right */
  let fy = addressTop;
  const labelX = A4.w - M - 190;
  const valueX = A4.w - M - 92;

  const fact = (label, value, valueFont = mono) => {
    text(label, labelX, fy, body, 8.5, C.dim);
    text(value, valueX, fy, valueFont, 8.5, C.ink);
    fy -= 15;
  };

  fact('Rechnungsnummer', order.invoiceNumber);
  fact('Rechnungsdatum', germanDate(order.createdAt));
  fact('Lieferdatum', germanDate(order.createdAt));
  fact('Zahlungsart', order.paymentMethod || 'Karte', body);

  /* ---- items ----------------------------------------------------------- */
  y = Math.min(y, fy) - 30;

  rule(y);
  y -= 15;
  text('POSITION', M, y, mono, 7, C.dim, 0.8);
  right('BETRAG', y, mono, 7, C.dim);
  y -= 8;
  rule(y);
  y -= 22;

  const product = order.product || {};
  const quantity = order.quantity || 1;

  text(`${quantity > 1 ? `${quantity} × ` : ''}${product.name || 'Artikel'}`, M, y, semi, 10.5);
  right(euro(order.itemCents), y, mono, 10.5);
  y -= 13;

  const itemNote = product.invoiceDescription || product.description;
  if (itemNote) {
    text(itemNote, M, y, body, 8.5, C.dim);
    y -= 16;
  }

  if (order.shippingCents > 0) {
    y -= 4;
    text('Versand', M, y, body, 10);
    right(euro(order.shippingCents), y, mono, 10);
    y -= 16;
  }

  y -= 6;
  rule(y);
  y -= 20;

  text('Gesamtbetrag', M, y, semi, 11.5);
  right(euro(order.totalCents), y, mono, 12.5);

  y -= 16;
  right('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', y, body, 7.5, C.dim);

  /* ---- payment note ---------------------------------------------------- */
  y -= 40;
  text('Bereits bezahlt. Diese Rechnung dient als Beleg,', M, y, body, 9, C.dim);
  y -= 13;
  text('eine Überweisung ist nicht erforderlich.', M, y, body, 9, C.dim);

  /* ---- footer ---------------------------------------------------------- */
  const footY = M + 46;
  rule(footY + 16, C.rule, 0.75);

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

  return doc.save();
}
