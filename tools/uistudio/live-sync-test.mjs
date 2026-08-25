/**
 * Prüft die Abgleich-Mechanik des UI Studios: was beim Tippen und Ziehen des
 * einen über die Leitung geht, und was beim anderen daraus wird.
 *
 *   node tools/uistudio/live-sync-test.mjs
 *
 * Der Prüfling steht mitten in uistudio-audio.html, weil das Werkzeug eine
 * einzige Datei ist. Statt ihn zu verdoppeln — und die Kopie dann altern zu
 * lassen — wird der Abschnitt „Gemeinsam arbeiten" hier herausgeschnitten und
 * mit Attrappen für die Oberfläche ausgeführt. Verschiebt sich der Abschnitt,
 * schlägt der Test mit einer klaren Meldung fehl statt still nichts zu prüfen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(hier, 'uistudio-audio.html'), 'utf8');

/* Zwei Abschnitte, weil das Rueckgaengig oben bei der History steht und die
   Abgleich-Mechanik weiter unten — beide gehoeren aber zusammen geprueft. */
const ABSCHNITTE = [
  ['/* ============================== History ==============================', 'function autosave(){'],
  ['/* ====================== Gemeinsam arbeiten ======================', '/* Cloud-Knoepfe mit Icon bestuecken']
];

const quellteile = ABSCHNITTE.map(([anfang, ende]) => {
  const von = html.indexOf(anfang);
  const bis = html.indexOf(ende, von);
  if (von === -1 || bis === -1) {
    console.error(`Abschnitt nicht auffindbar: ${anfang.slice(0, 60)} …`);
    console.error('Wurde er umbenannt oder verschoben? Dann hier die Marken nachziehen.');
    process.exit(1);
  }
  return html.slice(von, bis);
});

/* Attrappen für alles, was der Abschnitt aus dem übrigen Werkzeug benutzt.
   Sie tun nichts — geprüft wird der Zustand von `project`, nicht das Bild. */
const rahmen = `
let project = null, sel = null, zoom = 1;
let undoStack = [], redoStack = [];
const byId = id => project.elements.find(e => e.id === id);
const $ = () => ({ value: '', classList: { remove(){}, add(){} } });
function maskenCacheLeeren(){}
/* autosave() ruft im Werkzeug den Abgleich an; hier wird nur der Zustand von
   \`project\` geprueft, also bleibt es leer. */
function autosave(){}
function recountIds(){}
function renderAll(){}
const document = {
  getElementById: () => null,
  addEventListener: () => {},
  createElement: () => ({ style:{}, appendChild(){}, remove(){} })
};
const performance = { now: () => 0 };
const window = {};
const localStorage = { setItem(){}, getItem(){ return null; }, removeItem(){} };
const clearTimeout = globalThis.clearTimeout;
const setTimeout = globalThis.setTimeout;
`;

const bauen = new Function(`
  ${rahmen}
  ${quellteile.join('\n')}
  return {
    liveDifferenz, liveEinspielen, undo, redo, pushHistory, liveFremdFelder,
    setProject: p => { project = p; }, getProject: () => project
  };
`);

const { liveDifferenz, liveEinspielen, undo, pushHistory, liveFremdFelder, setProject, getProject } = bauen();

/* --------------------------------------------------------------------- */

