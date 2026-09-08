/**
 * Der Newsletter: Empfänger und Ausgaben.
 *
 * DOPPELTE BESTÄTIGUNG, und zwar nicht als Höflichkeit.
 *
 * Werbung per Mail braucht in Deutschland die vorherige ausdrückliche
 * Einwilligung des Empfängers (§ 7 Abs. 2 UWG), und im Streitfall muss der
 * Absender sie beweisen. Beweisbar ist sie nur, wenn zwischen "jemand hat
 * diese Adresse eingetragen" und "der Inhaber dieser Adresse wollte das" ein
 * Schritt liegt, den nur der Inhaber gehen kann: der Bestätigungslink.
 *
 * Ohne diesen Schritt trägt irgendwer die Adresse eines Dritten ein, und der
 * bekommt Post, die er nie wollte. Das ist keine graue Zone, das ist die
 * Fallgruppe, wegen der abgemahnt wird.
 *
 * Deshalb steht hier bei jeder Adresse, WANN sie eingetragen wurde, VON WELCHER
 * IP und WANN sie bestätigt hat. Diese drei Angaben sind der Nachweis. Sie
 * werden nicht zur Auswertung gespeichert und tauchen nirgends in einer
 * Statistik auf.
 *
 * ABMELDUNG MIT EINEM KLICK, ohne Anmeldung und ohne Begründung: jede Mail
 * trägt einen Link mit dem persönlichen Merkmal. Ein Abmeldeweg, der ein
 * Passwort verlangt, ist keiner.
 *
 * Die Ablage folgt orders.js: ein JSON-Objekt in R2, geschrieben mit If-Match
 * auf seinem ETag, damit zwei gleichzeitige Anmeldungen sich nicht gegenseitig
 * überschreiben.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'newsletter/index.json';
const WRITE_ATTEMPTS = 5;

/** angemeldet, aber noch nicht bestätigt · bestätigt · abgemeldet */
export const STATUS = ['pending', 'confirmed', 'unsubscribed'];

/* Eine unbestätigte Anmeldung verfällt. Wer nach zwei Wochen nicht geklickt
   hat, wollte nicht, und eine Adresse ohne Einwilligung aufzubewahren gibt es
   keinen Grund. */
export const PENDING_DAYS = 14;

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { subscribers: [], letters: [] }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);
    return {
      index: {
        subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
        letters: Array.isArray(parsed.letters) ? parsed.letters : []
      },
      etag: stored.etag
    };
  } catch (error) {
    /* Niemals mit einer leeren Liste weitermachen: das würde aus einer
       unlesbaren Datei einen verlorenen Verteiler machen. */
    throw new StorageError('Die Newsletter-Ablage konnte nicht gelesen werden.', error);
  }
}

async function writeIndex(index, etag) {
  await putObject(INDEX_KEY, JSON.stringify(index, null, 2), {
    contentType: 'application/json',
    ifMatch: etag || undefined,
    ifNoneMatch: etag ? undefined : '*'
  });
}

/** Lesen, ändern, schreiben — bei Kollision noch einmal von vorn. */
async function ändern(arbeit) {
  for (let versuch = 1; versuch <= WRITE_ATTEMPTS; versuch += 1) {
    const { index, etag } = await readIndex();
    const ergebnis = arbeit(index);

    try {
      await writeIndex(index, etag);
      return ergebnis;
    } catch (error) {
      if (versuch === WRITE_ATTEMPTS) throw error;
    }
  }

  throw new StorageError('Die Newsletter-Ablage ließ sich nicht schreiben.');
}

export function tidyEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Ein Merkmal, das in einer URL steht und nicht zu raten ist. */
function merkmal() {
  return randomBytes(24).toString('base64url');
}

/* --------------------------------------------------------------------------
   Anmelden
   -------------------------------------------------------------------------- */

