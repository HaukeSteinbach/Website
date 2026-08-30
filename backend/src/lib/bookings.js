/**
 * Studio bookings.
 *
 * A booking is a conversation with three steps, and the order matters:
 *
 *   proposed   a time has been offered to the client, nothing is settled
 *   confirmed  the client said yes — only now does it belong in a calendar
 *   declined   the client said no, or it was withdrawn
 *
 * The rule that shapes this file: nothing reaches the studio calendar before
 * the client has confirmed. The room is shared with other people, and an entry
 * that turns out to be wishful thinking blocks a slot someone else could have
 * used.
 *
 * The client answers through a link, not by replying — a reply has to be read
 * and acted on, a click cannot be forgotten about.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'bookings/index.json';
const WRITE_ATTEMPTS = 5;

export const STATES = ['proposed', 'confirmed', 'declined', 'cancelled'];

/** The studio. One place, so it lives here rather than in a settings screen. */
export const STUDIO = {
  name: 'The Pantry Studios',
  street: 'Eiffestraße 422',
  postalCode: '20537',
  city: 'Hamburg',
  country: 'Germany'
};

export function studioAddress() {
  return `${STUDIO.name}, ${STUDIO.street}, ${STUDIO.postalCode} ${STUDIO.city}, ${STUDIO.country}`;
}

/* ---------------------------------------------------------------------------
   Storage
   --------------------------------------------------------------------------- */

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { bookings: [] }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);

    return {
      index: { bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [] },
      etag: stored.etag
    };
  } catch (error) {
    throw new StorageError('Die Terminliste konnte nicht gelesen werden.', error);
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
      lastError = error;
    }
  }

  throw lastError || new StorageError('Die Terminliste konnte nicht geschrieben werden.');
}

/* ---------------------------------------------------------------------------
   Reading
   --------------------------------------------------------------------------- */

export async function listBookings() {
  const { index } = await readIndex();

  return index.bookings.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

export async function getBooking(id) {
  const { index } = await readIndex();

  return index.bookings.find((b) => b.id === id) || null;
}

/**
 * Find a booking by the token in the client's link.
 *
 * The token is the only thing standing between a stranger and someone else's
 * session details, so it is 128 bits of randomness — guessing is not a threat
 * anyone needs to worry about, and the client gets a link that just works with
 * no password to keep.
 */
export async function findByToken(token) {
  if (!token) {
    return null;
  }

  const { index } = await readIndex();

  return index.bookings.find((b) => b.token === token) || null;
}

/**
 * Bookings that already hold a slot.
 *
 * Proposals count. Offering the same hour to two people and sorting it out
 * afterwards is worse than seeing the clash before the mail goes out.
 */
export async function overlapping(start, end, ignoreId) {
  const bookings = await listBookings();
  const from = Date.parse(start);
  const to = Date.parse(end);

  return bookings.filter((b) => {
    if (b.id === ignoreId || !['proposed', 'confirmed'].includes(b.state)) {
      return false;
    }

    return Date.parse(b.start) < to && Date.parse(b.end) > from;
  });
}

/* ---------------------------------------------------------------------------
   Writing
   --------------------------------------------------------------------------- */

export async function createBooking(input) {
  const now = new Date().toISOString();

  const booking = {
    id: randomUUID(),
    /* Stable for the lifetime of the booking: a calendar recognises an update
       to an event it already holds by this, not by the summary. */
    uid: `${randomUUID()}@haukesteinbach.de`,
    token: randomBytes(16).toString('hex'),
    state: 'proposed',
    start: input.start,
    end: input.end,
    title: String(input.title || 'Studio session').trim(),
    note: String(input.note || '').trim(),
    customerId: input.customerId || null,
    projectId: input.projectId || null,
    client: {
      name: String(input.client?.name || '').trim(),
      email: String(input.client?.email || '').trim().toLowerCase()
    },
    /* Climbs with every version sent out, so calendars accept the update. */
    sequence: 0,
    proposedAt: null,
    answeredAt: null,
    addedToCalendarAt: null,
    events: [{ at: now, what: 'created' }],
    createdAt: now,
    updatedAt: now
  };

  return withIndex((index) => {
    index.bookings.push(booking);
    return { booking };
  });
}

export async function updateBooking(id, change) {
  return withIndex((index) => {
    const booking = index.bookings.find((b) => b.id === id);

    if (!booking) {
      return { booking: null, reason: 'not_found', skipWrite: true };
    }

    change(booking);
    booking.updatedAt = new Date().toISOString();

    return { booking };
  });
}

export async function noteBookingEvent(id, what, extra) {
  return updateBooking(id, (booking) => {
    const at = new Date().toISOString();

    booking.events.push({ at, what, ...(extra || {}) });

    if (what === 'proposed') {
      booking.proposedAt = at;
      booking.state = 'proposed';
      booking.sequence += 1;
    }

    if (['confirmed', 'declined', 'cancelled'].includes(what)) {
      booking.state = what;
      booking.answeredAt = at;
    }

    if (what === 'added_to_calendar') {
      booking.addedToCalendarAt = at;
    }
  });
}

/**
 * The client's answer.
 *
 * Only a proposal can be answered, and only once. Without that guard a
 * forwarded link would let a second person overturn the first one's decision,
 * and a double click would count as two answers.
 */
export async function answerBooking(token, answer) {
  return withIndex((index) => {
    const booking = index.bookings.find((b) => b.token === token);

    if (!booking) {
      return { booking: null, reason: 'not_found', skipWrite: true };
    }

    if (booking.state !== 'proposed') {
      return { booking, reason: 'already_answered', skipWrite: true };
    }

    const at = new Date().toISOString();

    booking.state = answer === 'confirm' ? 'confirmed' : 'declined';
    booking.answeredAt = at;
    booking.updatedAt = at;
    booking.events.push({ at, what: booking.state, by: 'client' });

    return { booking, answered: true };
  });
}

export async function deleteBooking(id) {
  return withIndex((index) => {
    const position = index.bookings.findIndex((b) => b.id === id);

    if (position === -1) {
      return { deleted: false, skipWrite: true };
    }

    index.bookings.splice(position, 1);

    return { deleted: true };
  });
}
