/* Welche Absenderadresse wird in welcher Lage gewählt?
   config.js liest process.env beim Import einmalig — daher ein Prozess je Fall. */
import { execFileSync } from 'node:child_process';

const MAIL = new URL('../src/lib/mail.js', import.meta.url).href;

const faelle = [
  { name: 'MAIL_FROM_EMAIL gesetzt',              env: { SMTP_HOST:'smtp.x.de', SMTP_USER:'konto123',              MAIL_FROM_EMAIL:'mail@haukesteinbach.de' }, erwartet:{ok:true,  from:'mail@haukesteinbach.de', quelle:'MAIL_FROM_EMAIL'} },
  { name: 'nur SMTP_USER, ist eine Adresse',      env: { SMTP_HOST:'smtp.x.de', SMTP_USER:'mail@haukesteinbach.de', MAIL_FROM_EMAIL:'' },                      erwartet:{ok:true,  from:'mail@haukesteinbach.de', quelle:'SMTP_USER'} },
  { name: 'SMTP_USER ist eine Kontonummer',       env: { SMTP_HOST:'smtp.x.de', SMTP_USER:'konto123',              MAIL_FROM_EMAIL:'' },                      erwartet:{ok:false, fehlt:'MAIL_FROM_EMAIL'} },
  { name: 'gar kein SMTP',                        env: { SMTP_HOST:'',         SMTP_USER:'',                       MAIL_FROM_EMAIL:'' },                      erwartet:{ok:false, fehlt:'SMTP_HOST'} }
];

let ok = 0; const fehler = [];
for (const f of faelle) {
  const roh = execFileSync(process.execPath,
    ['--input-type=module', '-e', `import('${MAIL}').then(m => console.log(JSON.stringify(m.describeMailSetup())))`],
    { env: { ...process.env, ...f.env }, encoding: 'utf8' });
  const r = JSON.parse(roh.trim().split('\n').pop());

  const passt = r.ok === f.erwartet.ok
    && (!f.erwartet.from   || r.from === f.erwartet.from)
    && (!f.erwartet.quelle || r.fromSource === f.erwartet.quelle)
    && (!f.erwartet.fehlt  || (r.missing || []).includes(f.erwartet.fehlt));
  passt ? ok++ : fehler.push(f.name);
  console.log(`  ${passt ? 'ok  ' : 'FAIL'} ${f.name.padEnd(32)} -> ${r.ok ? r.from + ' (aus ' + r.fromSource + ')' : 'fehlt: ' + (r.missing||[]).join(', ')}`);
}
console.log(`\n  ${ok} von ${faelle.length}`);
process.exit(fehler.length ? 1 : 0);
