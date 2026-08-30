/**
 * Angebote und selbst geschriebene Rechnungen.
 *
 * Der Unterschied zwischen den beiden ist nicht kosmetisch, und die ganze
 * Datei hängt daran:
 *
 * Ein Angebot ist ein Vorschlag. Es darf geändert, neu geschrieben und
 * weggeworfen werden, solange es niemand angenommen hat.
 *
 * Eine Rechnung ist ein Steuerbeleg. Sobald sie ausgestellt ist, trägt sie
 * eine Nummer aus einer lückenlosen Folge und darf nicht mehr geändert
 * werden — § 14 UStG und die GoBD verlangen das, und praktisch heißt es: was
 * einmal beim Kunden liegt, muss auch hier noch genauso aussehen. Ein Fehler
 * darauf wird nicht korrigiert, sondern storniert und neu geschrieben.
 *
 * Deshalb gibt es hier zwei Zustände. Ein Beleg entsteht als `draft` und
 * lässt sich beliebig bearbeiten. Erst `issue` vergibt die Nummer, friert den
 * Inhalt ein und macht ihn zum Dokument. Danach geht nur noch stornieren.
 */

import { randomUUID } from 'node:crypto';

import { drawInvoiceNumber } from './orders.js';
import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'documents/index.json';
const WRITE_ATTEMPTS = 5;

export const KINDS = ['offer', 'invoice'];
export const STATES = ['draft', 'issued', 'paid', 'cancelled', 'accepted', 'declined'];

/* ---------------------------------------------------------------------------
   Speicher
   --------------------------------------------------------------------------- */

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { documents: [], offerCounters: {} }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);

    return {
      index: {
        documents: Array.isArray(parsed.documents) ? parsed.documents : [],
        offerCounters: parsed.offerCounters || {}
      },
      etag: stored.etag
    };
  } catch (error) {
    throw new StorageError('Die Belegliste konnte nicht gelesen werden.', error);
  }
}

async function writeIndex(index, etag) {
  await putObject(INDEX_KEY, JSON.stringify(index, null, 2), {
    contentType: 'application/json',
    ifMatch: etag || undefined,
    ifNoneMatch: etag ? undefined : '*'
  });
}

async function withIndex(change) {
  let lastError;

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();
    const result = await change(index);

    if (result?.skipWrite) {
      return result;
    }

    try {
      await writeIndex(index, etag);
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new StorageError('Die Belegliste konnte nicht geschrieben werden.');
}

/* ---------------------------------------------------------------------------
   Nummern
   --------------------------------------------------------------------------- */

function berlinDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
}

/**
 * Angebotsnummern, AN-JJJJ-MM-TT-NNNN.
 *
 * Eigener Zähler mit eigenem Kürzel: ein Angebot ist kein Steuerbeleg und
 * gehört nicht in die Rechnungsfolge. Stünden beide in einer, hätte die Folge
 * Lücken, sobald ein Angebot nicht zur Rechnung wird — und eine lückenhafte
 * Rechnungsfolge ist genau das, was bei einer Prüfung auffällt.
 */
function nextOfferNumber(index, now) {
  const day = berlinDate(now);
  const next = (index.offerCounters[day] || 0) + 1;

  index.offerCounters[day] = next;

  return `AN-${day}-${String(next).padStart(4, '0')}`;
}

/* ---------------------------------------------------------------------------
   Rechnen
   --------------------------------------------------------------------------- */

/**
 * Positionen zusammenrechnen.
 *
 * Menge mal Einzelpreis, gerundet auf ganze Cent je Zeile — nicht erst am
 * Ende. Eine Rechnung, deren Zeilen sich nicht zur Summe addieren, kann man
 * niemandem schicken, auch wenn die Summe für sich genommen stimmt.
 */
export function totals(items) {
  const lines = (items || []).map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitCents = Math.round(Number(item.unitCents) || 0);

    return { ...item, quantity, unitCents, totalCents: Math.round(quantity * unitCents) };
  });

  return {
    lines,
    netCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    vatCents: 0,
    get totalCents() { return this.netCents; }
  };
}

/* ---------------------------------------------------------------------------
   Lesen
   --------------------------------------------------------------------------- */

