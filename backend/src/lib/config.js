import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const port = Number(process.env.PORT || 3000);
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  appOrigin: process.env.APP_ORIGIN || `https://haukesteinbach.de`,
  corsAllowedOrigins,
  sessionSecret: process.env.SESSION_SECRET || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  formspreeUploadEndpoint: process.env.FORMSPREE_UPLOAD_ENDPOINT || 'https://formspree.io/f/xgopedgb',
  notificationEmail: process.env.NOTIFICATION_EMAIL || '',
  mailFromEmail: process.env.MAIL_FROM_EMAIL || '',
  mailReplyTo: process.env.MAIL_REPLY_TO || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  sourceDownloadLinkTtlHours: Number(process.env.SOURCE_DOWNLOAD_LINK_TTL_HOURS || 168),
  s3Endpoint: process.env.S3_ENDPOINT || '',
  /* R2 has no regions; 'auto' is what the S3 SDK wants to see. */
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage', 'uploads'),
  publicDir: process.env.PUBLIC_DIR || path.join(process.cwd(), 'public')
};
