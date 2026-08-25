/**
 * The page a customer lands on from a delivery email.
 *
 * Rendered here rather than served as a static file because it has to be
 * addressed by token. It pulls the site's own stylesheet, so it looks like the
 * rest of steinbach.de instead of the hand-rolled dark card the old version
 * carried.
 *
 * The revision request sits on this page. Previously it lived on revision.html,
 * which the delivery email did not link to and which posted to Formspree, so a
 * request was never recorded against the delivery it belonged to.
 *
 * Note on escaping: every value interpolated below goes through escapeHtml.
 * Filenames and the studio's note are the parts that come from outside.
 */

const FONT_PRELOADS = ['archivo-black-400-latin', 'poppins-400-latin', 'jetbrains-mono-400-latin'];

function shell({ title, body, includeScript }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | Steinbach</title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/svg+xml" href="/assets/images/favicon.svg">
<link rel="stylesheet" href="/assets/css/steinbach.css">
${FONT_PRELOADS.map((name) => `<link rel="preload" href="/assets/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
</head>
<body>
<div class="rail" aria-hidden="true"></div>
<div class="wrap">
  <header class="bar">
    <a class="mark" href="/index.html">Steinbach</a>
  </header>
${body}
  <footer class="foot">
    <div class="foot-base mono">
      <span>&copy; 2025 Steinbach. All rights reserved.</span>
      <span><a href="/impressum.html">Legal notice</a> &middot; <a href="/datenschutz.html">Privacy policy</a></span>
    </div>
  </footer>
</div>
<script src="/assets/js/steinbach-ui.js"></script>
${includeScript ? '<script src="/assets/js/delivery-page.js"></script>' : ''}
</body>
</html>`;
}

export function renderDeliveryPage({ project, delivery, token }) {
  const files = delivery.files || [];
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const isRevised = delivery.version > 1;

  const body = `
  <header class="page-head">
    <p class="kicker">${escapeHtml(project.reference)}${isRevised ? ` &middot; Version ${delivery.version}` : ''}</p>
    <h1>Your files <br class="br-lg">are ready</h1>
    <p class="page-deck">${escapeHtml(project.title || 'Your project')} &mdash; ${files.length} file${files.length === 1 ? '' : 's'}, ${escapeHtml(formatBytes(totalSize))}. This link works until ${escapeHtml(formatDate(delivery.expiresAt))}.</p>
    <div class="page-head-rule" aria-hidden="true"></div>
  </header>

  <main class="handoff-layout">
    ${delivery.note ? `<section class="handoff-card">
      <h2>A note from the studio</h2>
      <p>${escapeHtml(delivery.note).replace(/\n/g, '<br>')}</p>
    </section>` : ''}

    <section class="handoff-card">
      <h2>Download</h2>
      <ul class="delivery-files">
        ${files.map((file) => `<li>
          <div>
            <span class="delivery-file-name">${escapeHtml(file.name)}</span>
            <span class="delivery-file-size mono">${escapeHtml(formatBytes(file.size))}</span>
          </div>
          <a class="btn fill" href="/api/v1/public/d/${escapeHtml(token)}/files/${escapeHtml(file.id)}">Download</a>
        </li>`).join('')}
      </ul>
      <p class="delivery-hint mono">Files are served straight from storage, so large downloads resume if your connection drops.</p>
    </section>

    <section class="handoff-card" id="revision">
      <h2>Need a change?</h2>
      <p>Describe what you would like adjusted and it goes straight to the studio, attached to this delivery. You can add a reference file if that helps.</p>

      <form class="handoff-form" id="revision-form" data-endpoint="/api/v1/public/d/${escapeHtml(token)}/revisions">
        <div class="handoff-fieldset">
          <div class="form-group">
            <label for="revision-message">What should change?</label>
            <textarea id="revision-message" name="message" rows="5" required
              placeholder="The vocal could sit a little further forward in the chorus..."></textarea>
          </div>
        </div>

        <div class="handoff-fieldset">
          <div class="form-group">
            <label for="revision-files">Reference file (optional)</label>
            <input type="file" id="revision-files" name="files" multiple
              accept=".txt,.pdf,.zip,.wav,.mp3,.png,.jpg,.jpeg">
          </div>
        </div>

        <div class="handoff-actions">
          <button type="submit" class="btn fill" id="revision-submit">Send request</button>
        </div>
      </form>
      <!-- outside the form: the form is replaced on success, and a status
           inside it would be removed together with what it is reporting on -->
      <div class="handoff-status" id="revision-status" role="status" aria-live="polite"></div>
    </section>
  </main>`;

  return shell({ title: 'Your files are ready', body, includeScript: true });
}

export function renderNoticePage({ title, message, reference }) {
  const body = `
  <header class="page-head">
    ${reference ? `<p class="kicker">${escapeHtml(reference)}</p>` : ''}
    <h1>${escapeHtml(title)}</h1>
    <p class="page-deck">${escapeHtml(message)}</p>
    <div class="page-head-rule" aria-hidden="true"></div>
  </header>
  <main class="handoff-layout">
    <section class="handoff-card">
      <p>Write to <a href="mailto:mail@haukesteinbach.de">mail@haukesteinbach.de</a> and you will get a fresh link.</p>
    </section>
  </main>`;

  return shell({ title, body, includeScript: false });
}

function formatBytes(size) {
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

function formatDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
