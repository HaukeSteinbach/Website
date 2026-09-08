/**
 * Outgoing mail.
 *
 * Two kinds, and the difference matters:
 *
 *   To the studio — an upload arrived, a delivery was collected, a change was
 *   requested. SMTP if configured, otherwise Formspree, which posts to a form
 *   that forwards to the studio's own inbox.
 *
 *   To a customer — their delivery link, and the confirmation that a revision
 *   request landed. These need SMTP. Formspree can only ever reach the address
 *   the form belongs to, so it cannot stand in here. When SMTP is missing the
 *   send reports back honestly and the admin area shows the link to pass on by
 *   hand, rather than a delivery that silently never arrived.
 */

import nodemailer from 'nodemailer';

import { config } from './config.js';

let smtpTransporter = null;

const defaultNotificationRecipient = 'mail@haukesteinbach.de';

/** Wohin Meldungen an das Studio gehen — auch der Anmeldecode. */
export function studioRecipient() {
  return config.notificationEmail || defaultNotificationRecipient;
}

/* --------------------------------------------------------------------------
   To the customer
   -------------------------------------------------------------------------- */

export async function sendDeliveryEmail({ project, delivery, pageUrl }) {
  const versionNote = delivery.version > 1 ? ` (version ${delivery.version})` : '';
  const fileList = (delivery.files || []).map((file) => `- ${file.name}`).join('\n');

  const text = [
    `Hello${project.client?.name ? ` ${project.client.name}` : ''},`,
    '',
    `your files for ${project.title || project.reference}${versionNote} are ready.`,
    '',
    pageUrl,
    '',
    delivery.note ? `${delivery.note}\n` : '',
    fileList,
    '',
    `The link works until ${formatDate(delivery.expiresAt)}.`,
    'If you would like a change, there is a form on that page.',
    '',
    'Hauke Steinbach',
    'mail@haukesteinbach.de'
  ].filter((line) => line !== null).join('\n');

  return sendToCustomer({
    to: project.client?.email,
    subject: `Your files are ready — ${project.reference}${versionNote}`,
    text,
    html: buildHtml({
      heading: 'Your files are ready',
      lead: `${escapeHtml(project.title || project.reference)}${versionNote}`,
      note: delivery.note,
      buttonUrl: pageUrl,
      buttonLabel: 'Open your download page',
      lines: [
        ...(delivery.files || []).map((file) => escapeHtml(file.name)),
        '',
        `The link works until ${escapeHtml(formatDate(delivery.expiresAt))}.`,
        'If you would like a change, there is a form on that page.'
      ]
    })
  });
}

export async function sendRevisionAcknowledgementEmail({ project, revision }) {
  return sendToCustomer({
    to: project.client?.email,
    subject: `Revision request received — ${project.reference}`,
    text: [
      `Hello${project.client?.name ? ` ${project.client.name}` : ''},`,
      '',
      'your revision request arrived and is being worked on.',
      '',
      `What you asked for:\n${revision.message}`,
      '',
      'You will get a new link as soon as the revised version is ready.',
      '',
      'Hauke Steinbach'
    ].join('\n'),
    html: buildHtml({
      heading: 'Revision request received',
      lead: escapeHtml(project.reference),
      note: revision.message,
      lines: ['You will get a new link as soon as the revised version is ready.']
    })
  });
}