/**
 * Eine Anmeldung aufnehmen.
 *
 * Gibt `{ eintrag, mailNötig }` zurück. `mailNötig` ist falsch, wenn diese
 * Adresse bereits bestätigt hat: dann darf keine neue Bestätigungsmail raus,
 * sonst wird die Anmeldemaske zum Versandwerkzeug gegen fremde Postfächer.
 */
export async function subscribe({ email, source, ip }) {
  const adresse = tidyEmail(email);

  if (!looksLikeEmail(adresse)) {
    throw new StorageError('Diese Adresse sieht nicht wie eine E-Mail-Adresse aus.');
  }

  return ändern((index) => {
    const jetzt = new Date().toISOString();
    const vorhanden = index.subscribers.find((e) => e.email === adresse);

    if (vorhanden && vorhanden.status === 'confirmed') {
      return { eintrag: vorhanden, mailNötig: false };
    }

    if (vorhanden) {
      /* Ein zweiter Anlauf: neues Merkmal, neuer Zeitstempel. Das alte
         Merkmal wird damit ungültig, eine liegengebliebene Mail von gestern
         kann also nicht mehr bestätigen. */
      vorhanden.status = 'pending';
      vorhanden.token = merkmal();
      vorhanden.requestedAt = jetzt;
      vorhanden.requestedIp = ip || null;
      vorhanden.source = source || vorhanden.source || 'website';
      return { eintrag: vorhanden, mailNötig: true };
    }

    const eintrag = {
      id: randomUUID(),
      email: adresse,
      status: 'pending',
      token: merkmal(),
      source: source || 'website',
      requestedAt: jetzt,
      requestedIp: ip || null,
      confirmedAt: null,
      unsubscribedAt: null
    };

    index.subscribers.push(eintrag);
    return { eintrag, mailNötig: true };
  });
}

/** Den Bestätigungslink einlösen. Gibt den Eintrag oder null. */
export async function confirm(token) {
  if (!token) return null;

  return ändern((index) => {
    const eintrag = index.subscribers.find((e) => e.token === token);
    if (!eintrag) return null;

    if (eintrag.status !== 'confirmed') {
      eintrag.status = 'confirmed';
      eintrag.confirmedAt = new Date().toISOString();
      eintrag.unsubscribedAt = null;
    }

    /* Das Merkmal bleibt: es ist danach der Abmeldeschlüssel. Ein zweites
       Merkmal dafür wäre eine zweite Sache, die verlorengehen kann. */
    return eintrag;
  });
}

/** Abmelden. Gibt den Eintrag oder null, wenn das Merkmal unbekannt ist. */
export async function unsubscribe(token) {
  if (!token) return null;

  return ändern((index) => {
    const eintrag = index.subscribers.find((e) => e.token === token);
    if (!eintrag) return null;

    eintrag.status = 'unsubscribed';
    eintrag.unsubscribedAt = new Date().toISOString();
    return eintrag;
  });
}

/* --------------------------------------------------------------------------
   Lesen
   -------------------------------------------------------------------------- */

export async function listSubscribers() {
  const { index } = await readIndex();

  return index.subscribers
    .slice()
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
}

/** Nur die, an die geschrieben werden darf. */
export async function confirmedSubscribers() {
  const alle = await listSubscribers();
  return alle.filter((e) => e.status === 'confirmed');
}

export async function stats() {
  const alle = await listSubscribers();
  const grenze = Date.now() - PENDING_DAYS * 24 * 60 * 60 * 1000;

  return {
    confirmed: alle.filter((e) => e.status === 'confirmed').length,
    pending: alle.filter((e) => e.status === 'pending'
      && new Date(e.requestedAt).getTime() >= grenze).length,
    expired: alle.filter((e) => e.status === 'pending'
      && new Date(e.requestedAt).getTime() < grenze).length,
    unsubscribed: alle.filter((e) => e.status === 'unsubscribed').length,
    total: alle.length
  };
}

