import fs from 'fs';
import path from 'path';

import express from 'express';
import multer from 'multer';

import { config } from '../lib/config.js';
import { ok, fail } from '../lib/http.js';
import { createPublicReference } from '../lib/reference.js';

const router = express.Router();
const allowedExtensions = ['wav', 'aiff', 'flac', 'zip', 'rar', 'mp3'];
const maxFileSizeBytes = 21474836480;
const maxTotalSizeBytes = 107374182400;
const jobs = new Map();

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

router.post('/jobs/:jobId/uploads/complete', (request, response) => {
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

  return ok(response, {
    ok: true,
    jobId: request.params.jobId,
    reference: job.reference,
    status: 'uploaded',
    event: 'uploaded',
    uploadedFiles: job.uploadedFiles
  });
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

export default router;
