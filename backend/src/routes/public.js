import express from 'express';

import { ok, fail } from '../lib/http.js';
import { createPublicReference } from '../lib/reference.js';

const router = express.Router();

router.post('/jobs', (request, response) => {
  const { firstName, lastName, email, address, service, privacyConsent, policyVersion } = request.body;

  if (!firstName || !lastName || !email || !address?.street1 || !address?.postalCode || !address?.city || !address?.country || !service || !privacyConsent || !policyVersion) {
    return fail(response, 422, 'validation_error', 'One or more required fields are missing.');
  }

  return ok(response, {
    jobId: crypto.randomUUID(),
    reference: createPublicReference(),
    status: 'draft',
    upload: {
      provider: 'tus',
      endpoint: 'https://app.yourdomain.com/files/',
      maxFileSizeBytes: 21474836480,
      maxTotalSizeBytes: 107374182400,
      allowedExtensions: ['wav', 'aiff', 'flac', 'zip', 'rar', 'mp3']
    }
  }, 201);
});

router.post('/jobs/:jobId/uploads/complete', (request, response) => {
  const { uploadedFiles } = request.body;

  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    return fail(response, 422, 'validation_error', 'At least one uploaded file is required.');
  }

  return ok(response, {
    ok: true,
    jobId: request.params.jobId,
    reference: createPublicReference(),
    status: 'uploaded',
    event: 'uploaded'
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

export default router;
