/**
 * npm run shop-sandbox
 *
 * The whole shop on this machine, against Stripe's real test mode: the real
 * checkout page, a real test card, a real invoice PDF in your inbox if SMTP is
 * configured. Nothing else is real — storage is an S3 server held in memory
 * and vanishes when this stops.
 *
 * Stripe cannot reach a webhook on localhost, so no `checkout.session.completed`
 * arrives. It does not need to: the buyer's return page asks Stripe about the
 * session itself and records the order when the webhook has not beaten it
 * there. That path is exercised here rather than skipped.
 *
 * Test keys only. A live key is refused — this would take real money.
 */

import { createInterface } from 'node:readline/promises';
import { scryptSync } from 'node:crypto';
import { stdin, stdout } from 'node:process';

import { createMiniS3 } from './mini-s3.mjs';

const S3 = 9931;
const APP = Number(process.env.PORT_SANDBOX || 8394);
const PASSWORT = 'sandbox-passwort-1234';

const farbe = stdout.isTTY;
const B = farbe ? '\x1b[1m' : '';
const DIM = farbe ? '\x1b[2m' : '';
const R = farbe ? '\x1b[31m' : '';
const G = farbe ? '\x1b[32m' : '';
const N = farbe ? '\x1b[0m' : '';

const rl = createInterface({ input: stdin, output: stdout });

console.log(`
${B}Steinbach — Shop ausprobieren${N}
${DIM}Läuft nur auf diesem Rechner. Es wird kein echtes Geld bewegt und
nichts dauerhaft gespeichert.${N}
`);

let key = (process.env.STRIPE_SECRET_KEY || '').trim();

if (!key) {
  console.log(`  Den Testschlüssel findest du hier:
  ${B}dashboard.stripe.com/test/apikeys${N}  ${DIM}(Testmodus muss oben eingeschaltet sein)${N}
  Er beginnt mit ${B}sk_test_${N}.
`);
  key = (await rl.question('  Stripe-Testschlüssel  > ')).trim();
}

if (!key.startsWith('sk_test_')) {
  console.error(`\n  ${R}✗ Das ist kein Testschlüssel.${N}`);
  console.error(`    ${key.startsWith('sk_live_')
    ? 'Das ist ein Live-Schlüssel — damit würde echtes Geld fließen. Abgebrochen.'
    : 'Erwartet wird etwas, das mit sk_test_ beginnt.'}\n`);
  rl.close();
  process.exit(1);
}

rl.close();

Object.assign(process.env, {
  S3_ENDPOINT: `http://127.0.0.1:${S3}`,
  S3_BUCKET: 'sandbox',
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
  S3_REGION: 'auto',
  SESSION_SECRET: 'sandbox'.repeat(8),
  ADMIN_PASSWORD_HASH: `scrypt$sb$${scryptSync(PASSWORT, 'sb', 64).toString('hex')}`,
  APP_ORIGIN: `http://127.0.0.1:${APP}`,
  PUBLIC_DIR: new URL('../..', import.meta.url).pathname,
  NODE_ENV: 'development',
  STRIPE_SECRET_KEY: key,
  /* No webhook secret: Stripe cannot call localhost anyway, and the return
     page covers it. */
  STRIPE_WEBHOOK_SECRET: ''
});

const { objects } = await createMiniS3(S3);
const { default: app } = await import(new URL('../src/app.js', import.meta.url));

/* Show what lands in storage, so a purchase can be followed without digging. */
let zuletzt = 0;
setInterval(() => {
  if (objects.size !== zuletzt) {
    zuletzt = objects.size;
    const pdfs = [...objects.keys()].filter((k) => k.endsWith('.pdf'));
    if (pdfs.length) console.log(`\n  ${G}→ Rechnung erzeugt:${N} ${pdfs[pdfs.length - 1]}`);
  }
}, 1000).unref();

app.listen(APP, () => {
  console.log(`
${G}${B}Läuft.${N}

  ${B}1. Produktseite${N}
     http://127.0.0.1:${APP}/reclight.html#order

  ${B}2. Auf "Buy for 30,00 €" klicken${N}
     Du landest auf Stripes echter Bezahlseite.

     Testkarte    ${B}4242 4242 4242 4242${N}
     Datum        irgendwann in der Zukunft
     CVC          drei beliebige Ziffern
     Adresse      frei erfunden — sie landet auf der Rechnung

  ${B}3. Nach dem Bezahlen${N}
     Du kommst auf die Bestätigungsseite zurück und die Rechnung
     wird erzeugt. Ohne Mailserver geht sie nicht raus; die Datei
     entsteht trotzdem und der Pfad erscheint hier im Terminal.

  ${B}4. Deine Seite${N}
     http://127.0.0.1:${APP}/admin.html   Reiter ${B}Orders${N}
     Passwort: ${B}${PASSWORT}${N}
     Dort liegen Lieferadresse und Rechnung als PDF.

${DIM}  Beenden mit Strg+C. Danach ist alles wieder weg.${N}
`);
});