export async function sendOrderConfirmationEmail({ order, invoicePdf }) {
  const buyer = order.buyer || {};
  /* Ein Download kennt keine Lieferadresse und wartet auf kein Paket. Steht
     der Schluessel dran, ist es Software, und dann traegt die Mail ihn und den
     Weg zum Programm -- nicht den Satz, dass sich bald jemand ums Porto
     kuemmert. */
  const istSoftware = Boolean(order.licenceKey);
  const anschrift = [
    buyer.name,
    buyer.line1,
    buyer.line2,
    [buyer.postalCode, buyer.city].filter(Boolean).join(' '),
    buyer.country
  ].filter(Boolean).join('\n');

  const text = [
    `Hallo${buyer.name ? ` ${buyer.name.split(' ')[0]}` : ''},`,
    '',
    `vielen Dank für deine Bestellung. Die Rechnung ${order.invoiceNumber} liegt dieser Mail bei.`,
    '',
    `${order.product?.name} — ${euro(order.itemCents)}`,
    order.shippingCents ? `Versand — ${euro(order.shippingCents)}` : '',
    `Gesamt — ${euro(order.totalCents)}`,
    '',
    ...(istSoftware
      ? [
          'Dein Lizenzschlüssel:',
          order.licenceKey,
          '',
          'So kommst du an die Software: lade die Demo von haukesteinbach.de,',
          'installiere sie und trage den Schlüssel einmal ein. Die Demo ist die',
          'vollständige Fassung, der Schlüssel schaltet sie frei. Geprüft wird er',
          'auf deinem Rechner, nicht bei uns.',
          '',
          'Alles noch einmal nachschlagen, inklusive Handbuch und Download:',
          'haukesteinbach.de/account.html',
          '',
          'Widerrufsrecht: mit der Bereitstellung des Schlüssels ist es erloschen,',
          'weil du dem sofortigen Beginn der Lieferung zugestimmt hast.'
        ]
      : [
          'Lieferadresse:',
          anschrift,
          '',
          'Sobald das Paket rausgeht, bekommst du noch eine Nachricht.',
          '',
          'Widerrufsrecht: 14 Tage, eine E-Mail an mail@haukesteinbach.de genügt.'
        ]),
    '',
    'Hauke Steinbach',
    'haukesteinbach.de'
  ].filter((line) => line !== '').join('\n');

  return sendToCustomer({
    to: buyer.email,
    subject: `Bestellung bestätigt — ${order.product?.name || 'Steinbach'} (${order.invoiceNumber})`,
    text,
    html: buildHtml({
      heading: 'Bestellung bestätigt',
      lead: `Rechnung ${escapeHtml(order.invoiceNumber)}`,
      lines: [
        `${escapeHtml(order.product?.name)} &mdash; ${euro(order.itemCents)}`,
        order.shippingCents ? `Versand &mdash; ${euro(order.shippingCents)}` : '',
        `<strong style="color:#D6D6D6">Gesamt &mdash; ${euro(order.totalCents)}</strong>`,
        '',
        'Die Rechnung liegt dieser Mail als PDF bei.',
        ...(istSoftware
          ? [
              '',
              'Dein Lizenzschlüssel:',
              `<strong style="color:#E94560;font-family:monospace;word-break:break-all">${escapeHtml(order.licenceKey)}</strong>`,
              '',
              'Lade die Demo, installiere sie und trage den Schlüssel einmal ein. '
                + 'Die Demo ist die vollständige Fassung, der Schlüssel schaltet sie frei.',
              'Download, Handbuch und dieser Schlüssel jederzeit unter '
                + '<a href="https://haukesteinbach.de/account.html" style="color:#E94560">haukesteinbach.de/account.html</a>.',
              '',
              'Widerrufsrecht: mit der Bereitstellung des Schlüssels erloschen.'
            ]
          : [
              'Sobald das Paket rausgeht, bekommst du noch eine Nachricht.',
              '',
              'Widerrufsrecht: 14 Tage, eine E-Mail genügt.'
            ])
      ]
    }),
    attachments: invoicePdf
      ? [{
          filename: `${order.invoiceNumber}.pdf`,
          content: Buffer.from(invoicePdf),
          contentType: 'application/pdf'
        }]
      : undefined
  });
}

export async function sendShippedEmail({ order }) {
  const buyer = order.buyer || {};

  return sendToCustomer({
    to: buyer.email,
    subject: `Unterwegs — ${order.product?.name || 'deine Bestellung'}`,
    text: [
      `Hallo${buyer.name ? ` ${buyer.name.split(' ')[0]}` : ''},`,
      '',
      `dein ${order.product?.name} ist heute rausgegangen.`,
      order.trackingNote ? `\n${order.trackingNote}` : '',
      '',
      'Viel Freude damit.',
      '',
      'Hauke Steinbach'
    ].filter((line) => line !== '').join('\n'),
    html: buildHtml({
      heading: 'Unterwegs',
      lead: escapeHtml(order.product?.name || ''),
      note: order.trackingNote || null,
      lines: ['Viel Freude damit.']
    })
  });
}

