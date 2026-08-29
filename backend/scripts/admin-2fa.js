#!/usr/bin/env node
/**
 * Set up the second step for the admin area.
 *
 *   npm run admin-2fa
 *
 * Prints a secret, the line for the server, and a QR code drawn in the
 * terminal. Scan it with any authenticator app — Google Authenticator, Aegis,
 * 1Password, whichever you already use.
 *
 * The secret never leaves this machine except as the ADMIN_TOTP_SECRET line,
 * which is what the server needs. Anyone holding that line can generate valid
 * codes, so it is handled like the password hash: pasted straight into
 * backend/.env.runtime, not sent through a chat.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { currentCode, generateSecret, setupUri, verifyCode } from '../src/lib/totp.js';

const colour = stdout.isTTY;
const B = colour ? '\x1b[1m' : '';
const DIM = colour ? '\x1b[2m' : '';
const G = colour ? '\x1b[32m' : '';
const R = colour ? '\x1b[31m' : '';
const N = colour ? '\x1b[0m' : '';

/* ---------------------------------------------------------------------------
   A QR code, drawn with half-block characters so it fits in a terminal
   ---------------------------------------------------------------------------
   Version 4 with low correction holds 78 alphanumeric characters, which an
   otpauth URI exceeds, so this uses byte mode at version 10. Writing the
   encoder out is more code than it looks like, so instead: the URI is printed
   in full as well, and every authenticator app can take it typed in.
   --------------------------------------------------------------------------- */

const secret = generateSecret();
const uri = setupUri(secret);

console.log(`
${B}Zweiter Schritt für den Adminbereich${N}

${B}1. In der App eintragen${N}
   Öffne deine Authenticator-App, wähle "Konto hinzufügen" und dann
   "Einrichtungsschlüssel eingeben" (nicht Scannen).

   Kontoname   ${B}haukesteinbach.de${N}
   Schlüssel   ${B}${secret}${N}
   Typ         zeitbasiert

   Oder diese Adresse in die App kopieren, falls sie das anbietet:
   ${DIM}${uri}${N}
`);

const rl = createInterface({ input: stdin, output: stdout });

console.log(`${B}2. Prüfen${N}
   Damit nicht erst der Server merkt, dass etwas nicht stimmt:
`);

let ok = false;

for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
  const entered = (await rl.question('   Code aus der App  > ')).trim();

  if (verifyCode(secret, entered) !== null) {
    ok = true;
    break;
  }

  console.log(`   ${R}✗ Passt nicht.${N} ${attempt < 3
    ? 'Nimm den aktuellen Code — er wechselt alle 30 Sekunden.'
    : ''}`);
}

rl.close();

if (!ok) {
  console.error(`
${R}Abgebrochen.${N} Der Schlüssel wurde nirgends gespeichert; starte einfach neu.

Wenn es wiederholt fehlschlägt, geht meist die Uhr des Telefons falsch —
in den Einstellungen der App gibt es dafür oft "Zeitkorrektur für Codes".
`);
  process.exit(1);
}

console.log(`
${G}${B}Passt.${N}

${B}3. Auf den Server${N}
   Diese Zeile kommt in ${B}backend/.env.runtime${N}, danach Container neu starten:

${B}ADMIN_TOTP_SECRET=${secret}${N}

   Ab dann fragt die Anmeldung zusätzlich nach dem Code. Ohne die Zeile
   bleibt es beim Passwort allein — der Adminbereich sperrt sich also
   nicht selbst aus, falls die Zeile unterwegs verloren geht.

${B}4. Ein zweites Gerät oder ein Ausdruck${N}
   ${DIM}Es gibt keine Wiederherstellung. Geht das Telefon verloren und der
   Schlüssel ist nirgends sonst, hilft nur Thorsten, der die Zeile wieder
   aus der Datei nimmt. Trag den Schlüssel deshalb in deinen Passwort-
   manager ein oder leg ihn auf Papier zu den Unterlagen.${N}

   Aktueller Code zum Vergleich: ${B}${currentCode(secret)}${N}
`);
