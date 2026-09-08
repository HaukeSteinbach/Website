/**
 * Der Newsletter, öffentliche Seite.
 *
 * Drei Wege, und alle drei ohne Anmeldung: eintragen, bestätigen, abmelden.
 *
 * Die beiden letzten sind bewusst GET und liefern eine ganze Seite zurück,
 * keine JSON-Antwort. Sie werden aus einem Mailprogramm heraus angeklickt, und
 * dort landet man in einem Browser ohne unser JavaScript. Was dann kommt, muss
 * für sich allein verständlich sein.
 */

import express from 'express';

import { config } from '../lib/config.js';
import { fail, ok } from '../lib/http.js';
import { sendNewsletterConfirmEmail } from '../lib/mail.js';
import {
  confirm,
  looksLikeEmail,
  subscribe,
  tidyEmail,
  unsubscribe
} from '../lib/newsletter.js';
import { isStorageConfigured } from '../lib/storage.js';

const router = express.Router();

function origin() {
  return config.appOrigin.replace(/\/$/, '');
}

/**
 * Eine schlichte Seite als Antwort auf einen Klick aus der Mail.
 *
 * Kein Stylesheet, keine Schrift, kein Skript: sie muss auch dann stehen, wenn
 * der Rest der Website gerade nicht erreichbar ist, und sie wird von Leuten
 * geöffnet, die nur eine Bestätigung sehen wollen und dann weiterklicken.
 */
function seite(response, code, titel, satz) {
  response.status(code).type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>${titel} | Steinbach</title>
<style>
  body{margin:0;background:#000;color:#D6D6D6;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
  main{max-width:34rem}
  h1{font-size:1.6rem;margin:0 0 1rem;text-transform:uppercase;letter-spacing:.02em}
  p{margin:0 0 1.5rem;color:#8C8C8C}
  a{color:#E94560}
</style>
</head>
<body>
<main>
  <h1>${titel}</h1>
  <p>${satz}</p>
  <p><a href="${origin()}">haukesteinbach.de</a></p>
</main>
</body>
</html>`);
}

/* --------------------------------------------------------------------------
   Ist der Dienst da?
   --------------------------------------------------------------------------
   Damit das Anmeldefeld im Fuss erst erscheint, wenn es auch etwas taugt. Vorher
   fragte die Seite mit einer leeren Anmeldung an und bekam 400 -- das stand dann
   als roter Fehler in der Konsole jedes Besuchers. Eine Frage, die eine Frage
   ist, kostet nichts und laesst nichts liegen.
   -------------------------------------------------------------------------- */

router.get('/status', (_request, response) => ok(response, {
  available: isStorageConfigured()
}));

/* --------------------------------------------------------------------------
   Eintragen
   -------------------------------------------------------------------------- */

router.post('/subscribe', async (request, response, next) => {
  try {
    if (!isStorageConfigured()) {
      return fail(response, 503, 'not_configured',
        'Die Anmeldung ist gerade nicht verfügbar. Schreib an mail@haukesteinbach.de.');
    }

    const email = tidyEmail(request.body?.email);

    if (!looksLikeEmail(email)) {
      return fail(response, 400, 'invalid_email',
        'Diese Adresse sieht nicht wie eine E-Mail-Adresse aus.');
    }

    /* Die IP gehört zum Nachweis der Einwilligung und wird nur dafür
       gespeichert. Hinter einem Proxy steht die echte in x-forwarded-for. */
    const ip = (request.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || request.ip
      || null;

    const { eintrag, mailNötig } = await subscribe({
      email,
      source: String(request.body?.source || 'website').slice(0, 40),
      ip
    });

    if (mailNötig) {
      await sendNewsletterConfirmEmail({
        to: eintrag.email,
        url: `${origin()}/newsletter/confirm?token=${encodeURIComponent(eintrag.token)}`
      });
    }

    /* Immer dieselbe Antwort, egal ob neu, wiederholt oder längst bestätigt.
       Sonst verrät diese Maske, wer auf dem Verteiler steht. */
    return ok(response, { message: 'Schau in dein Postfach.' });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Bestätigen
   -------------------------------------------------------------------------- */

router.get('/confirm', async (request, response, next) => {
  try {
    const eintrag = await confirm(String(request.query.token || ''));

    if (!eintrag) {
      return seite(response, 404, 'Link nicht mehr gültig',
        'Dieser Bestätigungslink ist abgelaufen oder wurde durch einen neueren ersetzt. '
        + 'Trag dich einfach noch einmal ein.');
    }

    return seite(response, 200, 'Angemeldet',
      'Danke. Du stehst auf dem Verteiler. Abmelden kannst du dich mit einem Klick '
      + 'am Ende jeder Ausgabe.');
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Abmelden
   --------------------------------------------------------------------------
   GET und POST auf demselben Weg: der Link in der Mail ist ein GET, und der
   Abmeldeknopf, den Gmail aus dem List-Unsubscribe-Kopf baut, schickt ein POST.
   Beide müssen wirken, sonst ist der Knopf eine Attrappe.
   -------------------------------------------------------------------------- */

async function abmelden(request, response, next) {
  try {
    const eintrag = await unsubscribe(String(request.query.token || request.body?.token || ''));

    if (!eintrag) {
      return seite(response, 404, 'Link nicht mehr gültig',
        'Zu diesem Link finden wir keine Anmeldung. Womöglich bist du längst abgemeldet.');
    }

    return seite(response, 200, 'Abgemeldet',
      'Erledigt, es kommt nichts mehr. Wenn du es dir anders überlegst, ist die '
      + 'Anmeldung wieder offen.');
  } catch (error) {
    return next(error);
  }
}

router.get('/unsubscribe', abmelden);
router.post('/unsubscribe', abmelden);

export default router;