/* --------------------------------------------------------------------------
   To the studio
   -------------------------------------------------------------------------- */

export async function sendOrderNoticeEmail({ order }) {
  const buyer = order.buyer || {};

  return sendToStudio({
    subject: `Bestellung — ${order.product?.name} (${order.invoiceNumber})`,
    text: [
      `${buyer.name || 'Jemand'} hat ${order.product?.name} gekauft.`,
      '',
      `Rechnung: ${order.invoiceNumber}`,
      `Betrag:   ${euro(order.totalCents)} (davon Versand ${euro(order.shippingCents)})`,
      '',
      'Versand an:',
      [buyer.name, buyer.line1, buyer.line2, [buyer.postalCode, buyer.city].filter(Boolean).join(' '), buyer.country]
        .filter(Boolean).join('\n'),
      '',
      buyer.email,
      '',
      `${adminUrl()}#orders`
    ].join('\n'),
    replyTo: buyer.email
  });
}

export async function sendUploadReceivedEmail({ project }) {
  const files = (project.sourceFiles || []).map((file) => `- ${file.name}`).join('\n');

  return sendToStudio({
    subject: `New upload — ${project.reference} (${project.service})`,
    text: [
      `${project.client?.name || 'A client'} <${project.client?.email || '?'}> sent files.`,
      '',
      `Reference: ${project.reference}`,
      `Service:   ${project.service}`,
      project.notes ? `Notes:     ${project.notes}` : '',
      '',
      files,
      '',
      `${adminUrl()}#project-${project.id}`
    ].filter(Boolean).join('\n'),
    replyTo: project.client?.email
  });
}

export async function sendDownloadNoticeEmail({ project, delivery }) {
  return sendToStudio({
    subject: `Collected — ${project.reference} v${delivery.version}`,
    text: [
      `${project.client?.name || 'The client'} downloaded version ${delivery.version} of ${project.reference}.`,
      '',
      `${adminUrl()}#project-${project.id}`
    ].join('\n')
  });
}

export async function sendRevisionRequestEmail({ project, revision }) {
  return sendToStudio({
    subject: `Revision requested — ${project.reference} v${revision.version}`,
    text: [
      `${project.client?.name || 'The client'} asked for a change to version ${revision.version}.`,
      '',
      revision.message,
      '',
      (revision.files || []).length ? `Attached: ${revision.files.map((f) => f.name).join(', ')}` : '',
      '',
      `${adminUrl()}#project-${project.id}`
    ].filter(Boolean).join('\n'),
    replyTo: project.client?.email
  });
}

/* --------------------------------------------------------------------------
   Transport
   -------------------------------------------------------------------------- */

async function sendToCustomer({ to, subject, text, html, attachments }) {
  if (!to) {
    return { sent: false, reason: 'no_recipient', message: 'No client email address on this project.' };
  }

  if (!isSmtpConfigured()) {
    return {
      sent: false,
      reason: 'smtp_not_configured',
      recipient: to,
      message: 'No mail server is configured, so nothing was sent to the client. Copy the link and send it yourself.'
    };
  }

  return sendSmtp({ to, subject, text, html, attachments });
}

/**
 * The sign-in code.
 *
 * Deliberately terse. It says what to do and, more importantly, what it means
 * if you did not ask for it: someone has your password.
 */
/**
 * Ein Angebot oder eine Rechnung an den Kunden schicken.
 *
 * Geschäftspost, kein Newsletter: Anrede, ein Satz worum es geht, die Summe,
 * das PDF im Anhang. Die Antwort geht an die Studioadresse, damit ein „passt
 * so" oder eine Rückfrage dort landet, wo sie hingehört, und nicht in einem
 * Postfach, das niemand liest.
 */
