/**
 * Licence keys for the software products.
 *
 * THE FORMAT IS HAUKE'S, and it is deliberate:
 *
 *     <invoice number>-<first name>-<last name>-<product>-Key
 *     2026-09-04-0002-Hauke-Steinbach-Chain-Key
 *
 * It is guessable by anyone who knows the shape, and that is an accepted
 * trade rather than an oversight. The reasoning: the demo is the full plug-in
 * without a time limit, so a key buys the removal of a nag, not access to
 * something otherwise unreachable. Anyone willing to forge a key was never
 * going to pay, and everyone else gets a key that carries their own name and
 * their own invoice number — which is a mild but real deterrent against
 * passing it around, and it makes support trivial: the key says which invoice
 * it belongs to.
 *
 * What this means for the code: DO NOT add a secret to the key and call it
 * security. A signature would only be worth something if the plug-in could
 * keep the secret, and it cannot — it runs on the buyer's machine. Half a
 * measure here would cost work and buy nothing.
 *
 * The key is checked on the buyer's machine, never against this server. Chain
 * keeps working whether or not this website does, which is what the product
 * page promises.
 */

/* Names go into a string that people read aloud, type from a phone screen and
   paste into a plug-in. Anything that survives that is allowed; everything
   else is folded down to it. */
const UMLAUTE = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
  'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
  'å': 'a', 'æ': 'ae', 'ø': 'oe', 'ð': 'd', 'þ': 'th',
  'Å': 'A', 'Æ': 'Ae', 'Ø': 'Oe'
};

/**
 * One name part into something typeable.
 *
 * "Ekström" becomes "Ekstroem", "O'Brien" becomes "OBrien", "van der Berg"
 * becomes "VanDerBerg". The dash is the separator of the key itself, so it
 * must not survive inside a part: "Meier-Schmidt" would otherwise make a key
 * with one field too many and no way to tell where the name ended.
 */
export function tidyNamePart(value) {
  const roh = String(value || '');

  const ersetzt = roh.replace(/[äöüßÄÖÜåæøðþÅÆØ]/g, (z) => UMLAUTE[z] || z);

  /* Everything else with a diacritic: decompose and drop the marks, so é → e.
     Anything left that is not a letter or digit falls away entirely. */
  const nackt = ersetzt
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ');

  /* Several words in one part keep their capitals and lose their spaces. */
  return nackt
    .split(/\s+/)
    .filter(Boolean)
    .map((wort) => wort.charAt(0).toUpperCase() + wort.slice(1))
    .join('');
}

/**
 * Split a full name into first and last.
 *
 * Stripe hands over one field, not two. Everything up to the last word is the
 * first name, the last word is the surname — wrong for a few names in the
 * world, right for most, and it never fails: with a single word the surname
 * stays empty and the key simply has one part less rather than being invalid.
 */
export function splitName(fullName) {
  const teile = String(fullName || '')
    .split(/\s+/)
    .map(tidyNamePart)
    .filter(Boolean);

  if (teile.length === 0) return { first: '', last: '' };
  if (teile.length === 1) return { first: teile[0], last: '' };

  return { first: teile.slice(0, -1).join(''), last: teile[teile.length - 1] };
}

/**
 * Build the key for one order.
 *
 * Die Rechnungsnummer geht so hinein, wie sie ausgestellt wurde. Ein
 * Schluessel, der eine gekuerzte oder verzierte Nummer zitiert, benennt das
 * Dokument nicht mehr, zu dem er gehoert -- und genau dafuer steht sie darin.
 */
export function buildLicenceKey({ invoiceNumber, buyerName, keyword }) {
  if (!invoiceNumber) throw new Error('Ein Lizenzschlüssel braucht die Rechnungsnummer.');
  if (!keyword) throw new Error('Ein Lizenzschlüssel braucht das Produktwort.');

  const { first, last } = splitName(buyerName);

  return [invoiceNumber, first, last, keyword, 'Key']
    .filter(Boolean)
    .join('-');
}

/**
 * Does this string look like one of our keys?
 *
 * Only used to give a person a straight answer in support ("that is not a
 * Chain key, that is a Reed Piano key"). It is NOT a check of validity, and
 * nothing may be granted on the strength of it.
 */
export function looksLikeLicenceKey(value, keyword) {
  const muster = keyword
    ? new RegExp(`-${keyword}-Key$`)
    : /-[A-Za-z0-9]+-Key$/;

  return muster.test(String(value || '').trim());
}
