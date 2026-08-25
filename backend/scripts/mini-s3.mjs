/**
 * A minimal S3-compatible server, in memory, for exercising the real
 * storage.js and the real project logic without touching Cloudflare.
 *
 * Implements only what this codebase uses: PUT/GET/HEAD/DELETE on a single
 * object, plus If-Match and If-None-Match so the ETag retry can be tested.
 * Signatures are not verified — this never leaves localhost.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';

const objects = new Map();   // key -> { body: Buffer, etag, contentType }

function etagFor(buffer) {
  return `"${createHash('md5').update(buffer).digest('hex')}"`;
}

export function createMiniS3(port) {
  const server = http.createServer((req, res) => {
    if (process.env.MINI_S3_LOG) console.log('  <-', req.method, req.url);
    const url = new URL(req.url, 'http://localhost');
    /* /<bucket>/<key...> */
    const parts = url.pathname.replace(/^\//, '').split('/');
    const key = decodeURIComponent(parts.slice(1).join('/'));

    /* HeadBucket arrives as HEAD /<bucket>/ — an empty key, not a missing one */
    if (req.method === 'HEAD' && !key) {
      res.writeHead(200).end();                       // HeadBucket
      return;
    }

    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const existing = objects.get(key);
        const ifMatch = req.headers['if-match'];
        const ifNoneMatch = req.headers['if-none-match'];

        if (ifMatch && (!existing || existing.etag !== ifMatch)) {
          res.writeHead(412).end('<Error><Code>PreconditionFailed</Code></Error>');
          return;
        }

        if (ifNoneMatch === '*' && existing) {
          res.writeHead(412).end('<Error><Code>PreconditionFailed</Code></Error>');
          return;
        }

        const body = Buffer.concat(chunks);
        const etag = etagFor(body);
        objects.set(key, { body, etag, contentType: req.headers['content-type'] });
        res.writeHead(200, { ETag: etag }).end();
      });
      return;
    }

    if (req.method === 'GET') {
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      res.writeHead(200, {
        ETag: object.etag,
        'Content-Type': object.contentType || 'application/octet-stream',
        'Content-Length': object.body.length
      }).end(object.body);
      return;
    }

    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }

    res.writeHead(400).end();
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, objects }));
  });
}
