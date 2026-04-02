import fs from 'fs';
import path from 'path';

import express from 'express';
import multer from 'multer';

import { fail, ok } from '../lib/http.js';
import {
  ReleasePageError,
  createReleasePage,
  ensureReleasePageStorage,
  getReleaseArtworkBySlug,
  getReleaseIncomingDir,
  getReleasePageBySlug,
  isReleaseSlug,
  renderReleasePage
} from '../lib/release-pages.js';

const router = express.Router();
const allowedArtworkExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const maxArtworkSizeBytes = 15 * 1024 * 1024;

ensureReleasePageStorage();

const artworkUpload = multer({
  dest: getReleaseIncomingDir(),
  limits: {
    fileSize: maxArtworkSizeBytes,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (!allowedArtworkExtensions.has(extension)) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }

    callback(null, true);
  }
});

router.post('/api/v1/public/release-pages', (request, response) => {
  artworkUpload.single('artwork')(request, response, async (error) => {
    if (error) {
      removeTemporaryFile(request.file);
      return handleArtworkUploadError(error, response);
    }

    if (!request.file) {
      return fail(response, 422, 'validation_error', 'Artwork upload is required.');
    }

    try {
      const releasePage = await createReleasePage({
        sourceUrl: request.body?.sourceUrl,
        titleOverride: request.body?.titleOverride,
        artistOverride: request.body?.artistOverride,
        slugOverride: request.body?.slugOverride,
        artworkFile: request.file
      });

      return ok(response, {
        ok: true,
        releasePage: {
          slug: releasePage.slug,
          path: releasePage.path,
          pageUrl: buildAbsoluteUrl(request, releasePage.path),
          artworkUrl: buildAbsoluteUrl(request, `/release-artwork/${releasePage.slug}`),
          title: releasePage.title,
          artist: releasePage.artist,
          description: releasePage.description,
          services: releasePage.services,
          createdAt: releasePage.createdAt,
          sourceUrl: releasePage.sourceUrl
        }
      }, 201);
    } catch (requestError) {
      removeTemporaryFile(request.file);

      if (requestError instanceof ReleasePageError) {
        return fail(response, requestError.statusCode, requestError.code, requestError.message);
      }

      return fail(response, 500, 'release_page_error', 'Unable to create the release page right now.');
    }
  });
});

router.get('/release-artwork/:slug', (request, response, next) => {
  if (!isReleaseSlug(request.params.slug)) {
    next();
    return;
  }

  const artwork = getReleaseArtworkBySlug(request.params.slug);

  if (!artwork) {
    next();
    return;
  }

  response.setHeader('Content-Type', artwork.mimeType);
  response.sendFile(artwork.absolutePath);
});

router.get('/:slug', (request, response, next) => {
  if (!isReleaseSlug(request.params.slug)) {
    next();
    return;
  }

  const releasePage = getReleasePageBySlug(request.params.slug);

  if (!releasePage) {
    next();
    return;
  }

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.send(renderReleasePage(releasePage, buildAbsoluteUrl(request, releasePage.path)));
});

function buildAbsoluteUrl(request, pathname) {
  const forwardedProtocol = request.get('x-forwarded-proto');
  const forwardedHost = request.get('x-forwarded-host');
  const protocol = forwardedProtocol ? forwardedProtocol.split(',')[0].trim() : request.protocol;
  const host = forwardedHost ? forwardedHost.split(',')[0].trim() : request.get('host');

  return `${protocol}://${host}${pathname}`;
}

function removeTemporaryFile(file) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

function handleArtworkUploadError(error, response) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return fail(response, 422, 'validation_error', 'Artwork exceeds the 15 MB upload limit.');
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return fail(response, 422, 'validation_error', 'Artwork must be a JPG, PNG, or WebP image.');
    }
  }

  return fail(response, 500, 'upload_error', 'Unable to upload artwork right now.');
}

export default router;