export async function sendDocumentEmail({ document, pdf, message }) {
  const an = document.recipient || {};
  const istRechnung = document.kind === 'invoice';
  const vorname = String(an.name || '').trim().split(' ')[0];

  const betreff = istRechnung
    ? `Rechnung ${document.number}${document.title ? ` — ${document.title}` : ''}`
    : `Angebot ${document.number}${document.title ? ` — ${document.title}` : ''}`;

  const einleitung = String(message || '').trim() || (istRechnung
    ? `anbei die Rechnung ${document.number}${document.title ? ` für ${document.title}` : ''}. `
      + 'Zahlbar innerhalb von 14 Tagen ohne Abzug; die Bankverbindung steht auf der Rechnung.'
    : `anbei mein Angebot ${document.number}${document.title ? ` für ${document.title}` : ''}. `
      + 'Rückfragen jederzeit gern — eine Antwort auf diese Mail genügt.');

  const positionen = (document.items || [])
    .map((p) => `${p.quantity} × ${p.name} — ${euro(p.totalCents)}`);

  const text = [
    `Hallo${vorname ? ` ${vorname}` : ''},`,
    '',
    einleitung,
    '',
    ...positionen,
    `Gesamt — ${euro(document.totalCents)}`,
    '',
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    !istRechnung && document.validUntil
      ? `Das Angebot gilt bis zum ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date(document.validUntil))}.`
      : '',
    '',
    'Viele Grüße',
    'Hauke Steinbach',
    'haukesteinbach.de'
  ].filter((line) => line !== '').join('\n');

  return sendToCustomer({
    to: an.email,
    subject: betreff,
    text,
    html: buildHtml({
      heading: istRechnung ? 'Rechnung' : 'Angebot',
      lead: escapeHtml(`${document.number}${document.title ? ` — ${document.title}` : ''}`),
      lines: [
        escapeHtml(einleitung),
        '',
        ...positionen.map(escapeHtml),
        `<strong style="color:#D6D6D6">Gesamt &mdash; ${euro(document.totalCents)}</strong>`,
        '',
        'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        `Das ${istRechnung ? 'Rechnungs' : 'Angebots'}-PDF liegt dieser Mail bei.`
      ]
    }),
    attachments: pdf
      ? [{
          /* Derselbe Name wie beim Download, damit ein Beleg im Postfach und
             im Ordner gleich heisst -- die Nummer traegt ihr Kuerzel selbst. */
          filename: `${document.number}.pdf`,
          content: Buffer.from(pdf),
          contentType: 'application/pdf'
        }]
      : []
  });
}

/**
 * Der Anmeldecode fuer den Kontobereich, an den Kaeufer.
 *
 * Nicht sendLoginCodeEmail: die geht ans Studio und sagt Dinge, die einen
 * Kunden nichts angehen. Und sie darf hier auch inhaltlich nicht stehen,
 * denn hier gibt es kein Passwort, das jemand kennen koennte -- der Satz
 * "dann kennt jemand dein Passwort" waere schlicht falsch.
 */
export async function sendAccountCodeEmail({ to, code, minutes }) {
  return sendToCustomer({
    to,
    subject: `Dein Anmeldecode ${code}`,
    text: [
      `Dein Code: ${code}`,
      '',
      `Er gilt ${minutes} Minuten und lässt sich einmal verwenden.`,
      '',
      'Damit kommst du an deinen Lizenzschlüssel, den Download und das',
      'Handbuch: haukesteinbach.de/account.html',
      '',
      'Hast du keinen Code angefordert, ignoriere diese Mail. Ohne den Code',
      'passiert nichts, und ein Passwort gibt es hier nicht.',
      '',
      'Hauke Steinbach',
      'haukesteinbach.de'
    ].join('\n'),
    html: buildHtml({
      heading: 'Dein Anmeldecode',
      lead: 'Kontobereich',
      lines: [
        `<strong style="color:#E94560;font-size:28px;letter-spacing:.18em;font-family:monospace">${escapeHtml(code)}</strong>`,
        '',
        `Gültig ${minutes} Minuten, einmal verwendbar.`,
        '',
        'Damit kommst du an deinen Lizenzschlüssel, den Download und das Handbuch.',
        '',
        'Hast du keinen Code angefordert, ignoriere diese Mail. Ohne den Code passiert nichts.'
      ]
    })
  });
}

/* --------------------------------------------------------------------------
   Newsletter
   --------------------------------------------------------------------------
   Zwei Mails: die Bestätigung, ohne die niemand auf den Verteiler kommt, und
   die Ausgabe selbst.
   -------------------------------------------------------------------------- */

