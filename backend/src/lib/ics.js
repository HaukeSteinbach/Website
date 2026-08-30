/**
 * Calendar files, RFC 5545.
 *
 * Written out rather than pulled in as a dependency: what a single studio
 * booking needs is one VEVENT, and the parts that actually go wrong — folding
 * long lines, escaping commas, getting the time zone right — are the parts a
 * library would hide rather than solve.
 *
 * Times go out in UTC with a trailing Z. A local time plus a VTIMEZONE block
 * would be the richer form, but it is also the form that gets subtly wrong
 * across daylight saving; UTC is unambiguous everywhere and every calendar
 * shows it back in the reader's own zone.
 */

const CRLF = '\r\n';

/**
 * Escape the characters that mean something to the format.
 *
 * Backslash first — doing it later would escape the backslashes this function
 * just added.
 */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold lines at 75 octets, as the spec requires.
 *
 * Counted in bytes, not characters: a description with umlauts in it is longer
 * than it looks, and a fold in the middle of a multi-byte character produces a
 * file some calendars refuse and others show as mojibake.
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');

  if (bytes.length <= 75) {
    return line;
  }

  const parts = [];
  let start = 0;

  while (start < bytes.length) {
    /* First line 75 octets, continuations 74 — the leading space counts. */
    let end = Math.min(start + (parts.length === 0 ? 75 : 74), bytes.length);

    /* Never cut inside a UTF-8 sequence: continuation bytes are 10xxxxxx. */
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }

    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return parts.join(`${CRLF} `);
}

/** 2026-09-04T10:00:00.000Z → 20260904T100000Z */
function stamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * One studio booking as a calendar file.
 *
 * `method` decides what a calendar does with it. REQUEST is an invitation and
 * offers to accept or decline; PUBLISH is a plain entry that is simply added.
 * The proposal goes out as REQUEST, the confirmed booking as PUBLISH — by then
 * the answering has already happened by email.
 *
 * `sequence` has to climb with every version of the same UID, otherwise a
 * calendar that already knows the event ignores the update.
 */
export function buildIcs({
  uid,
  start,
  end,
  summary,
  description,
  location,
  organiser,
  attendee,
  method = 'PUBLISH',
  sequence = 0,
  status = 'CONFIRMED',
  createdAt = new Date()
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Steinbach//Studio bookings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(createdAt)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    'TRANSP:OPAQUE'
  ];

  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  if (organiser?.email) {
    lines.push(`ORGANIZER;CN=${escapeText(organiser.name || organiser.email)}:mailto:${organiser.email}`);
  }

  if (attendee?.email) {
    lines.push(
      `ATTENDEE;CN=${escapeText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;`
      + `PARTSTAT=${attendee.status || 'NEEDS-ACTION'};RSVP=TRUE:mailto:${attendee.email}`
    );
  }

  /* An alarm the day before. On a shared studio calendar this is the
     difference between remembering a session and being told about it. */
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(summary)}`,
    'END:VALARM'
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}
