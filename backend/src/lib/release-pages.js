import fs from 'fs';
import path from 'path';

import { config } from './config.js';

const releasePagesDir = path.join(config.uploadDir, 'release-pages');
const releaseArtworkDir = path.join(releasePagesDir, 'artwork');
const releaseIncomingDir = path.join(releasePagesDir, 'incoming');
const releaseIndexFile = path.join(releasePagesDir, 'pages.json');
const releaseSlugPrefix = 'listen-to';

const serviceLabelMap = {
  amazonmusic: 'Amazon Music',
  applemusic: 'Apple Music',
  deezer: 'Deezer',
  itunes: 'iTunes',
  qobuz: 'Qobuz',
  qobuzdownload: 'Qobuz Download',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  tidal: 'Tidal',
  youtubemusic: 'YouTube Music'
};

export class ReleasePageError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ReleasePageError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function ensureReleasePageStorage() {
  fs.mkdirSync(releaseArtworkDir, { recursive: true });
  fs.mkdirSync(releaseIncomingDir, { recursive: true });

  if (!fs.existsSync(releaseIndexFile)) {
    fs.writeFileSync(releaseIndexFile, JSON.stringify({ pages: [] }, null, 2));
  }
}

export function getReleaseIncomingDir() {
  ensureReleasePageStorage();
  return releaseIncomingDir;
}

export function isReleaseSlug(value) {
  return new RegExp(`^${releaseSlugPrefix}-[a-z0-9-]+$`).test(String(value || ''));
}

export function getReleasePageBySlug(slug) {
  const index = readReleasePageIndex();
  return index.pages.find((page) => page.slug === slug) || null;
}

export function getReleaseArtworkBySlug(slug) {
  const releasePage = getReleasePageBySlug(slug);

  if (!releasePage || !releasePage.artwork?.storedFilename) {
    return null;
  }

  const absolutePath = path.join(releaseArtworkDir, releasePage.artwork.storedFilename);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return {
    absolutePath,
    mimeType: releasePage.artwork.mimeType || 'application/octet-stream',
    originalFilename: releasePage.artwork.originalFilename || releasePage.artwork.storedFilename
  };
}

export async function createReleasePage(input) {
  ensureReleasePageStorage();

  const sourceUrl = validateSourceUrl(input.sourceUrl);
  const extracted = await extractReleaseMetadata(sourceUrl);
  const title = String(input.titleOverride || extracted.title || '').trim();
  const artist = String(input.artistOverride || extracted.artist || '').trim();

  if (!title) {
    throw new ReleasePageError(422, 'validation_error', 'Could not determine a release title from the provided link.');
  }

  if (!artist) {
    throw new ReleasePageError(422, 'validation_error', 'Could not determine an artist name from the provided link.');
  }

  if (!input.artworkFile?.path) {
    throw new ReleasePageError(422, 'validation_error', 'Artwork upload is required.');
  }

  if (!Array.isArray(extracted.services) || extracted.services.length === 0) {
    throw new ReleasePageError(422, 'validation_error', 'No platform links could be extracted from the provided Music Hub page.');
  }

  const slug = createUniqueReleaseSlug(input.slugOverride || title);
  const artworkExtension = normalizeArtworkExtension(input.artworkFile.originalname, input.artworkFile.mimetype);
  const artworkFilename = `${slug}${artworkExtension}`;
  const artworkDestination = path.join(releaseArtworkDir, artworkFilename);

  fs.renameSync(input.artworkFile.path, artworkDestination);

  const releasePage = {
    id: crypto.randomUUID(),
    slug,
    path: `/${slug}`,
    sourceUrl,
    title,
    artist,
    description: buildReleaseDescription(extracted.description, title, artist),
    artwork: {
      storedFilename: artworkFilename,
      originalFilename: input.artworkFile.originalname || artworkFilename,
      mimeType: input.artworkFile.mimetype || 'application/octet-stream'
    },
    services: extracted.services,
    createdAt: new Date().toISOString(),
    sourceMetadata: {
      originalTitle: extracted.originalTitle,
      canonicalUrl: extracted.canonicalUrl || sourceUrl
    }
  };

  const index = readReleasePageIndex();
  index.pages = index.pages.filter((page) => page.slug !== releasePage.slug);
  index.pages.push(releasePage);
  writeReleasePageIndex(index);

  return releasePage;
}

