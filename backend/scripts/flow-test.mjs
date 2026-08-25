/**
 * npm run flow-test
 *
 * Walks the whole handoff against the real backend: a customer uploads, the
 * studio signs in and delivers, the customer downloads and asks for a change,
 * the studio sees it. Storage is the in-memory S3 above; everything else is
 * the production code.
 */
import assert from 'node:assert/strict';

import { createMiniS3 } from './mini-s3.mjs';

const PORT = 9871;
const APP_PORT = 9872;

process.env.S3_ENDPOINT = `http://127.0.0.1:${PORT}`;
process.env.S3_BUCKET = 'testbucket';
process.env.S3_ACCESS_KEY = 'test';
process.env.S3_SECRET_KEY = 'test';
process.env.S3_REGION = 'auto';
process.env.SESSION_SECRET = 'a'.repeat(48);
process.env.APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = '';              // no mail server: the honest path
process.env.FORMSPREE_UPLOAD_ENDPOINT = '';

/* config.js snapshots process.env at import time, so the hash has to exist
   before any of the app's modules are loaded. Built here with the same scrypt
   parameters auth.js uses rather than by importing it. */
const { scryptSync } = await import('node:crypto');
const PASSWORD = 'correct horse battery staple';
process.env.ADMIN_PASSWORD_HASH = `scrypt$testsalt$${scryptSync(PASSWORD, 'testsalt', 64).toString('hex')}`;

const { objects } = await createMiniS3(PORT);
const { default: app } = await import(new URL('../src/app.js', import.meta.url));

const server = app.listen(APP_PORT);
const base = `http://127.0.0.1:${APP_PORT}`;

let cookie = '';
const pass = [];
const fail = [];

function check(name, fn) {
  try { fn(); pass.push(name); }
  catch (error) { fail.push(`${name}: ${error.message}`); }
}

