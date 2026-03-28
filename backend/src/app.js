import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

import { config } from './lib/config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

const app = express();
const defaultCspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();

app.use(helmet({
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
        'https://www.youtube.com',
        'https://s.ytimg.com'
      ],
      'img-src': [
        "'self'",
        'data:',
        'https://i.ytimg.com',
        'https://*.ytimg.com'
      ],
      'media-src': ["'self'", 'blob:']
    }
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.corsAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'steinbach-file-handoff-backend' });
});

app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use(express.static(config.publicDir, { index: 'index.html' }));

app.get('/', (_request, response) => {
  response.sendFile(path.join(config.publicDir, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
