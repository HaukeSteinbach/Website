/* Prüft, dass jeder Kauf eine Meldung ans Studio auslöst — auch dann, wenn
   davor etwas schiefgegangen ist. Genau das war vorher nicht der Fall. */
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

import { createMiniS3 } from './mini-s3.mjs';
import { createMiniSmtp } from './mini-smtp.mjs';

const S3 = 9861, APP = 9862, SMTP = 9863;

process.env.S3_ENDPOINT = `http://127.0.0.1:${S3}`;
process.env.S3_BUCKET = 'shop'; process.env.S3_ACCESS_KEY = 'a'; process.env.S3_SECRET_KEY = 'b';
process.env.S3_REGION = 'auto'; process.env.SESSION_SECRET = 'n'.repeat(48);
process.env.ADMIN_PASSWORD_HASH = `scrypt$s$${scryptSync('einLangesPasswort2026', 's', 64).toString('hex')}`;
process.env.APP_ORIGIN = `http://127.0.0.1:${APP}`; process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = new URL('../../', import.meta.url).pathname;
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(SMTP);
process.env.SMTP_USER = 'mail@haukesteinbach.de'; process.env.SMTP_PASSWORD = 'x';
process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM_EMAIL = 'mail@haukesteinbach.de';

const postfach = await createMiniSmtp(SMTP);
await createMiniS3(S3);

const { recordPaidSession } = await import('../src/routes/shop.js');

const pass = [], fail = [];
const check = (n, f) => { try { f(); pass.push(n); } catch (e) { fail.push(`${n}: ${e.message}`); } };

function sitzung(id) {
  return {
    id,
    payment_status: 'paid',
    amount_total: 3490,
    currency: 'eur',
    total_details: { amount_shipping: 490 },
    payment_intent: `pi_${id}`,
    metadata: { product_slug: 'reclight' },
    customer_details: { email: 'kaeuferin@example.org', name: 'Käuferin' },
    shipping_details: {
      name: 'Käuferin',
      address: { line1: 'Weg 1', postal_code: '20095', city: 'Hamburg', country: 'DE' }
    }
  };
}

const meldungen = () => postfach.text().split('\n---\n')
  .filter((m) => /Bestellung/.test(m) && /mail@haukesteinbach\.de/.test(m));

try {
  const bestellung = await recordPaidSession(sitzung('cs_eins'));

  check('die Bestellung entsteht', () => assert.ok(bestellung.invoiceNumber));
  check('mit Rechnung im Speicher', () => assert.ok(bestellung.invoiceKey));
  check('die Meldung ans Studio ging raus', () => assert.ok(bestellung.noticeSentAt));

  const text = postfach.text();
  check('sie nennt die Rechnungsnummer', () => assert.ok(text.includes(bestellung.invoiceNumber)));
  check('sie nennt den Betrag', () => assert.ok(/34,90/.test(text)));
  check('und die Lieferanschrift', () => assert.ok(/Weg 1/.test(text) && /Hamburg/.test(text)));

  const vorher = postfach.messages.length;

  /* Stripe stellt denselben Vorgang mehrfach zu. Das darf keine zweite
     Meldung ausloesen. */
  const nochmal = await recordPaidSession(sitzung('cs_eins'));
  check('ein zweiter Durchlauf legt nichts Neues an', () =>
    assert.equal(nochmal.invoiceNumber, bestellung.invoiceNumber));
  check('und meldet nicht doppelt', () => assert.equal(postfach.messages.length, vorher));

  /* Der eigentliche Grund fuer diesen Test: schlaegt ein Schritt fehl und
     Stripe versucht es erneut, muss der Rest nachgeholt werden. Vorher brach
     der zweite Durchlauf pauschal ab und die Meldung kam nie. */
  const { getOrder, updateOrder } = await import('../src/lib/orders.js');
  const halb = await recordPaidSession(sitzung('cs_zwei'));

  await updateOrder(halb.id, (draft) => {
    draft.noticeSentAt = null;
    draft.mailSentAt = null;
    draft.invoiceKey = null;
  });

  const zaehlerVorher = postfach.messages.length;
  const nachgeholt = await recordPaidSession(sitzung('cs_zwei'));

  check('ein unfertiger Vorgang wird beim naechsten Mal fertiggestellt', () => {
    assert.ok(nachgeholt.invoiceKey);
    assert.ok(nachgeholt.noticeSentAt);
  });
  check('und schickt die fehlenden Mails nach', () =>
    assert.ok(postfach.messages.length > zaehlerVorher));

  const wieder = await getOrder(halb.id);
  check('die Rechnungsnummer bleibt dieselbe', () =>
    assert.equal(wieder.invoiceNumber, halb.invoiceNumber));

  /* Ein Kauf aus dem anderen Shop geht uns nichts an. */
  const fremd = await recordPaidSession({ ...sitzung('cs_fremd'), metadata: { product_slug: 'organ' } });
  check('ein fremder Kauf loest keine Meldung aus', () => assert.equal(fremd, null));
} finally {
  postfach.close();
}

for (const n of pass) console.log(`  ok   ${n}`);
for (const f of fail) console.log(`  FEHL ${f}`);
console.log(`\n${pass.length} bestanden, ${fail.length} fehlgeschlagen`);
process.exit(fail.length ? 1 : 0);