/**
 * Die Bestätigungsmail.
 *
 * Sie ist selbst KEINE Werbung, und das ist wichtig: sie darf nur den Link
 * enthalten und die Auskunft, was passiert, wenn man ihn nicht anklickt. Wer
 * hier schon Neuigkeiten unterbringt, verschickt Werbung an jemanden, der noch
 * nicht eingewilligt hat -- und macht damit genau den Fehler, den die doppelte
 * Bestätigung verhindern soll.
 */
export async function sendNewsletterConfirmEmail({ to, url }) {
  return sendToCustomer({
    to,
    subject: 'Bitte bestätige deine Anmeldung',
    text: [
      'Du möchtest den Newsletter von Steinbach bekommen.',
      '',
      'Ein Klick, dann ist es eingerichtet:',
      url,
      '',
      'Warst du das nicht, ignoriere diese Mail. Ohne diesen Klick wird nichts',
      'verschickt, und die Adresse wird nach zwei Wochen von selbst gelöscht.',
      '',
      'Hauke Steinbach',
      'haukesteinbach.de'
    ].join('\n'),
    html: buildHtml({
      heading: 'Anmeldung bestätigen',
      lead: 'Newsletter',
      lines: [
        'Du möchtest den Newsletter von Steinbach bekommen. Ein Klick, dann ist es eingerichtet.',
        '',
        `<a href="${escapeHtml(url)}" style="color:#E94560">${escapeHtml(url)}</a>`,
        '',
        'Warst du das nicht, ignoriere diese Mail. Ohne diesen Klick wird nichts '
          + 'verschickt, und die Adresse wird nach zwei Wochen von selbst gelöscht.'
      ]
    })
  });
}

/**
 * Eine Ausgabe an einen Empfänger.
 *
 * Der Abmeldelink steht in jeder Ausgabe, im Text und in der HTML-Fassung, und
 * zusätzlich als List-Unsubscribe im Kopf der Mail: daraus baut Gmail den
 * Abmeldeknopf neben dem Absender. Wer den findet, klickt nicht auf "Spam", und
 * das ist der Unterschied zwischen einem Verteiler, der ankommt, und einem, der
 * im Werbeordner landet.
 */