async function call(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(base + path, { ...options, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json() : await response.text();
  return { status: response.status, payload, headers: response.headers };
}

function fileBlob(name, text) {
  return [new Blob([text], { type: 'audio/wav' }), name];
}

try {
  /* ---------------------------------------------------------- health ---- */
  const health = await call('/health');
  check('health reports storage reachable', () => {
    assert.equal(health.status, 200);
    assert.equal(health.payload.storage.ok, true);
    assert.equal(health.payload.admin, 'configured');
  });

  /* ------------------------------------------------- admin is closed ---- */
  const closed = await call('/api/v1/admin/projects');
  check('project list refuses without a session', () => assert.equal(closed.status, 401));

  const headerTrick = await call('/api/v1/admin/projects', { headers: { 'x-admin-demo': 'true' } });
  check('the old demo header no longer opens anything', () => assert.equal(headerTrick.status, 401));

  const wrongPassword = await call('/api/v1/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'guess' })
  });
  check('wrong password is rejected', () => assert.equal(wrongPassword.status, 401));

  /* ------------------------------------------- customer sends files ----- */
  const uploadForm = new FormData();
  uploadForm.append('firstName', 'Jette');
  uploadForm.append('lastName', 'Julia');
  uploadForm.append('email', 'jette@example.com');
  uploadForm.append('service', 'mixing');
  uploadForm.append('projectNotes', 'Two songs, vocals a bit shy.');
  uploadForm.append('privacyConsent', 'on');
  uploadForm.append('files', ...fileBlob('song-one-stems.wav', 'x'.repeat(2048)));
  uploadForm.append('files', ...fileBlob('song-two-stems.wav', 'y'.repeat(1024)));

  const upload = await call('/api/v1/public/projects', { method: 'POST', body: uploadForm });
  check('customer upload succeeds in one request', () => {
    assert.equal(upload.status, 201);
    assert.match(upload.payload.reference, /^SB-\d{4}-\d{4}$/);
    assert.equal(upload.payload.files.length, 2);
  });

  const incomplete = new FormData();
  incomplete.append('firstName', 'No');
  incomplete.append('files', ...fileBlob('a.wav', 'z'));
  const rejected = await call('/api/v1/public/projects', { method: 'POST', body: incomplete });
  check('an incomplete upload is refused and says what is missing', () => {
    assert.equal(rejected.status, 422);
    assert.match(rejected.payload.message, /last name|email|consent/i);
  });

  /* ------------------------------------------------- studio signs in ---- */
  const login = await call('/api/v1/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  check('correct password signs in', () => assert.equal(login.status, 200));

  const list = await call('/api/v1/admin/projects');
  check('the upload appears in the project list', () => {
    assert.equal(list.status, 200);
    assert.equal(list.payload.projects.length, 1);
    assert.equal(list.payload.projects[0].client.name, 'Jette Julia');
    assert.equal(list.payload.projects[0].status, 'in_progress');
    assert.equal(list.payload.projects[0].sourceFileCount, 2);
  });

  const projectId = list.payload.projects[0].id;

  const detail = await call(`/api/v1/admin/projects/${projectId}`);
  check('detail carries the source files and the note', () => {
    assert.equal(detail.payload.project.sourceFiles.length, 2);
    assert.match(detail.payload.project.notes, /vocals a bit shy/);
  });

  const sourceLink = await call(`/api/v1/admin/projects/${projectId}/files/${detail.payload.project.sourceFiles[0].id}`);
  check('a source file can be downloaded', () => {
    assert.equal(sourceLink.status, 200);
    assert.match(sourceLink.payload.url, /^http/);
  });

  /* --------------------------------------------------- studio delivers -- */
  const deliverForm = new FormData();
  deliverForm.append('note', 'Brought the vocal forward.');
  deliverForm.append('files', ...fileBlob('song-one-mix-v1.wav', 'm'.repeat(4096)));

  const delivered = await call(`/api/v1/admin/projects/${projectId}/deliveries`, {
    method: 'POST', body: deliverForm
  });
  check('delivery is created', () => {
    assert.equal(delivered.status, 201);
    assert.equal(delivered.payload.delivery.version, 1);
    assert.match(delivered.payload.delivery.pageUrl, /\/d\/[a-f0-9]{32}$/);
  });
  check('with no mail server it says so instead of pretending', () => {
    assert.equal(delivered.payload.notification.sent, false);
    assert.equal(delivered.payload.notification.reason, 'smtp_not_configured');
  });

  const token = delivered.payload.delivery.pageUrl.split('/d/')[1];

  /* ------------------------------------------- customer opens the page -- */
  const page = await call(`/d/${token}`);
  check('the delivery page renders for the customer', () => {
    assert.equal(page.status, 200);
    assert.match(page.payload, /Your files/);
    assert.match(page.payload, /song-one-mix-v1\.wav/);
    assert.match(page.payload, /Brought the vocal forward/);
  });
  check('the revision form is on that same page', () => {
    assert.match(page.payload, /id="revision-form"/);
    assert.match(page.payload, /revisions"/);
  });
  check('the page uses the site stylesheet, not its own', () => {
    assert.match(page.payload, /assets\/css\/steinbach\.css/);
  });

  const badToken = await call('/d/' + 'f'.repeat(32));
  check('an unknown token gets a plain explanation, not a stack trace', () => {
    assert.equal(badToken.status, 404);
    assert.match(badToken.payload, /Link not found/);
  });

  /* ------------------------------------------------ customer downloads -- */
  const fileId = delivered.payload.project.deliveries[0].files[0].id;
  const download = await call(`/api/v1/public/d/${token}/files/${fileId}`);
  check('download redirects to a signed storage link', () => {
    assert.equal(download.status, 302);
    assert.match(download.headers.get('location'), /X-Amz-Signature/);
  });

  const afterDownload = await call(`/api/v1/admin/projects/${projectId}`);
  check('the collection is recorded', () => {
    assert.equal(afterDownload.payload.project.deliveries[0].downloadCount, 1);
    assert.ok(afterDownload.payload.project.deliveries[0].firstDownloadedAt);
    assert.equal(afterDownload.payload.project.status, 'delivered');
  });

  /* ------------------------------------------ customer asks for change -- */
  const revisionForm = new FormData();
  revisionForm.append('message', 'Could the chorus vocal come up another dB?');
  const revision = await call(`/api/v1/public/d/${token}/revisions`, { method: 'POST', body: revisionForm });
  check('revision request is accepted', () => assert.equal(revision.status, 201));

  const empty = new FormData();
  empty.append('message', 'hm');
  const tooShort = await call(`/api/v1/public/d/${token}/revisions`, { method: 'POST', body: empty });
  check('an empty revision is refused', () => assert.equal(tooShort.status, 422));

  const afterRevision = await call(`/api/v1/admin/projects/${projectId}`);
  check('the project now shows the change as outstanding', () => {
    assert.equal(afterRevision.payload.project.status, 'revision_requested');
    assert.equal(afterRevision.payload.project.openRevisionCount, 1);
    assert.match(afterRevision.payload.project.revisions[0].message, /another dB/);
  });

  /* ------------------------------------------------ studio delivers v2 -- */
  const v2Form = new FormData();
  v2Form.append('files', ...fileBlob('song-one-mix-v2.wav', 'n'.repeat(4096)));
  const v2 = await call(`/api/v1/admin/projects/${projectId}/deliveries`, { method: 'POST', body: v2Form });
  check('the second delivery is version 2', () => assert.equal(v2.payload.delivery.version, 2));

  const afterV2 = await call(`/api/v1/admin/projects/${projectId}`);
  check('delivering answers the revision — status clears by itself', () => {
    assert.equal(afterV2.payload.project.status, 'delivered');
    assert.equal(afterV2.payload.project.openRevisionCount, 0);
    assert.equal(afterV2.payload.project.revisionCount, 1);
    assert.equal(afterV2.payload.project.currentVersion, 2);
  });

  /* -------------------------------------------------- closing the job --- */
  const done = await call(`/api/v1/admin/projects/${projectId}/close`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closed: true })
  });
  check('a project can be marked done', () => assert.equal(done.payload.project.status, 'done'));

  /* ---------------------------------------------------- retired pages --- */
  for (const [from, to] of [['/send-files.html', '/admin.html'], ['/revision.html', '/contact.html']]) {
    const redirect = await call(from);
    check(`${from} redirects to ${to}`, () => {
      assert.equal(redirect.status, 301);
      assert.equal(redirect.headers.get('location'), to);
    });
  }

  /* ------------------------------------------------------- persistence -- */
  check('everything lives in the bucket, nothing on disk', () => {
    const keys = [...objects.keys()];
    assert.ok(keys.includes('projects/index.json'));
    assert.ok(keys.some((k) => k.includes('/source/')));
    assert.ok(keys.some((k) => k.includes('/delivery/')));
  });

  check('the index survives a restart because it is just an object', () => {
    const index = JSON.parse(objects.get('projects/index.json').body.toString());
    assert.equal(index.projects.length, 1);
    assert.equal(index.projects[0].deliveries.length, 2);
  });

  /* ---------------------------------------------------------- sign out -- */
  await call('/api/v1/admin/auth/logout', { method: 'POST' });
  cookie = '';
  const afterLogout = await call('/api/v1/admin/projects');
  check('signing out closes the door again', () => assert.equal(afterLogout.status, 401));

} catch (error) {
  fail.push('the run itself threw: ' + error.stack);
} finally {
  server.close();

  console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
  pass.forEach((name) => console.log('  ok   ' + name));
  fail.forEach((name) => console.log('  FAIL ' + name));

  process.exit(fail.length ? 1 : 0);
}