export function renderReleasePage(releasePage, pageUrl) {
  const pageTitle = `Listen to ${releasePage.title}`;
  const metaDescription = releasePage.description || `Listen to ${releasePage.title} by ${releasePage.artist}.`;
  const artworkUrl = `/release-artwork/${encodeURIComponent(releasePage.slug)}`;
  const artworkAbsoluteUrl = new URL(artworkUrl, pageUrl).toString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)} | Steinbach</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${escapeHtml(artworkAbsoluteUrl)}">
  <meta property="og:type" content="music.album">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <style>
    :root {
      color-scheme: dark;
      --page-bg: #09111d;
      --page-bg-alt: #101c2f;
      --card-bg: rgba(11, 20, 35, 0.84);
      --card-border: rgba(103, 216, 255, 0.16);
      --accent: #ff6a3d;
      --accent-soft: rgba(255, 106, 61, 0.16);
      --text-main: #f8fafc;
      --text-muted: rgba(230, 238, 247, 0.76);
      --shadow: 0 34px 90px rgba(0, 0, 0, 0.38);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text-main);
      background:
        radial-gradient(circle at top left, rgba(255, 106, 61, 0.22), transparent 30%),
        radial-gradient(circle at 85% 20%, rgba(103, 216, 255, 0.18), transparent 28%),
        linear-gradient(180deg, var(--page-bg), var(--page-bg-alt));
    }

    .release-shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 40px 0 64px;
    }

    .release-card {
      position: relative;
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(280px, 390px) minmax(0, 1fr);
      gap: 34px;
      padding: 28px;
      border: 1px solid var(--card-border);
      border-radius: 30px;
      background:
        linear-gradient(160deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.015)),
        var(--card-bg);
      box-shadow: var(--shadow);
      backdrop-filter: blur(22px);
    }

    .release-card::before {
      content: "";
      position: absolute;
      inset: 12px;
      border-radius: 22px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      pointer-events: none;
    }

    .release-artwork {
      position: relative;
      z-index: 1;
      aspect-ratio: 1;
      border-radius: 24px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.04);
      box-shadow: 0 26px 54px rgba(0, 0, 0, 0.28);
    }

    .release-artwork img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .release-copy {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .release-kicker {
      margin: 0 0 14px;
      color: rgba(255, 255, 255, 0.62);
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.7rem, 6vw, 4.9rem);
      line-height: 0.96;
      letter-spacing: -0.06em;
      text-wrap: balance;
    }

    .release-artist {
      margin: 14px 0 0;
      color: var(--text-muted);
      font-size: 1.12rem;
      line-height: 1.6;
    }

    .release-description {
      max-width: 46ch;
      margin: 20px 0 0;
      color: var(--text-muted);
      font-size: 1rem;
      line-height: 1.75;
    }

    .release-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 30px;
    }

    .release-link {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 108px;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-main);
      text-decoration: none;
      transition: transform 0.22s ease, border-color 0.22s ease, background 0.22s ease;
    }

    .release-link:hover {
      transform: translateY(-4px);
      border-color: rgba(255, 106, 61, 0.48);
      background: rgba(255, 106, 61, 0.1);
    }

    .release-link-label {
      font-size: 1rem;
      font-weight: 700;
    }

    .release-link-meta {
      color: rgba(255, 255, 255, 0.56);
      font-size: 0.78rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .release-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      align-items: center;
      justify-content: space-between;
      margin-top: 18px;
      color: rgba(255, 255, 255, 0.52);
      font-size: 0.85rem;
    }

    .release-note {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: #ffd8cc;
    }

    @media (max-width: 820px) {
      .release-shell {
        width: min(100%, calc(100% - 22px));
        padding-top: 22px;
      }

      .release-card {
        grid-template-columns: 1fr;
        gap: 22px;
        padding: 18px;
        border-radius: 24px;
      }

      .release-card::before {
        inset: 8px;
        border-radius: 18px;
      }

      .release-artwork {
        max-width: 420px;
      }
    }
  </style>
</head>
<body>
  <main class="release-shell">
    <section class="release-card">
      <figure class="release-artwork">
        <img src="${escapeHtml(artworkUrl)}" alt="Artwork for ${escapeHtml(releasePage.title)} by ${escapeHtml(releasePage.artist)}">
      </figure>
      <div class="release-copy">
        <p class="release-kicker">${escapeHtml(releasePage.slug)}</p>
        <h1>${escapeHtml(pageTitle)}</h1>
        <p class="release-artist">${escapeHtml(releasePage.artist)}</p>
        <p class="release-description">${escapeHtml(metaDescription)}</p>
        <div class="release-grid">
          ${releasePage.services.map((service) => `
            <a class="release-link" href="${escapeHtml(service.url)}" target="_blank" rel="noopener noreferrer">
              <span class="release-link-meta">${escapeHtml(service.type)}</span>
              <span class="release-link-label">${escapeHtml(service.label)}</span>
            </a>
          `).join('')}
        </div>
        <div class="release-footer">
          <span class="release-note">Choose your platform and open the official release link.</span>
          <span>Powered by Steinbach</span>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function readReleasePageIndex() {
  ensureReleasePageStorage();

  try {
    const content = fs.readFileSync(releaseIndexFile, 'utf8');
    const parsed = JSON.parse(content);
    return {
      pages: Array.isArray(parsed.pages) ? parsed.pages : []
    };
  } catch {
    return { pages: [] };
  }
}

function writeReleasePageIndex(index) {
  ensureReleasePageStorage();
  fs.writeFileSync(releaseIndexFile, JSON.stringify(index, null, 2));
}

