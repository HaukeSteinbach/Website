/**
 * Object storage on Cloudflare R2, spoken to over the S3 API.
 *
 * Everything the file handoff produces lives here: the uploaded audio, the
 * delivered masters, and the project index itself. Nothing is written to the
 * container's own disk, so a deploy never takes a customer's download link
 * with it — which is exactly what used to happen when the state lived in a
 * Map in the process.
 */

import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { config } from './config.js';

let client = null;

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

/**
 * True when the bucket is configured. Every route checks this before it
 * promises a customer anything, so a half-configured server fails loudly at
 * the edge instead of losing an upload halfway through.
 */
export function isStorageConfigured() {
  return Boolean(config.s3Bucket && config.s3AccessKey && config.s3SecretKey && config.s3Endpoint);
}

/** The shared client, for lib-storage's streaming multipart upload. */
export function getS3Client() {
  return getClient();
}

function getClient() {
  if (!isStorageConfigured()) {
    throw new StorageError('Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY.');
  }

  if (!client) {
    client = new S3Client({
      /* R2 ignores the region but the SDK insists on one */
      region: config.s3Region || 'auto',
      endpoint: config.s3Endpoint,
      /* R2 addresses buckets as <endpoint>/<bucket>. Left to itself the SDK
         would build <bucket>.<endpoint>, which R2 does not answer. */
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey
      }
    });
  }

  return client;
}

/** One round trip to confirm the credentials work, used by /health. */
export async function checkStorage() {
  if (!isStorageConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  try {
    await getClient().send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
    return { ok: true, bucket: config.s3Bucket };
  } catch (error) {
    return { ok: false, reason: error.name || 'unreachable' };
  }
}

export async function putObject(key, body, { contentType, metadata, ifMatch, ifNoneMatch } = {}) {
  try {
    const result = await getClient().send(new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      Metadata: metadata,
      IfMatch: ifMatch,
      IfNoneMatch: ifNoneMatch
    }));

    return { etag: result.ETag };
  } catch (error) {
    /* the caller distinguishes a lost race from a real failure */
    if (isPreconditionFailure(error)) {
      const conflict = new StorageError('Object was modified by someone else.', error);
      conflict.code = 'precondition_failed';
      throw conflict;
    }

    throw new StorageError(`Could not write ${key}.`, error);
  }
}

export async function getObjectText(key) {
  try {
    const result = await getClient().send(new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key
    }));

    return {
      text: await result.Body.transformToString(),
      etag: result.ETag
    };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw new StorageError(`Could not read ${key}.`, error);
  }
}

/** Node stream for a stored object, used when the server proxies a download. */
export async function getObjectStream(key) {
  try {
    const result = await getClient().send(new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key
    }));

    const body = result.Body;

    return {
      stream: typeof body?.pipe === 'function' ? body : Readable.fromWeb(body.transformToWebStream()),
      contentLength: result.ContentLength,
      contentType: result.ContentType
    };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw new StorageError(`Could not read ${key}.`, error);
  }
}

/**
 * A short-lived direct link to the object.
 *
 * Large masters go straight from R2 to the customer instead of through this
 * container, which keeps a 3 GB download from occupying a Node process for
 * twenty minutes. The filename is forced so the browser saves it under the
 * name the customer expects rather than the storage key.
 */
export async function getDownloadUrl(key, filename, expiresInSeconds = 900) {
  const command = new GetObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`
  });

  try {
    return await getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
  } catch (error) {
    throw new StorageError(`Could not sign a download link for ${key}.`, error);
  }
}

export async function deleteObject(key) {
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }

    throw new StorageError(`Could not delete ${key}.`, error);
  }
}

function isNotFound(error) {
  return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error) {
  return error?.name === 'PreconditionFailed' || error?.$metadata?.httpStatusCode === 412;
}

/* R2 answers a failed If-None-Match with 409 rather than the 412 S3 uses. */
function isPreconditionFailure(error) {
  return isPreconditionFailed(error) || error?.$metadata?.httpStatusCode === 409;
}

/**
 * Content-Disposition is a header, so a quote or a newline in the filename
 * would let a caller inject one. Everything outside a conservative set is
 * replaced rather than escaped.
 */
function sanitizeFilename(value) {
  return String(value || 'download')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 180) || 'download';
}
