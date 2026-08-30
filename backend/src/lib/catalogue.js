/**
 * Was auf einer Rechnung oder einem Angebot stehen kann.
 *
 * Die Texte stammen aus Onlydesk und sind wörtlich übernommen — sie stehen so
 * bereits auf ausgestellten Rechnungen, und zwei Fassungen desselben Textes
 * wären eine Quelle für Streit darüber, was eigentlich vereinbart war.
 *
 * Preise in Cent, wie überall in diesem Projekt: mit Kommazahlen zu rechnen
 * heißt, sich früher oder später um einen Cent zu vertun.
 *
 * Keine Umsatzsteuer, § 19 UStG. Der Satz steht hier trotzdem als Feld, damit
 * die Belege ihn ausweisen können, ohne dass ihn jemand im Kopf mitführt —
 * und damit ein späterer Wechsel zur Regelbesteuerung eine Zahl ändert und
 * nicht die halbe Anwendung.
 *
 * Bewusst ohne Einheiten: welche Position stundenweise abgerechnet wird und
 * welche pauschal, geht aus den Preisen nicht hervor, und eine geratene
 * Einheit steht am Ende falsch auf einer Rechnung. Die Menge trägt man beim
 * Schreiben ein, die Bezeichnung lässt sich dort ebenfalls ergänzen.
 */

export const SERVICES = [
  {
    slug: 'dj-livemusik',
    name: 'DJ und Livemusik',
    description: 'DJ- & Livemusik-Begleitung, inkl. Aufbau/Soundcheck, Performance '
      + '(DJ-Set + Live), Abbau sowie Bereitstellung/Bedienung der Technik nach Absprache.',
    unitCents: 5500
  },
  {
    slug: 'filmmusik',
    name: 'Filmmusik',
    /* Der Platzhalter steht so in der Vorlage. Er bleibt sichtbar, damit
       niemand ihn übersieht — ein leeres Feld fiele weniger auf. */
    description: 'Komposition und Produktion illustrativer Filmmusik für ‚FILM‘ '
      + 'inkl. musikalischem Konzept, Abstimmung, Arrangement, Mix sowie Lieferung als WAV (Stereo)',
    unitCents: 40000
  },
  {
    slug: 'hoa-verlaengerung',
    name: 'HOA Verlängerung',
    description: 'Verlängerung bestehender HOAs für alle derzeit vorhandenen Werke um 2 Jahre '
      + 'ab jeweiligem HOA-Ende (1 Jahr ab Erstveröffentlichung), gemäß bisherigen Bedingungen. '
      + 'Weltweit, alle Formate/Medien. Titel laut Anlage/HOA.',
    unitCents: 1000000
  },
  {
    slug: 'mastering',
    name: 'Mastering',
    description: 'Audio-Mastering eines Musikstücks inkl. finaler Klangoptimierung, '
      + 'Lautheitsanpassung, Stereo-Feinkorrektur und Erstellung der Master-Dateien für Veröffentlichung.',
    unitCents: 4000
  },
  {
    slug: 'mixing',
    name: 'Mixing',
    description: 'Audio-Mixing eines Musikstücks inkl. Pegel- und Frequenzbearbeitung, '
      + 'Dynamikbearbeitung, Stereobild-Optimierung sowie Vorbereitung des Mixes für das Mastering.',
    unitCents: 4000
  },
  {
    slug: 'produktion',
    name: 'Produktion',
    description: 'Produktion & Mixing eines individuellen Tracks in Online-Livesession (Remote). '
      + 'Umfang: 8 Stunden. Inkl. Recording/Editing, Sounddesign, Mixdown & Export im WAV Format.',
    unitCents: 60000
  },
  {
    slug: 'recording',
    name: 'Recording',
    description: 'Setup von Mikrofonen, Routing/Session in der DAW, Pegel/Monitoring sowie '
      + 'schneller Troubleshooting-Support, damit die Aufnahme stabil und stressfrei läuft.',
    unitCents: 4000
  },
  {
    slug: 'stem-mastering',
    name: 'STEM Mastering',
    description: 'Professionelles Audio-Mastering auf Basis einzelner STEMS. Enthält 3 Revisionen, '
      + 'Lautheit/Dynamik-Optimierung sowie Vorbereitung für Streaming/Club/Radio/CD. '
      + 'Preis: 50 € pro Track + 10 € je Stem.',
    unitCents: 5000
  },
  {
    slug: 'studiomiete',
    name: 'Studiomiete',
    description: '',
    unitCents: 4500
  },
  {
    slug: 'veranstaltungstechnik',
    name: 'Veranstaltungstechnik',
    description: 'Aufbau/Abbau, Einmessen & Systemcheck der PA, Signalrouting, '
      + 'Soundcheck-Betreuung sowie technischer Support während der Veranstaltung inkl. Kleinmaterial.',
    unitCents: 2500
  },
  {
    slug: 'verbrauchsmaterial',
    name: 'Verbrauchsmaterial',
    description: '',
    unitCents: 5000
  },
  {
    slug: 'projektstunden',
    name: 'Zusätzliche Projektstunden',
    description: 'Zusätzliche Projektstunden über die enthaltenen Stunden hinaus gehen '
      + '(z.B. weitere Editing-, Mix- oder Revision-Zeit).',
    unitCents: 5000
  }
];

/** Der Steuersatz auf allem: keiner, § 19 UStG. */
export const VAT_RATE = 0;

export function getService(slug) {
  return SERVICES.find((service) => service.slug === slug) || null;
}
