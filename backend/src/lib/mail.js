import { config } from './config.js';

export async function sendUploadNotificationEmail({ job, downloadUrl }) {
  if (!config.postmarkServerToken || !config.notificationEmail || !config.mailFromEmail) {
    return {
      sent: false,
      skipped: true,
      reason: 'mail_not_configured'
    };
  }

  const subject = `New upload received: ${job.reference}`;
  const textBody = [
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
    `Project notes: ${job.projectNotes || 'None provided.'}`
  ].join('\n');

  const htmlBody = `
    <h1>New upload received</h1>
    <p>A client upload has been completed.</p>
    <ul>
      <li><strong>Reference:</strong> ${escapeHtml(job.reference)}</li>
      <li><strong>Client:</strong> ${escapeHtml(`${job.firstName} ${job.lastName}`)}</li>
      <li><strong>Email:</strong> ${escapeHtml(job.email)}</li>
      <li><strong>Service:</strong> ${escapeHtml(job.service)}</li>
      <li><strong>Files:</strong> ${job.uploadedFiles.length}</li>
    </ul>
    <p><a href="${downloadUrl}">Open secure download page</a></p>
    <p><strong>Project notes:</strong><br>${escapeHtml(job.projectNotes || 'None provided.').replace(/\n/g, '<br>')}</p>
  `;

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': config.postmarkServerToken
    },
    body: JSON.stringify({
      From: config.mailFromEmail,
      To: config.notificationEmail,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      MessageStream: 'outbound'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    return {
      sent: false,
      skipped: false,
      reason: 'mail_delivery_failed',
      details: errorText
    };
  }

  return {
    sent: true,
    skipped: false,
    reason: null
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}