function validateSourceUrl(value) {
  const sourceUrl = String(value || '').trim();

  if (!sourceUrl) {
    throw new ReleasePageError(422, 'validation_error', 'A Music Hub link is required.');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new ReleasePageError(422, 'validation_error', 'Enter a valid Music Hub link.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ReleasePageError(422, 'validation_error', 'Only http and https links are supported.');
  }

  return parsedUrl.toString();
}

async function extractReleaseMetadata(sourceUrl) {
  let response;

  try {
    response = await fetch(sourceUrl, {
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; SteinbachReleaseBuilder/1.0)'
      }
    });
  } catch {
    throw new ReleasePageError(422, 'fetch_error', 'The source page could not be loaded. Check the Music Hub link and try again.');
  }

  if (!response.ok) {
    throw new ReleasePageError(422, 'fetch_error', `The source page could not be loaded. Received ${response.status}.`);
  }

  const html = await response.text();
  const services = extractServicesFromHtml(html);
  const artist = extractEmbeddedJsonString(html, 'artist') || extractArtistFromTitle(extractOgTitle(html));
  const trackTitle = extractEmbeddedJsonString(html, 'track');
  const albumTitle = extractEmbeddedJsonString(html, 'album') || extractEmbeddedJsonString(html, 'albumName');
  const originalTitle = extractOgTitle(html);
  const title = trackTitle || albumTitle || extractReleaseTitle(originalTitle, artist);

  return {
    artist,
    title,
    description: extractMetaDescription(html),
    services,
    originalTitle,
    canonicalUrl: extractCanonicalUrl(html)
  };
}

function extractServicesFromHtml(html) {
  const embeddedMatch = html.match(/"serviceList":(\[[\s\S]*?\]),"blockData":/i);
  let services = [];

  if (embeddedMatch) {
    try {
      services = JSON.parse(embeddedMatch[1]);
    } catch {
      services = [];
    }
  }

  if (!services.length) {
    services = extractServiceAnchors(html);
  }

  const deduped = new Map();

  services.forEach((service, index) => {
    const key = String(service.serviceName || service.key || '').trim().toLowerCase();
    const url = String(service.url || '').trim();

    if (!key || !url) {
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      return;
    }

    const rank = Number(service.rank || index + 1);
    const normalizedKey = `${key}:${url}`;

    if (!deduped.has(normalizedKey)) {
      deduped.set(normalizedKey, {
        key,
        label: formatServiceLabel(key),
        type: String(service.serviceType || service.type || 'play').toLowerCase(),
        rank,
        url
      });
    }
  });

  return Array.from(deduped.values()).sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
}

function extractServiceAnchors(html) {
  const anchors = [];
  const anchorPattern = /href="([^"]+)"[\s\S]*?data-label="([^"]+)"/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    anchors.push({
      url: decodeHtmlEntities(match[1]),
      serviceName: match[2],
      serviceType: 'play'
    });
  }

  return anchors;
}

function createUniqueReleaseSlug(value) {
  const base = sanitizeSlugSegment(value).replace(new RegExp(`^${releaseSlugPrefix}-`), '') || 'release';
  const desiredSlug = `${releaseSlugPrefix}-${base}`;
  const existing = new Set(readReleasePageIndex().pages.map((page) => page.slug));

  if (!existing.has(desiredSlug)) {
    return desiredSlug;
  }

  let suffix = 2;

  while (existing.has(`${desiredSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${desiredSlug}-${suffix}`;
}

function normalizeArtworkExtension(filename, mimeType) {
  const extension = path.extname(filename || '').toLowerCase();

  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    return extension === '.jpeg' ? '.jpg' : extension;
  }

  if (mimeType === 'image/png') {
    return '.png';
  }

  if (mimeType === 'image/webp') {
    return '.webp';
  }

  return '.jpg';
}

function sanitizeSlugSegment(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function extractOgTitle(html) {
  return extractMetaTagValue(html, 'property', 'og:title') || extractTagContent(html, 'title');
}

function extractMetaDescription(html) {
  return extractMetaTagValue(html, 'name', 'description') || '';
}

function extractCanonicalUrl(html) {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractMetaTagValue(html, attributeName, attributeValue) {
  const pattern = new RegExp(`<meta[^>]*${attributeName}="${escapeRegex(attributeValue)}"[^>]*content="([^"]*)"`, 'i');
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractTagContent(html, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'i');
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function extractEmbeddedJsonString(html, key) {
  const pattern = new RegExp(`"${escapeRegex(key)}":("(?:\\.|[^"\\])*"|null)`, 'i');
  const match = html.match(pattern);

  if (!match || match[1] === 'null') {
    return '';
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return '';
  }
}

function extractArtistFromTitle(value) {
  const title = String(value || '').trim();

  if (!title.includes(' - ')) {
    return '';
  }

  return title.split(' - ')[0].trim();
}

function extractReleaseTitle(originalTitle, artist) {
  const title = String(originalTitle || '').trim();

  if (!title) {
    return '';
  }

  if (artist && title.startsWith(`${artist} - `)) {
    return title.slice(artist.length + 3).trim();
  }

  return title;
}

function buildReleaseDescription(description, title, artist) {
  const sourceDescription = String(description || '').trim();

  if (!sourceDescription) {
    return `Listen to ${title} by ${artist}.`;
  }

  return sourceDescription;
}

function formatServiceLabel(value) {
  return serviceLabelMap[value] || String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}