export async function sendNewsletterEmail({ to, subject, body, unsubscribeUrl }) {
  const absaetze = String(body).split(/\n{2,}/).map((a) => a.trim()).filter(Boolean);

  /* EINE ZEILE, DIE NUR EINE BILDADRESSE IST, WIRD ZUM BILD.
     Mehr Auszeichnung gibt es bewusst nicht: eine Ausgabe, die Gestaltung
     braucht, um zu wirken, hat nichts zu sagen.
     Die Adresse muss absolut sein und auf haukesteinbach.de zeigen. Eingebettete
     Daten (data:) sind hier nutzlos -- Gmail zeigt sie nicht an, das war beim
     Bild in der Mailsignatur schon so. In der Textfassung bleibt die Adresse
     als Adresse stehen, dort ist sie das Beste, was ein Bild sein kann. */
  const istBild = (zeile) => /^https:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)$/i.test(zeile);

  const zuHtml = (absatz) => (istBild(absatz)
    ? `<img src="${escapeHtml(absatz)}" alt="" width="512"`
      + ' style="display:block;width:100%;max-width:512px;height:auto;border:1px solid #232323;margin:6px 0;">'
    : escapeHtml(absatz).replace(/\n/g, '<br>'));

  return sendSmtp({
    to,
    subject,
    text: [
      body,
      '',
      '—',
      'Keine Lust mehr? Ein Klick genügt:',
      unsubscribeUrl
    ].join('\n'),
    html: buildHtml({
      heading: subject,
      lead: 'Steinbach',
      lines: [
        ...absaetze.map(zuHtml),
        '',
        `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#8C8C8C">Abmelden</a>`
      ]
    }),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
}

export async function sendLoginCodeEmail({ code, ip, minutes }) {
  return sendToStudio({
    subject: `Anmeldecode ${code}`,
    text: [
      `Dein Code fuer den Adminbereich: ${code}`,
      '',
      `Gueltig ${minutes} Minuten, einmalig verwendbar.`,
      '',
      `Angefordert von ${ip || 'unbekannter Adresse'}.`,
      '',
      'Warst du das nicht, kennt jemand dein Passwort. Dann sofort aendern:',
      'npm run admin-password -- "neues passwort"',
      'und die neue Zeile auf den Server geben.'
    ].join('\n')
  });
}

/* ---------------------------------------------------------------------------
   Studio bookings
   ---------------------------------------------------------------------------
   English throughout: these go to clients, and the rest of the site speaks
   English to them too.
   --------------------------------------------------------------------------- */

function bookingWhen(booking) {
  const format = (options) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', ...options
  });

  const start = new Date(booking.start);
  const end = new Date(booking.end);

  const day = format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
  const from = format({ hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
  const to = format({ hour: '2-digit', minute: '2-digit', hour12: false }).format(end);
  const hours = Math.round(((end - start) / 3600000) * 10) / 10;

  return { day, from, to, hours, span: `${day}, ${from}–${to} (${hours} h)` };
}

/**
 * The proposal.
 *
 * Two links rather than "reply if that works": a reply has to be read and
 * acted on, a click cannot be forgotten about. Both are in the mail because
 * declining has to be as easy as accepting — otherwise the answer that never
 * comes is a slot held for nobody.
 */
export async function sendBookingProposalEmail({ booking, address, confirmUrl, declineUrl, ics, message }) {
  const when = bookingWhen(booking);
  const vorname = String(booking.client?.name || '').trim().split(' ')[0];

  const text = [
    `Hi${vorname ? ` ${vorname}` : ''},`,
    '',
    String(message || '').trim() || `here is a studio slot for ${booking.title}:`,
    '',
    when.span,
    address,
    '',
    'Please confirm so I can hold it:',
    confirmUrl,
    '',
    'If it does not suit you:',
    declineUrl,
    '',
    'The attached calendar file holds the date; it is marked tentative until you confirm.',
    '',
    booking.note || '',
    '',
    'Best',
    'Hauke Steinbach',
    'haukesteinbach.de'
  ].filter((line) => line !== '').join('\n');

  return sendToCustomer({
    to: booking.client?.email,
    subject: `Studio time — ${when.day}, ${when.from}`,
    text,
    html: buildHtml({
      heading: 'Studio time',
      lead: escapeHtml(when.span),
      note: `${address}${booking.note ? `\n\n${booking.note}` : ''}`,
      buttonUrl: confirmUrl,
      buttonLabel: 'Confirm this slot',
      lines: [
        escapeHtml(String(message || '').trim() || `A slot for ${booking.title}.`),
        '',
        `Does not suit you? <a href="${escapeHtml(declineUrl)}" style="color:#E94560">Let me know</a> and I will suggest another time.`,
        '',
        'The calendar file attached holds the date. It stays marked tentative until you confirm.'
      ]
    }),
    attachments: ics
      ? [{
          filename: 'studio-session.ics',
          content: Buffer.from(ics, 'utf8'),
          /* method=REQUEST makes a mail client offer accept and decline rather
             than just filing it away. */
          contentType: 'text/calendar; charset=utf-8; method=REQUEST'
        }]
      : []
  });
}

/** What the client gets once they have confirmed. */
export async function sendBookingConfirmedEmail({ booking, address, ics }) {
  const when = bookingWhen(booking);
  const vorname = String(booking.client?.name || '').trim().split(' ')[0];

  const text = [
    `Hi${vorname ? ` ${vorname}` : ''},`,
    '',
    `your studio time is confirmed:`,
    '',
    when.span,
    address,
    '',
    'The calendar file is attached — open it and the session goes straight into your calendar.',
    '',
    'If anything changes, just reply to this mail.',
    '',
    'See you then',
    'Hauke Steinbach',
    'haukesteinbach.de'
  ].join('\n');

  return sendToCustomer({
    to: booking.client?.email,
    subject: `Confirmed — studio ${when.day}, ${when.from}`,
    text,
    html: buildHtml({
      heading: 'Studio time confirmed',
      lead: escapeHtml(when.span),
      note: address,
      lines: [
        'The calendar file attached puts the session straight into your calendar.',
        '',
        'If anything changes, just reply to this mail.',
        '',
        'See you then.'
      ]
    }),
    attachments: ics
      ? [{
          filename: 'studio-session.ics',
          content: Buffer.from(ics, 'utf8'),
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
        }]
      : []
  });
}

/**
 * The studio's own copy, with the file for the shared calendar.
 *
 * This is the step that puts the session on the calendar the room is booked
 * through, and it happens only after the client has confirmed — an entry made
 * any earlier holds a slot on a promise.
 */
export async function sendBookingToStudioEmail({ booking, address, ics, answer }) {
  const when = bookingWhen(booking);
  const confirmed = answer !== 'declined';

  return sendToStudio({
    subject: confirmed
      ? `Bestätigt: ${booking.client?.name || 'Kunde'} — ${when.day}, ${when.from}`
      : `Abgesagt: ${booking.client?.name || 'Kunde'} — ${when.day}, ${when.from}`,
    text: [
      confirmed
        ? `${booking.client?.name || 'Der Kunde'} hat den Termin bestätigt.`
        : `${booking.client?.name || 'Der Kunde'} hat abgesagt.`,
      '',
      when.span,
      address,
      '',
      booking.title,
      booking.client?.email || '',
      '',
      confirmed
        ? 'Die angehängte Datei öffnen, dann steht der Termin im geteilten Studiokalender.'
        : 'Der Platz ist wieder frei.',
      '',
      `${adminUrl()}#bookings`
    ].filter((line) => line !== '').join('\n'),
    replyTo: booking.client?.email || undefined,
    attachments: confirmed && ics
      ? [{
          filename: `studio-${when.day.replace(/\s+/g, '-').toLowerCase()}.ics`,
          content: Buffer.from(ics, 'utf8'),
          contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
        }]
      : []
  });
}

async function sendToStudio({ subject, text, replyTo, attachments }) {
  const recipient = config.notificationEmail || defaultNotificationRecipient;

  if (isSmtpConfigured()) {
    return sendSmtp({ to: recipient, subject, text, replyTo, attachments });
  }

  return sendFormspree({ subject, text, replyTo, recipient });
}

/**
 * The address mail goes out as.
 *
 * MAIL_FROM_EMAIL if it is set. Otherwise SMTP_USER, which at nearly every
 * provider is the mailbox address anyway — leaving a working mail server
 * unused over a missing second line is the worse outcome. Only when the user
 * is not an address (some providers use an account number) is there nothing
 * to fall back to.
 */
function fromAddress() {
  if (config.mailFromEmail) {
    return config.mailFromEmail;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.smtpUser || '') ? config.smtpUser : '';
}

function isSmtpConfigured() {
  return Boolean(config.smtpHost && fromAddress());
}

/**
 * What /health reports about mail.
 *
 * Without SMTP the studio still gets its notifications through Formspree, so
 * everything looks fine from the inside — while deliveries to clients quietly
 * never go out, because Formspree can only ever reach its own form owner.
 * That difference is worth naming before a client is waiting on a link.
 */
export function describeMailSetup() {
  if (isSmtpConfigured()) {
    return {
      ok: true,
      transport: 'smtp',
      host: config.smtpHost,
      from: fromAddress(),
      /* worth seeing, so a surprising sender address is noticed here rather
         than in a client's inbox */
      fromSource: config.mailFromEmail ? 'MAIL_FROM_EMAIL' : 'SMTP_USER',
      reachesClients: true
    };
  }

  const fehlt = [
    !config.smtpHost ? 'SMTP_HOST' : null,
    !fromAddress() ? 'MAIL_FROM_EMAIL' : null
  ].filter(Boolean);

  return {
    ok: false,
    transport: config.formspreeUploadEndpoint ? 'formspree' : 'none',
    reachesClients: false,
    missing: fehlt,
    note: 'Notifications to the studio work; deliveries to clients do not go out.'
  };
}

async function sendSmtp({ to, subject, text, html, replyTo, attachments, headers }) {
  try {
    const response = await getSmtpTransporter().sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      html,
      attachments,
      /* Fuer List-Unsubscribe im Newsletter. Sonst ungenutzt. */
      headers: headers || undefined,
      replyTo: replyTo || config.mailReplyTo || undefined
    });

    return { sent: true, provider: 'smtp', recipient: to, messageId: response.messageId || null };
  } catch (error) {
    console.error('[mail] SMTP send failed:', error?.message || error);

    return {
      sent: false,
      provider: 'smtp',
      recipient: to,
      reason: 'send_failed',
      message: 'The mail server rejected the message.'
    };
  }
}

