/**
 * The customer base.
 *
 * One record per person or company, holding what a letter and an invoice need:
 * a name, an address, a way to reach them. Everything else about a customer —
 * their projects, their shop orders, their invoices — is not stored here but
 * looked up when asked for, keyed on the email address. Copying it in would
 * mean two places to keep in step, and they would drift.
 *
 * Two kinds of invoice meet in here and must not be confused:
 *
 *   - the ones this site issued, numbered HS-YYYY-MM-DD-NNNN, which live in
 *     orders.js and are generated on demand;
 *   - the ones Onlydesk issued before the move, numbered YYYY-MM-DD-NNNN,
 *     which are finished documents. They are kept verbatim, never renumbered
 *     and never regenerated. An issued invoice is a tax record: it may be
 *     archived, not rewritten.
 */

import { randomUUID } from 'node:crypto';

import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'customers/index.json';
const WRITE_ATTEMPTS = 5;

/** How an old invoice was left in the previous system. */
export const LEGACY_STATUS = ['issued', 'paid', 'cancelled'];

/* ---------------------------------------------------------------------------
   Storage, same shape as orders.js: one object, read-modify-write under an
   ETag so two writes cannot silently overwrite each other.
   --------------------------------------------------------------------------- */

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { customers: [] }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);

    return {
      index: { customers: Array.isArray(parsed.customers) ? parsed.customers : [] },
      etag: stored.etag
    };
  } catch (error) {
    /* An unreadable file must never become an empty customer base. */
    throw new StorageError('The customer index could not be parsed.', error);
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
    const result = change(index);

    if (result?.skipWrite) {
      return result;
    }

    try {
      await writeIndex(index, etag);
      return result;
    } catch (error) {
      /* Someone else wrote in between; read again and redo the change. */
      lastError = error;
    }
  }

  throw lastError || new StorageError('The customer index could not be written.');
}

/* ---------------------------------------------------------------------------
   Identity
   --------------------------------------------------------------------------- */

/**
 * The email address, normalised.
 *
 * It is the only thing tying a customer to their projects and orders, so it
 * decides identity. Case is dropped because nobody means a different person by
 * writing their address in capitals.
 */
export function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Find an existing customer for an address, or nothing.
 *
 * Customers without an email address exist — they were entered by hand for a
 * paper invoice — and those can only ever be matched by name.
 */
function findExisting(index, { email, name }) {
  const wanted = normaliseEmail(email);

  if (wanted) {
    const byEmail = index.customers.find((c) => normaliseEmail(c.email) === wanted);

    if (byEmail) {
      return byEmail;
    }
  }

  const wantedName = String(name || '').trim().toLowerCase();

  return wantedName
    ? index.customers.find((c) => !normaliseEmail(c.email) && c.name.trim().toLowerCase() === wantedName)
    : undefined;
}

/* ---------------------------------------------------------------------------
   Reading
   --------------------------------------------------------------------------- */

export async function listCustomers() {
  const { index } = await readIndex();

  return index.customers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function getCustomer(id) {
  const { index } = await readIndex();

  return index.customers.find((c) => c.id === id) || null;
}

/* ---------------------------------------------------------------------------
   Writing
   --------------------------------------------------------------------------- */

function blank(input, now) {
  return {
    id: randomUUID(),
    name: String(input.name || '').trim(),
    email: normaliseEmail(input.email),
    phone: String(input.phone || '').trim(),
    address: {
      line1: String(input.address?.line1 || '').trim(),
      line2: String(input.address?.line2 || '').trim(),
      postalCode: String(input.address?.postalCode || '').trim(),
      city: String(input.address?.city || '').trim(),
      country: String(input.address?.country || '').trim()
    },
    vatId: String(input.vatId || '').trim(),
    note: String(input.note || '').trim(),
    /* Where this record came from, so an import can be told apart from
       something typed in later. */
    source: input.source || 'manual',
    legacyInvoices: [],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Add a customer, or return the one that is already there.
 *
 * Idempotent on the email address, which is what makes re-running an import
 * safe: a second run finds everyone and creates nobody.
 */
export async function upsertCustomer(input) {
  const now = new Date().toISOString();

  return withIndex((index) => {
    const existing = findExisting(index, input);

    if (existing) {
      return { customer: existing, created: false, skipWrite: true };
    }

    const customer = blank(input, now);
    index.customers.push(customer);

    return { customer, created: true };
  });
}

export async function updateCustomer(id, change) {
  return withIndex((index) => {
    const customer = index.customers.find((c) => c.id === id);

    if (!customer) {
      return { customer: null, skipWrite: true };
    }

    change(customer);
    customer.updatedAt = new Date().toISOString();

    return { customer };
  });
}

/**
 * File an invoice from the previous system under a customer.
 *
 * Keyed on the original number, so importing twice does not duplicate it. The
 * number is stored exactly as it was printed — no prefix, no renumbering.
 */
export async function addLegacyInvoice(customerId, invoice) {
  return withIndex((index) => {
    const customer = index.customers.find((c) => c.id === customerId);

    if (!customer) {
      return { added: false, reason: 'no_such_customer', skipWrite: true };
    }

    if (customer.legacyInvoices.some((i) => i.number === invoice.number)) {
      return { added: false, reason: 'already_there', skipWrite: true };
    }

    customer.legacyInvoices.push({
      number: invoice.number,
      date: invoice.date,
      totalCents: invoice.totalCents,
      status: LEGACY_STATUS.includes(invoice.status) ? invoice.status : 'issued',
      source: 'onlydesk'
    });

    customer.legacyInvoices.sort((a, b) => String(a.number).localeCompare(String(b.number)));
    customer.updatedAt = new Date().toISOString();

    return { added: true };
  });
}

/**
 * Remove a customer.
 *
 * The one operation the rest of this codebase does not have, and the reason it
 * is here: without it an erasure request under Art. 17 GDPR cannot be answered.
 *
 * A customer carrying invoices is refused. Those have to be kept for ten years
 * under § 147 AO, and that duty outweighs the request — the lawful answer is
 * to restrict the record, not to delete it, which is what `restricted` marks.
 */
export async function deleteCustomer(id) {
  return withIndex((index) => {
    const position = index.customers.findIndex((c) => c.id === id);

    if (position === -1) {
      return { deleted: false, reason: 'no_such_customer', skipWrite: true };
    }

    if (index.customers[position].legacyInvoices.length > 0) {
      return { deleted: false, reason: 'has_invoices', skipWrite: true };
    }

    index.customers.splice(position, 1);

    return { deleted: true };
  });
}

export { INDEX_KEY as CUSTOMER_INDEX_KEY };
