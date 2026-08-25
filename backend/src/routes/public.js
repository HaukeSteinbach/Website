/**
 * Everything a customer touches.
 *
 * Two things happen here: a customer sends their source files in, and a
 * customer collects a delivery. The second one now also carries the revision
 * request, on the same page, because the old arrangement had the revision form
 * on a separate page that the delivery email never linked to — so in practice
 * there was no way to ask for a change at all.
 */

import { randomUUID } from 'node:crypto';

import express from 'express';

import { config } from '../lib/config.js';
import { fail, ok } from '../lib/http.js';
import {
  sendRevisionRequestEmail,
  sendUploadReceivedEmail
} from '../lib/mail.js';
import {
  addEvent,
  createProject,
  findByDeliveryToken,
  getProject,
  updateProject
} from '../lib/projects.js';
import { getDownloadUrl, isStorageConfigured } from '../lib/storage.js';
import {
  ALLOWED_SOURCE_EXTENSIONS,
  describeUploadError,
  discardFiles,
  formatBytes,
  MAX_FILE_BYTES,
  MAX_FILES,
  revisionUpload,
  sourceUpload,
  toStoredFiles
} from '../lib/upload.js';
import { renderDeliveryPage, renderNoticePage } from '../views/delivery-page.js';

const router = express.Router();

/* Guard every route that needs the bucket, so a misconfigured server says so
   instead of accepting an upload it cannot keep. */
function requireStorage(_request, response, next) {
  if (!isStorageConfigured()) {
    return fail(response, 503, 'storage_not_configured',
      'File transfer is temporarily unavailable. Please email mail@haukesteinbach.de.');
  }

  return next();
}

/* --------------------------------------------------------------------------
   Customer sends files in
   -------------------------------------------------------------------------- */

router.get('/upload-limits', (_request, response) => ok(response, {
  maxFileSizeBytes: MAX_FILE_BYTES,
  maxFiles: MAX_FILES,
  allowedExtensions: ALLOWED_SOURCE_EXTENSIONS
}));

/**
 * One request: details plus files. The old flow needed three — create a job,
 * upload, then finalise — and a customer whose connection dropped between two
 * of them left a half-made job nobody ever saw.
 */
router.post('/projects', requireStorage, (request, response, next) => {
  /* The id is minted here rather than by createProject, because the storage
     keys need it while the files are still arriving — but the project itself
     is only written once the form turns out to be valid. Creating it first
     left a nameless empty project behind every time someone submitted an
     incomplete form. */
  const projectId = randomUUID();
  const upload = sourceUpload(() => projectId).array('files');

  upload(request, response, async (uploadError) => {
    if (uploadError) {
      const described = describeUploadError(uploadError);
      return fail(response, described.status, described.code, described.message);
    }

    const files = Array.isArray(request.files) ? request.files : [];

    try {
      const firstName = String(request.body?.firstName || '').trim();
      const lastName = String(request.body?.lastName || '').trim();
      const email = String(request.body?.email || '').trim().toLowerCase();
      const service = String(request.body?.service || 'other').trim();
      const consent = request.body?.privacyConsent;

      const missing = [];
      if (!firstName) missing.push('first name');
      if (!lastName) missing.push('last name');
      if (!isValidEmail(email)) missing.push('a valid email address');
      if (!consent || consent === 'false') missing.push('the privacy consent');
      if (!files.length) missing.push('at least one file');

      if (missing.length) {
        await discardFiles(files);
        return fail(response, 422, 'validation_error', `Please add ${missing.join(', ')}.`);
      }

      const project = await createProject({
        id: projectId,
        title: String(request.body?.title || '').trim() || `${firstName} ${lastName}`.trim(),
        service,
        clientName: `${firstName} ${lastName}`.trim(),
        clientEmail: email,
        notes: String(request.body?.projectNotes || '').trim(),
        address: readAddress(request.body),
        origin: 'client',
        sourceFiles: toStoredFiles(files),
        firstEvent: { type: 'files_received', detail: { files: files.length } }
      });

      const mail = await sendUploadReceivedEmail({ project });

      return ok(response, {
        ok: true,
        reference: project.reference,
        files: project.sourceFiles.map((file) => ({ name: file.name, size: file.size })),
        totalSize: project.sourceFiles.reduce((sum, file) => sum + file.size, 0),
        notification: mail
      }, 201);
  } catch (error) {
    await discardFiles(files);
    return next(error);
  }
  });
});

/* --------------------------------------------------------------------------
   Customer collects a delivery
   -------------------------------------------------------------------------- */