async function sendFormspree({ subject, text, replyTo, recipient }) {
  const endpoint = config.formspreeUploadEndpoint;

  if (!endpoint) {
    return { sent: false, reason: 'no_mail_transport', message: 'Neither SMTP nor Formspree is configured.' };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ _subject: subject, message: text, email: replyTo || undefined })
    });

    if (!response.ok) {
      throw new Error(`Formspree responded ${response.status}`);
    }

    return { sent: true, provider: 'formspree', recipient };
  } catch (error) {
    console.error('[mail] Formspree send failed:', error?.message || error);
    return { sent: false, provider: 'formspree', reason: 'send_failed', message: 'The notification could not be sent.' };
  }
}

function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser || config.smtpPassword
        ? { user: config.smtpUser, pass: config.smtpPassword }
        : undefined
    });
  }

  return smtpTransporter;
}

/* --------------------------------------------------------------------------
   Formatting
   -------------------------------------------------------------------------- */

/**
 * Der Rahmen jeder Mail.
 *
 * WARUM DER HINTERGRUND NICHT AM <body> HAENGT: Gmail wirft <html> und <body>
 * weg und behaelt nur deren Inhalt. Alles, was dort an Farbe stand, war damit
 * verloren -- dieselbe Mail kam in Apple Mail schwarz an und in Gmail als
 * weisse Flaeche mit grauem Text. Gemeldet am 08.09. an zwei Postfaechern
 * derselben Probe.
 *
 * Die Farbe sitzt deshalb an einem <div>, das Gmail stehen laesst, und zwar
 * an zweien: das aeussere faerbt die Flaeche, das innere traegt den Satz. Am
 * <body> bleibt sie zusaetzlich stehen, fuer alle Programme, die ihn behalten.
 *
 * Jede Zeile darin traegt ihre Farbe ausserdem selbst. Doppelt gemoppelt, aber
 * ein Mailprogramm ist kein Browser: es gibt kein Erben, auf das man sich
 * verlassen koennte.
 */
