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
    'Lieferadresse:',
    anschrift,
    '',
    'Sobald das Paket rausgeht, bekommst du noch eine Nachricht.',
    '',
    'Widerrufsrecht: 14 Tage, eine E-Mail an mail@haukesteinbach.de genügt.',
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
        'Sobald das Paket rausgeht, bekommst du noch eine Nachricht.',
        '',
        'Widerrufsrecht: 14 Tage, eine E-Mail genügt.'
      ]
    }),
    attachments: invoicePdf
      ? [{
          filename: `Rechnung-${order.invoiceNumber}.pdf`,
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

async function sendToStudio({ subject, text, replyTo }) {
  const recipient = config.notificationEmail || defaultNotificationRecipient;

  if (isSmtpConfigured()) {
    return sendSmtp({ to: recipient, subject, text, replyTo });
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

async function sendSmtp({ to, subject, text, html, replyTo, attachments }) {
  try {
    const response = await getSmtpTransporter().sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      html,
      attachments,
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

function buildHtml({ heading, lead, note, buttonUrl, buttonLabel, lines }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;background:#000000;color:#D6D6D6;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
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
