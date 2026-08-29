/*
 * Onlydesk-Export — im Browser auszuführen, nicht mit node.
 *
 * So geht es:
 *   1. app.onlydesk.de im Chrome öffnen und angemeldet sein
 *   2. Rechtsklick → "Untersuchen" → Reiter "Console"
 *   3. Diese Datei komplett hineinkopieren und Enter
 *
 * Am Ende landet eine Datei onlydesk-export-JJJJ-MM-TT.json in deinen
 * Downloads. Sie enthält Kunden und Rechnungen als Rohdaten, so wie Onlydesk
 * sie herausgibt — nichts umbenannt, nichts weggelassen. Umgebaut wird erst
 * beim Import, damit die Datei ein sauberer Beleg dessen bleibt, was im alten
 * System stand.
 *
 * Die Daten gehen dabei aus deinem Browser direkt auf deine Festplatte. Sie
 * laufen durch keinen Chat, keinen Server und über keine dritte Stelle.
 */

(async () => {
  const COMPANY = '7cd815f0-c239-4ebe-869e-66c4f26f041c';
  const SEITE = 50;

  async function alleSeiten(resource) {
    const alles = [];

    for (let page = 0; ; page += 1) {
      const url = `/api/v1/company/${resource}`
        + `?companyID=${COMPANY}&page=${page}&pageSize=${SEITE}&search=`;
      const antwort = await fetch(url, { credentials: 'include' });

      if (!antwort.ok) {
        throw new Error(`${resource}, Seite ${page}: HTTP ${antwort.status}`);
      }

      const daten = await antwort.json();
      /* Die Schnittstelle antwortet je nach Endpunkt mal als reines Array,
         mal in einer Hülle. Beides zulassen, statt auf eine Form zu wetten. */
      const stapel = Array.isArray(daten)
        ? daten
        : (daten.content || daten.items || daten.data || daten.results || []);

      alles.push(...stapel);
      console.log(`  ${resource}: ${alles.length} geholt`);

      if (stapel.length < SEITE) {
        return alles;
      }
    }
  }

  console.log('Export läuft…');

  const kunden = await alleSeiten('customers');
  const rechnungen = await alleSeiten('invoices');

  const paket = {
    quelle: 'onlydesk',
    companyID: COMPANY,
    erstellt: new Date().toISOString(),
    anzahl: { kunden: kunden.length, rechnungen: rechnungen.length },
    kunden,
    rechnungen
  };

  const name = `onlydesk-export-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(paket, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');

  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  console.log(`Fertig: ${kunden.length} Kunden, ${rechnungen.length} Rechnungen → ${name}`);
})();
