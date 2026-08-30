import { scryptSync } from 'node:crypto';
import { createMiniS3 } from './scripts/mini-s3.mjs';
const S3=9941, APP=8401, SMTP=9943;
Object.assign(process.env,{
  S3_ENDPOINT:`http://127.0.0.1:${S3}`,S3_BUCKET:'d',S3_ACCESS_KEY:'a',S3_SECRET_KEY:'b',S3_REGION:'auto',
  SESSION_SECRET:'v'.repeat(48),
  ADMIN_PASSWORD_HASH:`scrypt$s$${scryptSync('einLangesPasswort2026','s',64).toString('hex')}`,
  APP_ORIGIN:`http://127.0.0.1:${APP}`, NODE_ENV:'development',
  PUBLIC_DIR:new URL('..',import.meta.url).pathname,
  SMTP_HOST:'127.0.0.1',SMTP_PORT:String(SMTP),SMTP_USER:'mail@haukesteinbach.de',
  SMTP_PASSWORD:'x',SMTP_SECURE:'false',MAIL_FROM_EMAIL:'mail@haukesteinbach.de'
});
const { createMiniSmtp } = await import('./scripts/mini-smtp.mjs');
globalThis.__post = await createMiniSmtp(SMTP);
await createMiniS3(S3);
const { default: app } = await import('./src/app.js');
app.listen(APP, ()=>console.log('bereit', APP));
setInterval(()=>{}, 10000);
