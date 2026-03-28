import fs from 'fs';
import path from 'path';

import express from 'express';
import multer from 'multer';

import { config } from '../lib/config.js';
import { ok, fail } from '../lib/http.js';
import { sendUploadNotificationEmail } from '../lib/mail.js';
import { createPublicReference } from '../lib/reference.js';

const router = express.Router();
const allowedExtensions = ['wav', 'aiff', 'flac', 'zip', 'rar', 'mp3'];
const maxFileSizeBytes = 10737418240;
const maxTotalSizeBytes = 10737418240;
const jobs = new Map();
const sourceDownloadTokens = new Map();

const uploadStorage = multer.diskStorage({
  destination: (request, _file, callback) => {
    const destination = getJobUploadDir(request.params.jobId);

    fs.mkdirSync(destination, { recursive: true });
    callback(null, destination);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const baseName = path.basename(file.originalname || 'upload', extension);
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';

    callback(null, `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: maxFileSizeBytes,
    files: 25
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname || '').slice(1).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }

    callback(null, true);
  }
});

router.post('/jobs', (request, response) => {
  const { firstName, lastName, email, address, service, privacyConsent, policyVersion } = request.body;

  if (!firstName || !lastName || !email || !address?.street1 || !address?.postalCode || !address?.city || !address?.country || !service || !privacyConsent || !policyVersion) {
    return fail(response, 422, 'validation_error', 'One or more required fields are missing.');
  }

  const jobId = crypto.randomUUID();
  const reference = createPublicReference();

  jobs.set(jobId, {
    id: jobId,
    reference,
    firstName,
    lastName,
    email,
    address,
    service,
    projectNotes: request.body.projectNotes || '',
    status: 'draft',
    uploadedFiles: []
  });

  return ok(response, {
    jobId,
    reference,
    status: 'draft',
    upload: {
      provider: 'multipart',
      endpoint: `/api/v1/public/jobs/${jobId}/files`,
      maxFileSizeBytes,
      maxTotalSizeBytes,
      allowedExtensions
    }
  }, 201);
});

router.post('/jobs/:jobId/files', (request, response) => {
  upload.array('files')(request, response, (error) => {
    if (error) {
      return handleUploadError(error, response);
    }

    const job = jobs.get(request.params.jobId);

    if (!job) {
      removeUploadedFiles(request.files);
      return fail(response, 404, 'not_found', 'Upload job not found.');
    }

    const uploadedFiles = Array.isArray(request.files) ? request.files : [];

    if (!uploadedFiles.length) {
      return fail(response, 422, 'validation_error', 'At least one uploaded file is required.');
    }

    const nextFiles = uploadedFiles.map((file) => ({
      storageKey: path.relative(config.uploadDir, file.path).split(path.sep).join('/'),
      originalFilename: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size
    }));

    const combinedSize = sumFileSizes(job.uploadedFiles) + sumFileSizes(nextFiles);

    if (combinedSize > maxTotalSizeBytes) {
      removeUploadedFiles(uploadedFiles);
      return fail(response, 422, 'validation_error', 'The combined upload size exceeds the allowed limit.');
    }

    job.uploadedFiles = job.uploadedFiles.concat(nextFiles);

    return ok(response, {
      ok: true,
      jobId: job.id,
      reference: job.reference,
      uploadedFiles: job.uploadedFiles,
      totalSizeBytes: sumFileSizes(job.uploadedFiles)
    }, 201);
  });
});

router.post('/jobs/:jobId/uploads/complete', async (request, response) => {
  const job = jobs.get(request.params.jobId);
  const uploadedFiles = Array.isArray(request.body?.uploadedFiles) && request.body.uploadedFiles.length > 0
    ? request.body.uploadedFiles
    : job?.uploadedFiles || [];

  if (!job) {
    return fail(response, 404, 'not_found', 'Upload job not found.');
  }

  if (uploadedFiles.length === 0) {
    return fail(response, 422, 'validation_error', 'At least one uploaded file is required.');
  }

  job.status = 'uploaded';
  job.uploadedFiles = uploadedFiles;

  const sourceDownload = createSourceDownload(job);
  const mailResult = await sendUploadNotificationEmail({
    job,
    downloadUrl: sourceDownload.pageUrl
  });

  return ok(response, {
    ok: true,
    jobId: request.params.jobId,
    reference: job.reference,
    status: 'uploaded',
    event: 'uploaded',
    uploadedFiles: job.uploadedFiles,
    notification: {
      sent: mailResult.sent,
      skipped: Boolean(mailResult.skipped),
      reason: mailResult.reason,
      recipient: config.notificationEmail || null
    },
    sourceDownload: {
      expiresAt: sourceDownload.expiresAt,
      pageUrl: sourceDownload.pageUrl
    }
  });
});

router.get('/source-downloads/:token', (request, response) => {
  const sourceDownload = sourceDownloadTokens.get(request.params.token);

  if (!sourceDownload || isExpired(sourceDownload.expiresAt)) {
    return fail(response, 404, 'not_found', 'Source download link not found or expired.');
  }

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.send(renderSourceDownloadPage(sourceDownload));
});

router.get('/source-downloads/:token/files/:fileId', (request, response) => {
  const sourceDownload = sourceDownloadTokens.get(request.params.token);

  if (!sourceDownload || isExpired(sourceDownload.expiresAt)) {
    return fail(response, 404, 'not_found', 'Source download link not found or expired.');
  }

  const file = sourceDownload.files.find((entry) => entry.id === request.params.fileId);

  if (!file) {
    return fail(response, 404, 'not_found', 'Requested file not found.');
  }

  if (!fs.existsSync(file.absolutePath)) {
    return fail(response, 404, 'not_found', 'Stored file no longer exists.');
  }

  response.download(file.absolutePath, file.originalFilename);
});

router.get('/deliveries/:token', (request, response) => {
  if (!request.params.token) {
    return fail(response, 404, 'not_found', 'Delivery token not found.');
  }

  return ok(response, {
    jobReference: 'SB-2026-000123',
    service: 'mastering',
    deliveryVersion: 1,
    expiresAt: '2026-04-26T12:00:00Z',
    files: [
      { id: crypto.randomUUID(), name: 'Track01_Master_24bit.wav', sizeBytes: 124567890 },
      { id: crypto.randomUUID(), name: 'Track02_Master_24bit.wav', sizeBytes: 118000210 }
    ],
    revisionAllowed: true,
    revisionAlreadyUsed: false
  });
});

router.post('/deliveries/:token/download', (request, response) => {
  if (!request.params.token) {
    return fail(response, 404, 'not_found', 'Delivery token not found.');
  }

  return ok(response, {
    ok: true,
    event: 'client_downloaded',
    download: {
      mode: 'signed-url',
      expiresInSeconds: 900,
      urls: [
        {
          fileId: crypto.randomUUID(),
          fileName: 'Track01_Master_24bit.wav',
          url: 'https://storage.example.com/signed-download-1'
        },
        {
          fileId: crypto.randomUUID(),
          fileName: 'Track02_Master_24bit.wav',
          url: 'https://storage.example.com/signed-download-2'
        }
      ]
    }
  });
});

router.post('/revisions/:token', (request, response) => {
  if (!request.params.token) {
    return fail(response, 404, 'not_found', 'Revision token not found.');
  }

  return ok(response, {
    ok: true,
    jobReference: 'SB-2026-000123',
    status: 'revision_requested',
    event: 'revision_requested'
  }, 201);
});

function getJobUploadDir(jobId) {
  return path.join(config.uploadDir, sanitizeSegment(jobId || 'unknown-job'));
}

function createSourceDownload(job) {
  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + (config.sourceDownloadLinkTtlHours * 60 * 60 * 1000)).toISOString();
  const pageUrl = `${config.appOrigin.replace(/\/$/, '')}/api/v1/public/source-downloads/${token}`;

  sourceDownloadTokens.set(token, {
    token,
    jobId: job.id,
    reference: job.reference,
    email: job.email,
    expiresAt,
    files: job.uploadedFiles.map((file) => ({
      id: crypto.randomUUID(),
      originalFilename: file.originalFilename,
      sizeBytes: file.sizeBytes,
      absolutePath: path.join(config.uploadDir, file.storageKey)
    }))
  });

  return {
    token,
    expiresAt,
    pageUrl
  };
}

function isExpired(value) {
  return Date.now() > new Date(value).getTime();
}

function sanitizeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9-_]/g, '') || 'upload';
}

function sumFileSizes(files) {
  return files.reduce((total, file) => total + Number(file.sizeBytes || 0), 0);
}

function removeUploadedFiles(files) {
  (files || []).forEach((file) => {
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
}

function handleUploadError(error, response) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return fail(response, 422, 'validation_error', 'A file exceeds the maximum allowed size.');
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return fail(response, 422, 'validation_error', `Unsupported file type. Allowed: ${allowedExtensions.join(', ')}.`);
    }
  }

  return fail(response, 500, 'upload_error', 'Unable to upload files right now.');
}

function renderSourceDownloadPage(sourceDownload) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Source Files - ${escapeHtml(sourceDownload.reference)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #101627; color: #f6f0f2; }
    main { max-width: 780px; margin: 0 auto; padding: 48px 20px 80px; }
    .card { background: #182038; border: 1px solid rgba(233,69,96,0.24); border-radius: 18px; padding: 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.28); }
    h1 { margin: 0 0 12px; font-size: 2rem; }
    p { color: rgba(246,240,242,0.78); line-height: 1.6; }
    ul { list-style: none; padding: 0; margin: 24px 0 0; }
    li { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 0; border-top: 1px solid rgba(255,255,255,0.08); }
    li:first-child { border-top: 0; }
    a { color: #ffd2da; text-decoration: none; font-weight: 700; }
    .meta { color: rgba(246,240,242,0.62); font-size: 0.95rem; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>Source files ready</h1>
      <p>Reference ${escapeHtml(sourceDownload.reference)}. This secure source download link is available until ${escapeHtml(formatDate(sourceDownload.expiresAt))}.</p>
      <ul>
        ${sourceDownload.files.map((file) => `
          <li>
            <div>
              <div>${escapeHtml(file.originalFilename)}</div>
              <div class="meta">${escapeHtml(formatBytes(file.sizeBytes))}</div>
            </div>
            <a href="/api/v1/public/source-downloads/${sourceDownload.token}/files/${file.id}">Download</a>
          </li>
        `).join('')}
      </ul>
    </section>
  </main>
</body>
</html>`;
}

function formatBytes(size) {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
