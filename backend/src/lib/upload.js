/**
 * Multer storage that streams straight into R2.
 *
 * The obvious route — multer's disk storage, then upload the finished file —
 * needs the whole thing on the container's disk first. A session of stems is
 * several gigabytes, and that disk is a Docker volume on a machine that has
 * run out of space before. So each file goes to R2 as it arrives and never
 * touches local storage.
 *
 * lib-storage handles the multipart split, which S3 requires above 5 GB and
 * which also means a stalled part is retried rather than the whole upload.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Upload } from '@aws-sdk/lib-storage';
import multer from 'multer';

import { config } from './config.js';
import { fileKey } from './projects.js';
import { deleteObject, getS3Client } from './storage.js';

export const ALLOWED_SOURCE_EXTENSIONS = ['wav', 'aiff', 'aif', 'flac', 'zip', 'rar', 'mp3', 'm4a', 'pdf'];
export const ALLOWED_REVISION_EXTENSIONS = ['txt', 'pdf', 'zip', 'wav', 'mp3', 'png', 'jpg', 'jpeg'];

export const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;   /* 10 GB */
export const MAX_FILES = 25;
export const MAX_REVISION_FILE_BYTES = 100 * 1024 * 1024;

/**
 * @param {object} options
 * @param {(req) => string} options.projectId  where the file belongs
 * @param {string} options.kind                'source' | 'delivery' | 'revision'
 */
function r2Storage({ projectId, kind }) {
  return {
    _handleFile(request, file, callback) {
      const id = randomUUID();
      const key = fileKey(projectId(request), kind, id, file.originalname);

      const upload = new Upload({
        client: getS3Client(),
        params: {
          Bucket: config.s3Bucket,
          Key: key,
          Body: file.stream,
          ContentType: file.mimetype || 'application/octet-stream'
        },
        queueSize: 4,
        partSize: 16 * 1024 * 1024
      });

      let uploaded = 0;
      upload.on('httpUploadProgress', (progress) => {
        uploaded = progress.loaded || uploaded;
      });

      upload.done()
        .then(() => callback(null, { id, key, size: uploaded }))
        .catch((error) => callback(error));
    },

    /* multer calls this for files that arrive after a rejection */
    _removeFile(_request, file, callback) {
      if (!file.key) {
        callback(null);
        return;
      }

      deleteObject(file.key).then(() => callback(null), callback);
    }
  };
}

function extensionFilter(allowed) {
  return (_request, file, callback) => {
    const extension = path.extname(file.originalname || '').slice(1).toLowerCase();

    if (!allowed.includes(extension)) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }

    callback(null, true);
  };
}

/**
 * Die alten Rechnungs-PDFs aus dem Finanzamtsordner.
 *
 * Anders als die Projektdateien laufen die durch den Arbeitsspeicher statt
 * direkt in den Bucket: sie sind klein, und der Ablageort haengt an der
 * Rechnungsnummer im Dateinamen, die erst nach dem Einlesen feststeht. Ein
 * fester Schluessel je Nummer heisst ausserdem, dass ein zweiter Durchlauf
 * ueberschreibt statt zu verdoppeln.
 */
export function legacyInvoiceUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 200 },
    fileFilter: extensionFilter(['pdf'])
  });
}

export function sourceUpload(projectId) {
  return multer({
    storage: r2Storage({ projectId, kind: 'source' }),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter: extensionFilter(ALLOWED_SOURCE_EXTENSIONS)
  });
}

export function deliveryUpload(projectId) {
  return multer({
    storage: r2Storage({ projectId, kind: 'delivery' }),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter: extensionFilter(ALLOWED_SOURCE_EXTENSIONS)
  });
}

export function revisionUpload(projectId) {
  return multer({
    storage: r2Storage({ projectId, kind: 'revision' }),
    limits: { fileSize: MAX_REVISION_FILE_BYTES, files: 5 },
    fileFilter: extensionFilter(ALLOWED_REVISION_EXTENSIONS)
  });
}

/** Shape multer's files into what a project stores. */
export function toStoredFiles(files) {
  return (files || []).map((file) => ({
    id: file.id,
    key: file.key,
    name: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size || 0,
    uploadedAt: new Date().toISOString()
  }));
}

/** Remove already-uploaded objects when a request fails after the upload. */
export async function discardFiles(files) {
  await Promise.allSettled((files || []).map((file) => file.key && deleteObject(file.key)));
}

export function describeUploadError(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return { status: 422, code: 'file_too_large', message: `A file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit.` };
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return { status: 422, code: 'file_type_rejected', message: `That file type is not accepted. Allowed: ${ALLOWED_SOURCE_EXTENSIONS.join(', ')}.` };
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return { status: 422, code: 'too_many_files', message: `Up to ${MAX_FILES} files per upload.` };
    }
  }

  return { status: 500, code: 'upload_failed', message: 'The upload did not finish. Nothing was saved — please try again.' };
}

export function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}
