import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

import { config } from './lib/config.js';
import { describeMailSetup } from './lib/mail.js';
import { checkStorage, isStorageConfigured } from './lib/storage.js';
import { describeShopSetup } from './lib/stripe.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { isAdminConfigured } from './middleware/auth.js';
import adminRoutes from './routes/admin.js';
import publicRoutes, { deliveryPageHandler } from './routes/public.js';
import shopRoutes from './routes/shop.js';
import releasePageRoutes from './routes/release-pages.js';

const app = express();
const defaultCspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
const localPreviewOrigins = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`
]);

app.set('trust proxy', 1);

app.use(helmet({
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  contentSecurityPolicy: {
    directives: {
      ...defaultCspDirectives,
      'script-src': [
        "'self'",
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com',
        'https://s.ytimg.com'
      ],
      'frame-src': [
        "'self'",
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com'
      ],
      'connect-src': [
        "'self'",
        'https://formspree.io',
        /* werbung.html spricht mit dem Anzeigen-Dienst und der Anmeldung bei
           Supabase. Ohne diesen Eintrag blockt die CSP die Aufrufe. */
        'https://eojchbkieeqyfgfazydk.supabase.co',
        'https://www.youtube.com',
        'https://s.ytimg.com'
      ],
      'img-src': [
        "'self'",
        'data:',
        'https://i.ytimg.com',
        'https://*.ytimg.com'
      ],
      'media-src': ["'self'", 'blob:'],
      /* Downloads are 302s to a signed R2 URL, so the browser has to be
         allowed to follow them. */
      'form-action': ["'self'"]
    }
  }
}));

/**
 * Ausnahme für das UI Studio.
 *
 * Das Werkzeug ist eine einzige HTML-Datei mit dem gesamten Programm in
 * <script>-Blöcken darin; sie wird von uistudio.html aus dem privaten
 * Supabase-Storage geholt und in die Seite geschrieben. Gegen die
 * `script-src 'self'` oben startet davon nichts.
 *
 * Statt die Regel für die ganze Seite aufzuweichen, gilt sie hier nur für
 * diesen einen Pfad. Die Seite ist intern, noindex, und ihr Inhalt kommt aus
 * unserem eigenen privaten Speicher — kein fremder Code, nur eben Code, den
 * die Datei mitbringt statt nachzuladen.
 *
 * Ein Hash statt 'unsafe-inline' wäre enger, ginge aber nur, wenn die
 * Studio-Datei hier läge. Sie liegt bewusst nicht hier: sie wird oft und ohne
 * Deploy ausgetauscht, und jeder Austausch würde den Hash brechen.
 */
app.use('/uistudio.html', (_request, response, next) => {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://eojchbkieeqyfgfazydk.supabase.co wss://eojchbkieeqyfgfazydk.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  next();
});

app.use((request, response, next) => {
  const forwardedProtocol = request.get('x-forwarded-proto');
  const forwardedHost = request.get('x-forwarded-host');
  const requestProtocol = forwardedProtocol ? forwardedProtocol.split(',')[0].trim() : request.protocol;
  const requestHost = forwardedHost ? forwardedHost.split(',')[0].trim() : request.get('host');
  const sameOrigin = requestHost ? `${requestProtocol}://${requestHost}` : null;
  const configuredCorsOrigins = Array.isArray(config.corsAllowedOrigins) ? config.corsAllowedOrigins : [];
  const allowedOrigins = new Set([
    config.appOrigin,
    sameOrigin,
    ...configuredCorsOrigins,
    ...(config.nodeEnv === 'production' ? [] : Array.from(localPreviewOrigins))
  ].filter(Boolean));

  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })(request, response, next);
});

/* Stripe signs the exact bytes it sent, so this one route has to see them
   untouched — express.json() below would re-serialise and break the check. */
app.use('/api/v1/public/shop/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

/**
 * Reports what is actually wired up, not just that the process is alive.
 * A server with no bucket or no admin password still answers requests but
 * cannot do its job, and that should be visible without reading logs.
 */
app.get('/health', async (_request, response) => {
  const storage = await checkStorage();
  const mail = describeMailSetup();
  const shop = describeShopSetup();

  response.status(storage.ok ? 200 : 503).json({
    ok: storage.ok,
    service: 'steinbach-file-handoff-backend',
    storage,
    admin: isAdminConfigured() ? 'configured' : 'not_configured',
    mail,
    shop
  });
});

app.use('/api/v1/public/shop', shopRoutes);
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/admin', adminRoutes);

/* The customer-facing delivery page, kept short because it is pasted into
   emails and read aloud on the phone. */
app.get('/d/:token', ...deliveryPageHandler);

/* Retired pages. Sending files is a step inside a project now, and a revision
   is asked for on the delivery page itself, so these three have no content of
   their own left. They stay as redirects because they were bookmarked. */
const RETIRED = {
  '/send-files.html': '/admin.html',
  '/delivery.html': '/admin.html',
  '/revision.html': '/contact.html',
  /* Die Orgel wird bei Steinbach Instruments verkauft, wo auch alle anderen
     Sampleinstrumente stehen. Sie hier ein zweites Mal zu fuehren, hiess zwei
     Seiten zum selben Produkt zu pflegen. Der Verweis geht auf das Original,
     damit Lesezeichen und die Google-Treffer nicht ins Leere laufen. */
  '/orgel.html': 'https://steinbach-instruments.de/historic-organ.html'
};

Object.entries(RETIRED).forEach(([from, to]) => {
  app.get(from, (_request, response) => response.redirect(301, to));
});

app.use(releasePageRoutes);
app.use(express.static(config.publicDir, { index: 'index.html' }));

app.get('/', (_request, response) => {
  response.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

/* One line at boot beats discovering a missing bucket when the first customer
   upload fails halfway through. */
if (!isStorageConfigured()) {
  console.warn('[storage] No bucket configured — file transfer is disabled. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.');
}

if (!isAdminConfigured()) {
  console.warn('[admin] No admin password configured — the admin area is locked. Set ADMIN_PASSWORD_HASH and SESSION_SECRET.');
}

if (!describeShopSetup().ok) {
  console.warn(`[shop] Not configured (missing ${describeShopSetup().missing.join(', ')}). reclight.html falls back to the pre-order form.`);
} else if (describeShopSetup().mode === 'test') {
  console.warn('[shop] Running in Stripe TEST mode — no real money moves.');
}

if (process.env.STRIPE_API_BASE) {
  console.warn(`[shop] STRIPE_API_BASE is set to ${process.env.STRIPE_API_BASE} — Stripe calls do NOT reach Stripe. Unset it in production.`);
}

if (!describeMailSetup().ok) {
  console.warn(`[mail] No SMTP configured (missing ${describeMailSetup().missing.join(', ')}). Studio notifications fall back to Formspree; deliveries to clients will NOT be sent.`);
}

export default app;
