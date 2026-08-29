/**
 * Einen Onlydesk-Auszug in die Form des Kundenstamms bringen.
 *
 * Die Vorlage ist ein Bildschirmauszug: sechs Zellen je Zeile, frei getippter
 * Inhalt, Zeilenumbrüche als einzige Struktur. Was sich daraus verlässlich
 * lesen lässt, steht hier — und was nicht, bleibt lieber ungetrennt stehen,
 * als falsch zerlegt zu werden.
 *
 * Reine Funktionen ohne Speicherzugriff, damit sie prüfbar sind, ohne echte
 * Kundendaten anzufassen.
 */

const zeilen = (zelle) => String(zelle || '').split('\n').map((z) => z.trim()).filter(Boolean);

/**
 * Aus einer Adresszelle Straße, Postleitzahl, Ort und Land machen.
 *
 * Die Zelle ist frei getippt. Verlässlich ist nur eines: eine Zeile aus fünf
 * Ziffern und einem Ortsnamen ist die Postleitzahlzeile. Was davor steht, ist
 * Straße, was danach kommt, Land. Fehlt die Zeile, bleibt alles Straße —
 * lieber ungetrennt als falsch getrennt.
 */
function adresse(zelle) {
  const teile = zeilen(zelle);
  const plzIndex = teile.findIndex((z) => /^\d{4,5}\s+\S/.test(z));

  if (plzIndex === -1) {
    return { line1: teile.join(', '), line2: '', postalCode: '', city: '', country: '' };
  }

  const [, plz, ort] = teile[plzIndex].match(/^(\d{4,5})\s+(.*)$/);

  return {
    line1: teile.slice(0, plzIndex).join(', '),
    line2: '',
    postalCode: plz,
    city: ort,
    country: teile.slice(plzIndex + 1).join(', ')
  };
}

function kontakt(zelle) {
  const teile = zeilen(zelle);

  return {
    email: teile.find((z) => z.includes('@')) || '',
    /* Unicode-Steuerzeichen raus: die Oberfläche setzt bei Nummern mit
       Ländervorwahl Richtungsmarken, die man sonst mitschleppt. */
    phone: (teile.find((z) => /[\d][\d\s/+()-]{5,}/.test(z) && !z.includes('@')) || '')
      .replace(/[‎‏‪-‮]/g, '').trim()
  };
}

/** "1.234,56€" → 123456 */
function centsAus(zelle) {
  const treffer = String(zelle || '').replace(/\s/g, '').match(/(-?[\d.]+),(\d{2})/);

  if (!treffer) {
    return null;
  }

  return Number(treffer[1].replace(/\./g, '')) * 100 + Number(treffer[2]);
}

/** "29.08.2026" → "2026-08-29" */
function datumAus(zelle) {
  const treffer = String(zelle || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);

  return treffer ? `${treffer[3]}-${treffer[2]}-${treffer[1]}` : '';
}

const STATUS = { Ausgestellt: 'issued', Bezahlt: 'paid', Storniert: 'cancelled' };

/** Für den Namensvergleich: Anrede, Rechtsform und Zeichensetzung stören nur. */
function schluessel(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(herr|frau|c\/o)\b/g, ' ')
    .replace(/\b(gmbh|co|kg|ug|e\.?\s?v|gbr|ohg|ag|mbh)\b/g, ' ')
    .replace(/[^a-zäöüß0-9]+/g, ' ')
    .trim();
}


/* ---------------------------------------------------------------------------
   Zusammensetzen
   --------------------------------------------------------------------------- */

export function kundenAus(reihen) {
  return (reihen || []).map((reihe) => {
    const namensZeilen = zeilen(reihe[0]);
    const { email, phone } = kontakt(reihe[2]);

    return {
      name: namensZeilen[0] || '',
      /* Zweite Namenszeile ist mal eine Ansprechperson, mal ein Zusatz. Sie
         gehört nicht in den Namen und nicht in die Adresse, aber verloren
         gehen soll sie auch nicht. */
      note: [namensZeilen.slice(1).join(' — '), zeilen(reihe[4]).join(' — ')].filter(Boolean).join(' · '),
      address: adresse(reihe[1]),
      email,
      phone,
      vatId: zeilen(reihe[3]).join(' '),
      source: 'onlydesk'
    };
  }).filter((k) => k.name);
}

export function rechnungenAus(reihen) {
  return (reihen || []).map((reihe) => ({
    number: String(reihe[0] || '').trim(),
    totalCents: centsAus(reihe[1]),
    kundenName: zeilen(reihe[2])[0] || '',
    status: STATUS[String(reihe[3] || '').trim()] || 'issued',
    date: datumAus(reihe[4])
  })).filter((r) => r.number);
}

/** Rechnungen den Kunden zuordnen; Aliase gelten vor dem Namensvergleich. */
export function zuordnen(kunden, rechnungen, aliase = new Map()) {
  const nachSchluessel = new Map(kunden.map((k) => [schluessel(k.name), k]));
  const zugeordnet = [];
  const offen = [];

  for (const rechnung of rechnungen) {
    const name = aliase.get(rechnung.kundenName) || rechnung.kundenName;
    const treffer = nachSchluessel.get(schluessel(name));

    if (treffer) {
      zugeordnet.push({ rechnung, kunde: treffer });
    } else {
      offen.push(rechnung);
    }
  }

  return { zugeordnet, offen };
}

export { adresse, kontakt, centsAus, datumAus, schluessel };