export async function listDocuments() {
  const { index } = await readIndex();

  return index.documents
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getDocument(id) {
  const { index } = await readIndex();

  return index.documents.find((d) => d.id === id) || null;
}

/* ---------------------------------------------------------------------------
   Schreiben
   --------------------------------------------------------------------------- */

export async function createDraft(input) {
  const now = new Date().toISOString();
  const gerechnet = totals(input.items);

  const document = {
    id: randomUUID(),
    kind: KINDS.includes(input.kind) ? input.kind : 'offer',
    state: 'draft',
    number: null,
    customerId: input.customerId || null,
    /* Belege haengen am Projekt, aus dem sie stammen: die Rechnung zu einem
       Mastering entsteht dort, wo die Dateien liegen, und ist spaeter von
       beiden Seiten aus zu finden. */
    projectId: input.projectId || null,
    /* Der Empfänger wird beim Ausstellen eingefroren. Bis dahin zeigt der
       Beleg den heutigen Stand des Kunden — zieht jemand um, bevor die
       Rechnung raus ist, soll die neue Adresse darauf stehen. */
    recipient: input.recipient || null,
    title: String(input.title || '').trim(),
    intro: String(input.intro || '').trim(),
    items: gerechnet.lines,
    netCents: gerechnet.netCents,
    totalCents: gerechnet.netCents,
    currency: 'eur',
    /* Nur für Angebote: bis wann es gilt. Ohne Frist bindet ein Angebot
       unbefristet, und das will niemand. */
    validUntil: input.validUntil || null,
    issuedAt: null,
    sentAt: null,
    pdfKey: null,
    events: [{ at: now, what: 'created' }],
    createdAt: now,
    updatedAt: now
  };

  return withIndex((index) => {
    index.documents.push(document);
    return { document };
  });
}

export async function updateDraft(id, change) {
  return withIndex((index) => {
    const document = index.documents.find((d) => d.id === id);

    if (!document) {
      return { document: null, reason: 'not_found', skipWrite: true };
    }

    /* Ein ausgestellter Beleg ist fertig. Wer ihn ändern will, storniert ihn
       und schreibt einen neuen. */
    if (document.state !== 'draft') {
      return { document: null, reason: 'not_a_draft', skipWrite: true };
    }

    change(document);

    const gerechnet = totals(document.items);
    document.items = gerechnet.lines;
    document.netCents = gerechnet.netCents;
    document.totalCents = gerechnet.netCents;
    document.updatedAt = new Date().toISOString();

    return { document };
  });
}

/**
 * Aus dem Entwurf einen Beleg machen.
 *
 * Hier wird die Nummer vergeben, und ab hier ist der Inhalt fest. Die
 * Rechnungsnummer kommt aus derselben Folge wie die des Shops, damit unter
 * einer Steuernummer keine Nummer zweimal vorkommt.
 */
export async function issueDocument(id, recipient) {
  const { index } = await readIndex();
  const vorab = index.documents.find((d) => d.id === id);

  if (!vorab) {
    return { document: null, reason: 'not_found' };
  }

  if (vorab.state !== 'draft') {
    return { document: null, reason: 'not_a_draft' };
  }

  if (!vorab.items.length) {
    return { document: null, reason: 'no_items' };
  }

  /* Die Rechnungsnummer wird außerhalb gezogen, weil sie in einem anderen
     Objekt gezählt wird. Bricht das Schreiben danach ab, ist eine Nummer
     verbraucht — unschön, aber harmlos: eine Lücke lässt sich erklären, eine
     doppelt vergebene Nummer nicht. */
  const number = vorab.kind === 'invoice' ? await drawInvoiceNumber() : null;

  return withIndex((working) => {
    const document = working.documents.find((d) => d.id === id);

    if (!document || document.state !== 'draft') {
      return { document: null, reason: 'not_a_draft', skipWrite: true };
    }

    const now = new Date();

    document.number = number || nextOfferNumber(working, now);
    document.state = 'issued';
    document.issuedAt = now.toISOString();
    document.recipient = recipient || document.recipient;
    document.updatedAt = document.issuedAt;
    document.events.push({ at: document.issuedAt, what: 'issued', number: document.number });

    return { document };
  });
}

export async function noteEvent(id, what, extra) {
  return withIndex((index) => {
    const document = index.documents.find((d) => d.id === id);

    if (!document) {
      return { document: null, skipWrite: true };
    }

    const at = new Date().toISOString();

    document.events.push({ at, what, ...(extra || {}) });
    document.updatedAt = at;

    if (what === 'sent') document.sentAt = at;
    if (['cancelled', 'accepted', 'declined'].includes(what)) document.state = what;

    return { document };
  });
}

/**
 * Eine Rechnung als bezahlt vermerken.
 *
 * Was vom Kontoauszug übrigbleibt: Datum, Betrag, Verwendungszweck. Der
 * Auszug selbst wird nicht gespeichert — gebraucht wird der Nachweis, dass
 * diese Rechnung beglichen ist, nicht die Kontobewegung daneben.
 */
export async function markPaid(id, payment) {
  return withIndex((index) => {
    const document = index.documents.find((d) => d.id === id);

    if (!document) {
      return { document: null, reason: 'not_found', skipWrite: true };
    }

    if (document.state !== 'issued') {
      return { document: null, reason: 'not_issued', skipWrite: true };
    }

    const at = new Date().toISOString();

    document.state = 'paid';
    document.paidAt = payment?.date || at;
    document.payment = {
      date: payment?.date || null,
      amountCents: payment?.amountCents ?? null,
      reference: payment?.reference || '',
      source: payment?.source || 'bank'
    };
    document.updatedAt = at;
    document.events.push({ at, what: 'paid', amountCents: document.payment.amountCents });

    return { document };
  });
}

export async function setPdfKey(id, key) {
  return withIndex((index) => {
    const document = index.documents.find((d) => d.id === id);

    if (!document) {
      return { document: null, skipWrite: true };
    }

    document.pdfKey = key;
    document.updatedAt = new Date().toISOString();

    return { document };
  });
}

/**
 * Einen Entwurf wegwerfen.
 *
 * Nur Entwürfe. Ein ausgestellter Beleg wird storniert, nicht gelöscht — er
 * muss zehn Jahre auffindbar bleiben, auch wenn er falsch war.
 */
export async function deleteDraft(id) {
  return withIndex((index) => {
    const position = index.documents.findIndex((d) => d.id === id);

    if (position === -1) {
      return { deleted: false, reason: 'not_found', skipWrite: true };
    }

    if (index.documents[position].state !== 'draft') {
      return { deleted: false, reason: 'not_a_draft', skipWrite: true };
    }

    index.documents.splice(position, 1);

    return { deleted: true };
  });
}

export function documentKey(document) {
  return `documents/${document.id}/${document.kind === 'invoice' ? 'Rechnung' : 'Angebot'}-${document.number}.pdf`;
}