function buildHtml({ heading, lead, note, buttonUrl, buttonLabel, lines }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#000000;color:#D6D6D6;font-family:Helvetica,Arial,sans-serif;">
  <div style="background:#000000;color:#D6D6D6;font-family:Helvetica,Arial,sans-serif;padding:1px 0;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;background:#000000;color:#D6D6D6;">
    <p style="margin:0 0 28px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#E94560;">Steinbach</p>
    <h1 style="margin:0 0 10px;font-size:28px;line-height:1.1;color:#FFFFFF;">${escapeHtml(heading)}</h1>
    ${lead ? `<p style="margin:0 0 24px;color:#8C8C8C;font-size:14px;">${lead}</p>` : ''}
    ${note ? `<div style="margin:0 0 24px;padding:14px 16px;background:#0B0B0B;border-left:2px solid #E94560;color:#D6D6D6;font-size:14px;line-height:1.6;">${escapeHtml(note).replace(/\n/g, '<br>')}</div>` : ''}
    ${buttonUrl ? `<p style="margin:0 0 28px;">
      <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#E94560;color:#000000;text-decoration:none;padding:14px 26px;font-weight:bold;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(buttonLabel || 'Open')}</a>
    </p>` : ''}
    ${(lines || []).map((line) => line
      ? `<p style="margin:0 0 6px;color:#8C8C8C;font-size:13px;line-height:1.6;">${line}</p>`
      : '<div style="height:12px"></div>').join('')}
    <p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #232323;color:#4A4A4A;font-size:12px;">
      Hauke Steinbach &middot; Hamburg &middot; <a href="mailto:mail@haukesteinbach.de" style="color:#8C8C8C;">mail@haukesteinbach.de</a>
    </p>
  </div>
  </div>
</body></html>`;
}

function adminUrl() {
  return `${config.appOrigin.replace(/\/$/, '')}/admin.html`;
}

function euro(cents) {
  return `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
