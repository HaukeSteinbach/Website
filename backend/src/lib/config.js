import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:8000',
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN || '',
  notificationEmail: process.env.NOTIFICATION_EMAIL || '',
  mailFromEmail: process.env.MAIL_FROM_EMAIL || '',
  sourceDownloadLinkTtlHours: Number(process.env.SOURCE_DOWNLOAD_LINK_TTL_HOURS || 168),
  turnstileSecret: process.env.TURNSTILE_SECRET || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || '',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage', 'uploads')
};
