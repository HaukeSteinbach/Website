/**
 * npm run dev-seeded
 *
 * The real backend with the in-memory bucket and a couple of projects already
 * in it, for looking at the admin area and a delivery page without needing
 * Cloudflare credentials. Sign in with the password below.
 */
import { fileURLToPath } from 'node:url';

import { createMiniS3 } from './mini-s3.mjs';
import { scryptSync } from 'node:crypto';

const S3 = 9881, APP = 8392;
process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'devbucket';
process.env.S3_ACCESS_KEY = 'dev';
process.env.S3_SECRET_KEY = 'dev';
process.env.S3_REGION = 'auto';
process.env.SESSION_SECRET = 'd'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$devsalt$${scryptSync('dev-password-1234', 'devsalt', 64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`;
process.env.PUBLIC_DIR = fileURLToPath(new URL('../..', import.meta.url));
process.env.NODE_ENV = 'development';
process.env.SMTP_HOST = '';
process.env.FORMSPREE_UPLOAD_ENDPOINT = '';

await createMiniS3(S3);
const { default: app } = await import(new URL('../src/app.js', import.meta.url));

/* One project with a delivery and an open revision, so the admin area has
   something to show. */
const { createProject, updateProject } = await import(new URL('../src/lib/projects.js', import.meta.url));
const p = await createProject({
  title: 'Jette Julia — Two Songs', service: 'mixing',
  clientName: 'Jette Julia', clientEmail: 'jette@example.com',
  notes: 'Vocals could sit a little further forward.', origin: 'client',
  sourceFiles: [{ id: 'f1', key: 'k1', name: 'song-one-stems.zip', size: 1932735283, uploadedAt: new Date().toISOString() }],
  firstEvent: { type: 'files_received', detail: { files: 1 } }
});
await updateProject(p.id, (d) => {
  d.deliveries.push({ id: 'd1', version: 1, note: 'Brought the vocal forward and tightened the low end.',
    token: 'a'.repeat(32), files: [{ id: 'g1', key: 'k2', name: 'song-one-mix-v1.wav', size: 412335283 }],
    sentAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 86400000).toISOString(),
    firstDownloadedAt: new Date(Date.now() - 3600000).toISOString(), downloadCount: 2 });
  d.revisions.push({ id: 'r1', deliveryId: 'd1', version: 1,
    message: 'Could the chorus vocal come up another dB? Otherwise this is perfect.',
    files: [], requestedAt: new Date().toISOString(), acknowledgedAt: null });
  d.events.push({ type: 'delivered', at: new Date(Date.now() - 86400000).toISOString(), detail: { version: 1 } });
  d.events.push({ type: 'downloaded', at: new Date(Date.now() - 3600000).toISOString(), detail: { version: 1 } });
  d.events.push({ type: 'revision_requested', at: new Date().toISOString(), detail: { version: 1 } });
});
await createProject({ title: 'Sefa4k — System 7', service: 'mastering',
  clientName: 'Sefa4k', clientEmail: 'sefa@example.com', origin: 'admin' });

app.listen(APP, () => console.log('dev server on ' + APP));