/**
 * Abgelaufene Anmeldungen wegräumen.
 *
 * Wer zwei Wochen nicht bestätigt hat, wollte nicht. Die Adresse ohne
 * Einwilligung weiter aufzubewahren hat keinen Zweck, und ohne Zweck darf sie
 * nach Art. 5 DSGVO auch nicht liegenbleiben.
 */
export async function purgeExpired() {
  const grenze = Date.now() - PENDING_DAYS * 24 * 60 * 60 * 1000;

  return ändern((index) => {
    const vorher = index.subscribers.length;

    index.subscribers = index.subscribers.filter((e) => !(
      e.status === 'pending' && new Date(e.requestedAt).getTime() < grenze
    ));

    return vorher - index.subscribers.length;
  });
}

/* --------------------------------------------------------------------------
   Die Ausgaben
   -------------------------------------------------------------------------- */

export async function listLetters() {
  const { index } = await readIndex();

  return index.letters
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getLetter(id) {
  const { index } = await readIndex();
  return index.letters.find((b) => b.id === id) || null;
}

export async function createLetter({ subject, body }) {
  const betreff = String(subject || '').trim();
  const text = String(body || '').trim();

  if (!betreff) throw new StorageError('Ohne Betreff geht nichts raus.');
  if (!text) throw new StorageError('Ohne Text geht nichts raus.');

  return ändern((index) => {
    const jetzt = new Date().toISOString();
    const brief = {
      id: randomUUID(),
      subject: betreff,
      body: text,
      status: 'draft',
      createdAt: jetzt,
      updatedAt: jetzt,
      sentAt: null,
      /* Wer schon Post hat. Damit ein abgebrochener Versand fortgesetzt werden
         kann, ohne jemandem dieselbe Ausgabe zweimal zu schicken. */
      deliveredTo: [],
      failedTo: []
    };

    index.letters.push(brief);
    return brief;
  });
}

export async function updateLetter(id, { subject, body }) {
  return ändern((index) => {
    const brief = index.letters.find((b) => b.id === id);
    if (!brief) return null;

    /* Eine verschickte Ausgabe wird nicht mehr geändert. Was in fremden
       Postfächern liegt, lässt sich nicht zurückholen, und ein Entwurf, der
       nachträglich anders lautet als das Verschickte, ist eine Falle. */
    if (brief.status === 'sent') return brief;

    if (subject !== undefined) brief.subject = String(subject).trim();
    if (body !== undefined) brief.body = String(body).trim();
    brief.updatedAt = new Date().toISOString();

    return brief;
  });
}

export async function deleteLetter(id) {
  return ändern((index) => {
    const vorher = index.letters.length;
    index.letters = index.letters.filter((b) => b.id !== id || b.status === 'sent');
    return vorher !== index.letters.length;
  });
}

/** Einen Empfänger als bedient vermerken. Nach jedem Versand, nicht am Ende. */
export async function markDelivered(id, email, erfolg, grund) {
  return ändern((index) => {
    const brief = index.letters.find((b) => b.id === id);
    if (!brief) return null;

    const adresse = tidyEmail(email);

    if (erfolg) {
      if (!brief.deliveredTo.includes(adresse)) brief.deliveredTo.push(adresse);
      brief.failedTo = brief.failedTo.filter((f) => f.email !== adresse);
    } else if (!brief.failedTo.some((f) => f.email === adresse)) {
      brief.failedTo.push({ email: adresse, reason: grund || 'unbekannt' });
    }

    brief.updatedAt = new Date().toISOString();
    return brief;
  });
}

export async function markLetterSent(id) {
  return ändern((index) => {
    const brief = index.letters.find((b) => b.id === id);
    if (!brief) return null;

    brief.status = 'sent';
    brief.sentAt = brief.sentAt || new Date().toISOString();
    brief.updatedAt = new Date().toISOString();
    return brief;
  });
}