export const deliveryPageHandler = [requireStorage, async (request, response, next) => {
  try {
    const found = await findByDeliveryToken(request.params.token);

    if (!found) {
      return response.status(404).type('html').send(renderNoticePage({
        title: 'Link not found',
        message: 'This download link does not exist. Check that you copied the whole address from the email.'
      }));
    }

    if (isExpired(found.delivery.expiresAt)) {
      return response.status(410).type('html').send(renderNoticePage({
        title: 'Link expired',
        message: `This delivery was available until ${formatDate(found.delivery.expiresAt)}. Email mail@haukesteinbach.de and it will be sent again.`,
        reference: found.project.reference
      }));
    }

    return response.type('html').send(renderDeliveryPage({
      project: found.project,
      delivery: found.delivery,
      token: request.params.token
    }));
  } catch (error) {
    return next(error);
  }
}];

/**
 * Hands back a short-lived direct link rather than the bytes.
 *
 * A master can be several gigabytes; proxying that through this process would
 * tie up a worker for the length of the download for no benefit.
 */
router.get('/d/:token/files/:fileId', requireStorage, async (request, response, next) => {
  try {
    const found = await findByDeliveryToken(request.params.token);

    if (!found || isExpired(found.delivery.expiresAt)) {
      return fail(response, 404, 'not_found', 'This download link is no longer valid.');
    }

    const file = (found.delivery.files || []).find((entry) => entry.id === request.params.fileId);

    if (!file) {
      return fail(response, 404, 'not_found', 'File not found.');
    }

    /* Record the collection once, and tell the studio the first time. */
    let notifyFirst = false;
    await updateProject(found.project.id, (draft) => {
      const delivery = (draft.deliveries || []).find((entry) => entry.token === request.params.token);
      if (!delivery) return;

      delivery.downloadCount = (delivery.downloadCount || 0) + 1;

      if (!delivery.firstDownloadedAt) {
        delivery.firstDownloadedAt = new Date().toISOString();
        notifyFirst = true;
        addEvent(draft, 'downloaded', { version: delivery.version });
      }
    });

    if (notifyFirst) {
      const { sendDownloadNoticeEmail } = await import('../lib/mail.js');
      await sendDownloadNoticeEmail({ project: found.project, delivery: found.delivery });
    }

    return response.redirect(302, await getDownloadUrl(file.key, file.name));
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Customer asks for a change
   -------------------------------------------------------------------------- */

router.post('/d/:token/revisions', requireStorage, (request, response, next) => {
  const pending = { id: null };
  const upload = revisionUpload(() => pending.id).array('files');

  findByDeliveryToken(request.params.token)
    .then((found) => {
      if (!found) {
        return fail(response, 404, 'not_found', 'This link is no longer valid.');
      }

      if (isExpired(found.delivery.expiresAt)) {
        return fail(response, 410, 'expired', 'This delivery has expired. Please get in touch by email.');
      }

      pending.id = found.project.id;

      upload(request, response, async (uploadError) => {
      if (uploadError) {
        const described = describeUploadError(uploadError);
        return fail(response, described.status, described.code, described.message);
      }

      const files = Array.isArray(request.files) ? request.files : [];

      try {
        const message = String(request.body?.message || '').trim();

        if (message.length < 4) {
          await discardFiles(files);
          return fail(response, 422, 'validation_error', 'Please describe the change you would like.');
        }

        const { result } = await updateProject(found.project.id, (draft) => {
          const revision = {
            id: cryptoToken(),
            deliveryId: found.delivery.id,
            version: found.delivery.version,
            message,
            files: toStoredFiles(files),
            requestedAt: new Date().toISOString(),
            acknowledgedAt: null
          };

          draft.revisions = draft.revisions || [];
          draft.revisions.push(revision);
          draft.closed = false;
          addEvent(draft, 'revision_requested', { version: revision.version });

          return revision;
        });

        const mail = await sendRevisionRequestEmail({ project: found.project, revision: result });

        return ok(response, { ok: true, reference: found.project.reference, notification: mail }, 201);
      } catch (error) {
        await discardFiles(files);
        return next(error);
      }
    });
    })
    .catch(next);
});

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

function readAddress(body) {
  const street1 = String(body?.['address[street1]'] || body?.street1 || '').trim();

  if (!street1) {
    return null;
  }

  return {
    street1,
    street2: String(body?.['address[street2]'] || body?.street2 || '').trim(),
    postalCode: String(body?.['address[postalCode]'] || body?.postalCode || '').trim(),
    city: String(body?.['address[city]'] || body?.city || '').trim(),
    country: String(body?.['address[country]'] || body?.country || '').trim()
  };
}

function isExpired(value) {
  return Date.now() > new Date(value).getTime();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function cryptoToken() {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

function formatDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export { formatBytes };
export default router;
