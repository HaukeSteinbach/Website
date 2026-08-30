/**
 * The page a client lands on from a studio proposal.
 *
 * One decision, two buttons, and everything needed to make it: when, where,
 * how long. No sign-in, no account — the token in the link is the whole
 * credential, because asking someone to register in order to say "yes, Tuesday
 * works" is how a booking turns into a phone call instead.
 *
 * Same shell as the delivery page, so a client who has had files from here
 * recognises the place.
 */

const FONT_PRELOADS = ['archivo-black-400-latin', 'poppins-400-latin', 'jetbrains-mono-400-latin'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(title)} | Steinbach</title>
    <link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg">
    <link rel="stylesheet" href="/assets/css/steinbach.css">
    ${FONT_PRELOADS.map((font) => `<link rel="preload" href="/assets/fonts/${font}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n    ')}
</head>
<body class="handoff-page">
    <header class="bar">
        <a class="brand" href="/">Steinbach</a>
    </header>
    ${body}
    <footer class="foot">
        <p class="mono">Steinbach · Hamburg</p>
    </footer>
</body>
</html>`;
}

function when(booking) {
  const format = (options) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', ...options
  });

  const start = new Date(booking.start);
  const end = new Date(booking.end);

  return {
    day: format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start),
    from: format({ hour: '2-digit', minute: '2-digit', hour12: false }).format(start),
    to: format({ hour: '2-digit', minute: '2-digit', hour12: false }).format(end),
    hours: Math.round(((end - start) / 3600000) * 10) / 10
  };
}

function factRow(booking, address) {
  const w = when(booking);

  return `
    <dl class="factrow detail">
      <div class="fact"><dt>Date</dt><dd>${escapeHtml(w.day)}</dd></div>
      <div class="fact"><dt>Time</dt><dd>${escapeHtml(w.from)}–${escapeHtml(w.to)} <span class="fact-sub">${w.hours} hours</span></dd></div>
      <div class="fact"><dt>Where</dt><dd>${escapeHtml(address)}</dd></div>
    </dl>`;
}

/** The proposal, still open. */
export function renderBookingPage({ booking, address, token }) {
  const w = when(booking);

  const body = `
  <header class="page-head booking-head">
    <p class="kicker">Studio time</p>
    <h1>${escapeHtml(w.day)}<br class="br-lg">${escapeHtml(w.from)}–${escapeHtml(w.to)}</h1>
    <p class="page-deck">${escapeHtml(booking.title)} at ${escapeHtml(address)}</p>
    <div class="page-head-rule" aria-hidden="true"></div>
  </header>
  <main class="handoff-layout">
    <section class="handoff-card">
      ${factRow(booking, address)}
      ${booking.note ? `<p class="copy">${escapeHtml(booking.note)}</p>` : ''}

      <div class="btn-row">
        <form method="POST" action="/b/${escapeHtml(token)}/confirm">
          <button type="submit" class="btn fill">Confirm this slot</button>
        </form>
        <form method="POST" action="/b/${escapeHtml(token)}/decline">
          <button type="submit" class="btn btn-secondary">This does not suit me</button>
        </form>
      </div>

      <p class="note">Nothing is booked until you confirm. If the time does not work, say so and
      you will get another suggestion — no need to write a mail.</p>
    </section>
  </main>`;

  return shell({ title: 'Studio time', body });
}

/** After the client has answered — and when they come back to the link later. */
export function renderBookingAnswered({ booking, address, alreadyAnswered }) {
  const w = when(booking);
  const confirmed = booking.state === 'confirmed';

  const body = `
  <header class="page-head booking-head">
    <p class="kicker">${confirmed ? 'Confirmed' : 'Not booked'}</p>
    <h1>${confirmed ? 'See you then' : 'No problem'}</h1>
    <p class="page-deck">${confirmed
      ? `${escapeHtml(w.day)}, ${escapeHtml(w.from)}–${escapeHtml(w.to)}`
      : 'That slot has been let go. You will hear from me with another time.'}</p>
    <div class="page-head-rule" aria-hidden="true"></div>
  </header>
  <main class="handoff-layout">
    <section class="handoff-card">
      ${confirmed ? factRow(booking, address) : ''}
      ${confirmed
        ? `<p class="copy">A confirmation is on its way to your inbox with a calendar file attached —
           open it and the session goes into your own calendar.</p>
           <div class="btn-row">
             <a class="btn" href="/b/${escapeHtml(booking.token)}/calendar.ics" download>Download calendar file</a>
           </div>`
        : '<p class="copy">Reply to the proposal email with a couple of times that suit you better.</p>'}
      ${alreadyAnswered
        ? '<p class="note">This was already answered — nothing changed just now.</p>'
        : ''}
    </section>
  </main>`;

  return shell({ title: confirmed ? 'Confirmed' : 'Not booked', body });
}

export function renderBookingNotice({ title, message }) {
  const body = `
  <header class="page-head">
    <h1>${escapeHtml(title)}</h1>
    <p class="page-deck">${escapeHtml(message)}</p>
    <div class="page-head-rule" aria-hidden="true"></div>
  </header>
  <main class="handoff-layout">
    <section class="handoff-card">
      <p>Write to <a href="mailto:mail@haukesteinbach.de">mail@haukesteinbach.de</a> and we will sort it out.</p>
    </section>
  </main>`;

  return shell({ title, body });
}
