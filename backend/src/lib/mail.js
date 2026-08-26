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

/* --------------------------------------------------------------------------
   To the studio
   -------------------------------------------------------------------------- */

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

async function sendToCustomer({ to, subject, text, html }) {
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

  return sendSmtp({ to, subject, text, html });
}

async function sendToStudio({ subject, text, replyTo }) {
  const recipient = config.notificationEmail || defaultNotificationRecipient;

  if (isSmtpConfigured()) {
    return sendSmtp({ to: recipient, subject, text, replyTo });
  }

  return sendFormspree({ subject, text, replyTo, recipient });
}

function isSmtpConfigured() {
  return Boolean(config.smtpHost && config.mailFromEmail);
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
    return { ok: true, transport: 'smtp', host: config.smtpHost, reachesClients: true };
  }

  const fehlt = [
    !config.smtpHost ? 'SMTP_HOST' : null,
    !config.mailFromEmail ? 'MAIL_FROM_EMAIL' : null
  ].filter(Boolean);

  return {
    ok: false,
    transport: config.formspreeUploadEndpoint ? 'formspree' : 'none',
    reachesClients: false,
    missing: fehlt,
    note: 'Notifications to the studio work; deliveries to clients do not go out.'
  };
}

async function sendSmtp({ to, subject, text, html, replyTo }) {
  try {
    const response = await getSmtpTransporter().sendMail({
      from: config.mailFromEmail,
      to,
      subject,
      text,
      html,
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