let fehler = 0;
function pruefe(name, bedingung, gesehen) {
  if (bedingung) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FEHL  ${name}${gesehen === undefined ? '' : ` — gesehen: ${JSON.stringify(gesehen)}`}`);
    fehler += 1;
  }
}

const basis = () => ({
  name: 'EQ', win: { w: 1000, h: 560 }, bg: null, bgTop: 0, assets: {}, groups: [],
  elements: [
    { id: 'e1', type: 'knob', x: 10, y: 10, w: 40, h: 40, label: 'Freq' },
    { id: 'e2', type: 'knob', x: 60, y: 10, w: 40, h: 40, label: 'Gain' }
  ]
});
const klon = (o) => JSON.parse(JSON.stringify(o));

console.log('\nWas gesendet wird');

{
  const neu = basis(); neu.elements[0].x = 99;
  const d = liveDifferenz(basis(), neu);
  pruefe('nur das geänderte Feld, nicht das ganze Element',
    JSON.stringify(d.elements.teil) === '{"e1":{"x":99}}', d.elements.teil);
}
{
  const neu = basis(); neu.elements.push({ id: 'e3', type: 'fader', x: 5, y: 5, w: 20, h: 80 });
  const d = liveDifferenz(basis(), neu);
  pruefe('neues Element vollständig', Object.keys(d.elements.neu).join() === 'e3');
}
{
  const neu = basis(); neu.elements = neu.elements.filter((e) => e.id !== 'e2');
  const d = liveDifferenz(basis(), neu);
  pruefe('gelöschtes Element gemeldet', d.elements.weg.join() === 'e2');
}
{
  pruefe('unverändert heißt: nichts senden', liveDifferenz(basis(), basis()) === null);
}
{
  const neu = basis();
  neu.assets = { as_1: { name: 'knopf.png', dataUrl: 'data:image/png;base64,AAAA', w: 2, h: 2 } };
  const d = liveDifferenz(basis(), neu);
  pruefe('Grafiken werden nur angekündigt', d.grafiken === true);
  /* Das ist die wichtige Zusicherung: ein eingebettetes Bild ist größer als
     eine Realtime-Nachricht sein darf. Ginge es doch mit, bräche die
     Verbindung genau dann, wenn jemand eine Grafik einfügt. */
  pruefe('kein Bild in der Nachricht', !JSON.stringify(d).includes('base64'));
}

console.log('\nWas beim anderen ankommt');

{
  const dort = basis(); dort.elements[0].x = 99; dort.name = 'EQ neu';
  setProject(basis());
  liveEinspielen(liveDifferenz(basis(), dort));
  pruefe('beide Seiten sind gleich',
    JSON.stringify(getProject().elements) === JSON.stringify(dort.elements)
    && getProject().name === 'EQ neu');
}
{
  /* Der Kern der Zusage: gleichzeitig am selben Element, aber an
     verschiedenen Feldern, kostet nichts. */
  const einer = basis(); einer.elements[0].x = 500;
  const anderer = basis(); anderer.elements[0].label = 'Cutoff';
  setProject(basis());
  liveEinspielen(liveDifferenz(basis(), einer));
  liveEinspielen(liveDifferenz(basis(), anderer));
  const e = getProject().elements[0];
  pruefe('je Feld, nicht je Element', e.x === 500 && e.label === 'Cutoff', e);
}
{
  const dort = basis(); dort.elements = [dort.elements[1], dort.elements[0]];
  setProject(basis());
  liveEinspielen(liveDifferenz(basis(), dort));
  pruefe('Stapelreihenfolge wandert mit',
    getProject().elements.map((e) => e.id).join() === 'e2,e1',
    getProject().elements.map((e) => e.id));
}
{
  /* Wer ein Element löscht, während der andere es noch verschiebt, darf es
     nicht als halbe Leiche zurückbekommen. */
  const hier = basis(); hier.elements = hier.elements.filter((e) => e.id !== 'e2');
  const dort = basis(); dort.elements[1].x = 777;
  setProject(hier);
  liveEinspielen(liveDifferenz(basis(), dort));
  pruefe('kein halbes Element aus einem Feld-Update',
    getProject().elements.length === 1 && getProject().elements[0].id === 'e1',
    getProject().elements.map((e) => e.id));
}
{
  /* Nach dem Einspielen muss der Schatten dem Stand entsprechen, sonst
     schickt der Empfänger die fremde Änderung sofort wieder zurück und die
     beiden werfen sie sich endlos zu. */
  setProject(basis());
  const dort = basis(); dort.elements[0].y = 42;
  liveEinspielen(liveDifferenz(basis(), dort));
  pruefe('kein Echo zurück', liveDifferenz(klon(getProject()), getProject()) === null);
}

console.log('\nRückgängig, während der andere arbeitet');

{
  /* Allein: unverändertes Verhalten, der Schnappschuss wird schlicht
     aufgelegt. Das ist die Zusicherung, dass die neue Mechanik nichts
     kaputtmacht, solange niemand sonst da ist. */
  liveFremdFelder.clear();
  setProject(basis());
  pushHistory();
  getProject().elements[0].x = 300;
  undo();
  pruefe('allein: genau wie vorher', getProject().elements[0].x === 10, getProject().elements[0].x);
}
{
  /* Zu zweit: ich schiebe e1, der andere schiebt derweil e2. Mein
     Rückgängig muss e1 zurückholen und e2 stehen lassen. */
  liveFremdFelder.clear();
  setProject(basis());
  pushHistory();
  getProject().elements[0].x = 300;                  // meine Änderung
  liveEinspielen({ elements: { teil: { e2: { x: 888 } }, neu: {}, weg: [], reihe: null } });
  undo();
  const p = getProject();
  pruefe('meins zurück, seins bleibt',
    p.elements[0].x === 10 && p.elements[1].x === 888,
    { e1: p.elements[0].x, e2: p.elements[1].x });
}
{
  /* Der andere legt ein Element an, ich mache meinen letzten Schritt
     rückgängig — sein Element darf nicht mit verschwinden. */
  liveFremdFelder.clear();
  setProject(basis());
  pushHistory();
  getProject().elements[0].y = 200;
  liveEinspielen({ elements: { neu: { e9: { id: 'e9', type: 'label', x: 1, y: 1, w: 5, h: 5 } }, teil: {}, weg: [], reihe: null } });
  undo();
  pruefe('sein neues Element überlebt',
    getProject().elements.some((e) => e.id === 'e9') && getProject().elements[0].y === 10,
    getProject().elements.map((e) => e.id));
}
{
  /* Fasse ich ein Feld selbst an, das vorher von ihm kam, gehört es wieder
     mir — sonst wäre es für immer vor meinem Rückgängig geschützt. */
  liveFremdFelder.clear();
  setProject(basis());
  liveEinspielen({ elements: { teil: { e1: { x: 555 } }, neu: {}, weg: [], reihe: null } });
  pruefe('fremdes Feld ist vermerkt', liveFremdFelder.has('e1|x'));
  pushHistory();
  getProject().elements[0].x = 700;                  // jetzt fasse ich es an
  liveFremdFelder.delete('e1|x');                    // das tut liveAbgleich beim Senden
  undo();
  pruefe('danach wieder meins', getProject().elements[0].x === 555, getProject().elements[0].x);
}

console.log(fehler === 0
  ? '\nALLE PRÜFUNGEN BESTANDEN\n'
  : `\n${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN\n`);
process.exit(fehler === 0 ? 0 : 1);
