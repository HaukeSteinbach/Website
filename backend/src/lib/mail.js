import nodemailer from 'nodemailer';

import { config } from './config.js';

let smtpTransporter = null;

const defaultNotificationRecipient = 'mail@haukesteinbach.de';

export async function sendUploadNotificationEmail({ job, downloadUrl }) {
  const notificationEndpoint = getFormspreeNotificationEndpoint();

  if (!notificationEndpoint) {
    return {
      sent: false,
      skipped: true,
      reason: 'mail_not_configured'
    };
  }

  const subject = `New upload received: ${job.reference}`;
  const message = buildUploadNotificationMessage({ job, downloadUrl });
  const payload = new URLSearchParams({
    form_source: 'Project upload',
    subject,
    reference: job.reference,
    client_name: `${job.firstName} ${job.lastName}`.trim(),
    email: job.email,
    service: job.service,
    files_count: String(job.uploadedFiles.length),
    download_url: downloadUrl,
    project_notes: job.projectNotes || 'None provided.',
    street_1: job.address?.street1 || '',
    street_2: job.address?.street2 || '',
    postal_code: job.address?.postalCode || '',
    city: job.address?.city || '',
    region: job.address?.region || '',
    country: job.address?.country || '',
    message,
    _replyto: job.email
  });

  try {
    const response = await fetch(notificationEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json'
      },
      body: payload
    });
    const result = await parseProviderResponse(response);

    if (!response.ok) {
      throw new Error(extractFormspreeError(result));
    }

    return {
      sent: true,
      skipped: false,
      reason: null,
      provider: 'formspree',
      recipient: null,
      providerMessageId: result?.submissionId || result?.id || null
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: 'mail_delivery_failed',
      provider: 'formspree',
      recipient: null,
      details: extractFormspreeError(error)
    };
  }
}

export async function sendDirectDeliveryEmail({ delivery }) {
  if (!config.smtpHost || !config.smtpPort || !config.mailFromEmail || !delivery.recipientEmail) {
    return {
      sent: false,
      skipped: true,
      reason: 'mail_not_configured'
    };
  }

  const subject = delivery.deliveryTitle
    ? 'You have received files'
    : 'You have received files';
  const textBody = [
    'You have received files',
    '',
    `Expiring date: ${formatDate(delivery.expiresAt)}`,
    ...delivery.files.map((file) => `Download available: ${file.originalFilename}`),
    `Download link: ${delivery.pageUrl}`
  ].filter(Boolean).join('\n');
  const htmlBody = `
    <h1>You have received files</h1>
    <p><strong>Expiring date:</strong> ${escapeHtml(formatDate(delivery.expiresAt))}</p>
    <ul>
      ${delivery.files.map((file) => `<li><strong>Download available:</strong> ${escapeHtml(file.originalFilename)}</li>`).join('')}
    </ul>
    <p><a href="${delivery.pageUrl}">Download link</a></p>
  `;

  return sendSmtpMail({
    to: delivery.recipientEmail,
    subject,
    textBody,
    htmlBody,
    replyTo: config.mailReplyTo || getNotificationRecipient()
  });
}

export async function sendDirectDeliveryDownloadNotificationEmail({ delivery, file }) {
  const notificationEndpoint = getFormspreeNotificationEndpoint();

  if (!notificationEndpoint) {
    return {
      sent: false,
      skipped: true,
      reason: 'mail_not_configured'
    };
  }

  const subject = `Download confirmed: ${delivery.reference}`;
  const payload = new URLSearchParams({
    form_source: 'Delivery download confirmation',
    subject,
    reference: delivery.reference,
    recipient_email: delivery.recipientEmail,
    recipient_name: delivery.recipientName || '',
    delivery_title: delivery.deliveryTitle || '',
    first_downloaded_file: file?.originalFilename || '',
    files_count: String(delivery.files.length),
    download_page: delivery.pageUrl,
    downloaded_at: new Date().toISOString(),
    message: buildDirectDeliveryDownloadNotificationMessage({ delivery, file }),
    _replyto: delivery.recipientEmail
  });

  try {
    const response = await fetch(notificationEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json'
      },
      body: payload
    });
    const result = await parseProviderResponse(response);

    if (!response.ok) {
      throw new Error(extractFormspreeError(result));
    }

    return {
      sent: true,
      skipped: false,
      reason: null,
      provider: 'formspree',
      recipient: getNotificationRecipient(),
      providerMessageId: result?.submissionId || result?.id || null
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: 'mail_delivery_failed',
      provider: 'formspree',
      recipient: getNotificationRecipient(),
      details: extractFormspreeError(error)
    };
  }
}

async function sendSmtpMail({ to, subject, textBody, htmlBody, replyTo }) {
  try {
    const transporter = getSmtpTransporter();
    const response = await transporter.sendMail({
      from: config.mailFromEmail,
      to,
      subject,
      text: textBody,
      html: htmlBody,
      replyTo: replyTo || undefined
    });

    return {
      sent: true,
      skipped: false,
      reason: null,
      provider: 'smtp',
      recipient: to,
      providerMessageId: response.messageId || null
    };
  } catch (error) {
    const details = extractMailError(error);

    return {
      sent: false,
      skipped: false,
      reason: 'mail_delivery_failed',
      provider: 'smtp',
      recipient: to,
      details
    };
  }
}

function getNotificationRecipient() {
  return config.notificationEmail || defaultNotificationRecipient;
}

function getFormspreeNotificationEndpoint() {
  return config.formspreeUploadEndpoint || '';
}

function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser || config.smtpPassword
        ? {
            user: config.smtpUser,
            pass: config.smtpPassword
          }
        : undefined
    });
  }

  return smtpTransporter;
}

function extractMailError(error) {
  if (!error) {
    return 'Unknown mail error';
  }

  if (typeof error.message === 'string' && error.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch (_jsonError) {
    return 'Unserializable mail error';
  }
}

async function parseProviderResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    return null;
  }

  return response.json();
}

function extractFormspreeError(error) {
  if (!error) {
    return 'Form submission failed.';
  }

  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors
      .map((entry) => entry.message)
      .filter(Boolean)
      .join(' ') || 'Form submission failed.';
  }

  if (typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return 'Form submission failed.';
}

function buildUploadNotificationMessage({ job, downloadUrl }) {
  return [
    'A new upload has been completed.',
    '',
    `Reference: ${job.reference}`,
    `Client: ${job.firstName} ${job.lastName}`,
    `Email: ${job.email}`,
    `Service: ${job.service}`,
    `Files: ${job.uploadedFiles.length}`,
    '',
    `Download files: ${downloadUrl}`,
    '',
    'Address:',
    `${job.address?.street1 || ''}`,
    job.address?.street2 || '',
    `${job.address?.postalCode || ''} ${job.address?.city || ''}`.trim(),
    [job.address?.region || '', job.address?.country || ''].filter(Boolean).join(', '),
    '',
    `Project notes: ${job.projectNotes || 'None provided.'}`
  ].filter(Boolean).join('\n');
}

function buildDirectDeliveryDownloadNotificationMessage({ delivery, file }) {
  return [
    'A client has downloaded delivered files.',
    '',
    `Reference: ${delivery.reference}`,
    `Recipient: ${delivery.recipientEmail}`,
    delivery.recipientName ? `Recipient name: ${delivery.recipientName}` : null,
    delivery.deliveryTitle ? `Title: ${delivery.deliveryTitle}` : null,
    file ? `First downloaded file: ${file.originalFilename}` : null,
    `Files in delivery: ${delivery.files.length}`,
    `Download page: ${delivery.pageUrl}`
  ].filter(Boolean).join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}