import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:8000',
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN || '',
  turnstileSecret: process.env.TURNSTILE_SECRET || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || '',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || ''
};
