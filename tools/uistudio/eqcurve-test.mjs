/**
 * Prüft die portierte Filtermathematik der EQ-Kurve.
 *
 *   node tools/uistudio/eqcurve-test.mjs
 *
 * Geprüft wird nicht gegen die C++-Fassung — die läuft hier nicht —, sondern
 * gegen Aussagen, die für diese Filter zwingend gelten: ein Bell hebt bei
 * seiner Mittenfrequenz genau um seinen Gain an, ein Butterworth-Hochpass
 * liegt bei seiner Eckfrequenz 3,01 dB tiefer, ein Shelf erreicht fern seiner
 * Ecke seinen vollen Gain. Wer die Portierung anfasst und dabei etwas
 * verdreht, verletzt eine davon.
 *
 * Genau deshalb prüft der Test die Physik und nicht ein paar gespeicherte
 * Zahlen: eingefrorene Sollwerte wären auch dann grün, wenn beide Seiten
 * denselben Fehler machten.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const quelle = readFileSync(
  join(hier, '..', '..', 'assets', 'js', 'uistudio-eqcurve.js'), 'utf8');

/* Das Modul hängt sich an `window`. Hier bekommt es eins. */
const window = {};
new Function('window', quelle)(window);
const EQ = window.SteinbachEQKurve;

const SR = 48000;
let fehler = 0;

function pruefe(name, bedingung, gesehen) {
  if (bedingung) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FEHL  ${name}${gesehen === undefined ? '' : ` — gesehen: ${gesehen}`}`);
    fehler += 1;
  }
}

const dB = (band, f) => 20 * Math.log10(EQ.betrag(band, f, SR));
const nah = (a, b, tol) => Math.abs(a - b) < tol;
const band = (o) => Object.assign(
  { on: true, type: 2, freq: 1000, gain: 0, q: 0.7071, slope: 12 }, o);

console.log('\nEinzelne Filter');

{
  // Ein Bell erreicht bei seiner Mittenfrequenz exakt seinen Gain.
  for (const g of [-18, -6, 6, 18]) {
    const v = dB(band({ type: 2, freq: 1000, gain: g, q: 1 }), 1000);
    pruefe(`Bell ${g > 0 ? '+' : ''}${g} dB trifft bei 1 kHz genau`, nah(v, g, 0.02), v.toFixed(3));
  }
}
{
  // Butterworth: bei der Eckfrequenz 1/sqrt(2), also -3,0103 dB — je Ordnung.
  for (const [slope, name] of [[12, '2. Ordnung'], [24, '4. Ordnung'], [48, '8. Ordnung']]) {
    const v = dB(band({ type: 0, freq: 100, slope }), 100);
    pruefe(`Low Cut ${slope} dB/oct (${name}) liegt bei 100 Hz auf -3,01 dB`,
      nah(v, -3.0103, 0.05), v.toFixed(3));
  }
}
{
  /* Flankensteilheit — aber NICHT an der Ecke gemessen. Eine Oktave unter
     der Eckfrequenz steckt der Filter noch im Knie und fällt erst um 9,3 dB
     statt 12 (analytisch: |H|² = ω^2n/(1+ω^2n)). Erst weiter unten stellt
     sich die Nennsteilheit ein. Gemessen wird deshalb zwischen einer und
     zwei Oktaven unterhalb.
     Mein erster Anlauf verlangte hier die 12 dB direkt an der Ecke und war
     damit selbst falsch — der Code stimmte. */
  for (const slope of [12, 24, 48]) {
    const b = band({ type: 0, freq: 400, slope });
    const abfall = dB(b, 200) - dB(b, 100);
    pruefe(`Low Cut ${slope} dB/oct nähert sich unterhalb der Ecke ${slope} dB je Oktave`,
      nah(abfall, slope, slope * 0.06), abfall.toFixed(1));
  }
}
{
  // Shelf: fern der Ecke steht der volle Gain, jenseits davon nichts.
  const ls = band({ type: 1, freq: 200, gain: 12 });
  pruefe('Low Shelf +12 dB erreicht unten seinen vollen Gain', nah(dB(ls, 20), 12, 0.6), dB(ls, 20).toFixed(2));
  pruefe('Low Shelf +12 dB lässt oben alles in Ruhe', nah(dB(ls, 18000), 0, 0.3), dB(ls, 18000).toFixed(2));

  const hs = band({ type: 4, freq: 4000, gain: -9 });
  pruefe('High Shelf -9 dB erreicht oben seinen vollen Gain', nah(dB(hs, 20000), -9, 0.8), dB(hs, 20000).toFixed(2));
  pruefe('High Shelf -9 dB lässt unten alles in Ruhe', nah(dB(hs, 20), 0, 0.3), dB(hs, 20).toFixed(2));
}
{
  // Notch: bei der Kerbfrequenz praktisch nichts, daneben voll durch.
  const n = band({ type: 3, freq: 1000, q: 8 });
  pruefe('Notch reißt bei 1 kHz tief ein', dB(n, 1000) < -40, dB(n, 1000).toFixed(1));
  pruefe('Notch lässt eine Dekade tiefer durch', nah(dB(n, 100), 0, 0.2), dB(n, 100).toFixed(2));

  /* Band Pass: das Plug-in benutzt die RBJ-Form „constant skirt gain,
     peak gain = Q" (b0 = sin(w0)/2, b2 = -sin(w0)/2). Die Spitze steht damit
     auf Q, nicht auf 0 dB — bei Q=2 also +6,02 dB. Das ist so im Original
     (EQBand.h, FilterType::BandPass) und wird hier bewusst mitportiert, nicht
     stillschweigend „geradegezogen". Wer 0 dB auf der Mitte will, braucht die
     andere RBJ-Form (b0 = alpha) — das wäre eine Änderung am Plug-in. */
  for (const q of [0.7071, 1, 2, 4]) {
    const bp = band({ type: 6, freq: 1000, q });
    const soll = 20 * Math.log10(q);
    pruefe(`Band Pass Q=${q} steht auf seiner Mitte auf ${soll.toFixed(2)} dB`,
      nah(dB(bp, 1000), soll, 0.05), dB(bp, 1000).toFixed(3));
  }
  pruefe('Band Pass sperrt tief', dB(band({ type: 6, freq: 1000, q: 2 }), 50) < -20);
}
{
  // Die Überblendung zwischen zwei Ordnungen muss dazwischen liegen und
  // monoton sein — das ist die Stelle, an der eine Portierung gern kippt.
  const beiEcke = (s) => dB(band({ type: 0, freq: 200, slope: s }), 100);
  const s12 = beiEcke(12), s18 = beiEcke(18), s24 = beiEcke(24);
  pruefe('Flankenmischung 18 liegt zwischen 12 und 24',
    s18 < s12 && s18 > s24, `${s12.toFixed(1)} / ${s18.toFixed(1)} / ${s24.toFixed(1)}`);
}
{
  // Ein ausgeschaltetes Band ist Durchgang, egal wie seine Werte stehen —
  // sonst bewegte die Kurve sich für Bänder, die gar nicht arbeiten.
  const aus = band({ on: false, type: 2, freq: 1000, gain: 18, q: 8 });
  pruefe('ausgeschaltetes Band ist genau Durchgang', EQ.betrag(aus, 1000, SR) === 1);
}

console.log('\nSummenkurve');

{
  const kurve = EQ.kurveDb(EQ.neueBaender(), SR);
  const groesste = Math.max(...kurve.map(Math.abs));
  pruefe('Werkseinstellung ist flach', groesste < 0.001, groesste.toExponential(2));
  pruefe('Kurve hat 129 Punkte', kurve.length === 129, kurve.length);
}
{
  // Zwei Bänder übereinander addieren sich in dB.
  const b = EQ.neueBaender();
  b[2] = band({ type: 2, freq: 1000, gain: 6, q: 1 });
  b[3] = band({ type: 2, freq: 1000, gain: 4, q: 1 });
  /* Achtung: Index 64 ist NICHT 1 kHz. Die Mitte des log-Rasters von 20 Hz
     bis 20 kHz ist ihr geometrisches Mittel, 632,5 Hz. Darauf bin ich beim
     Schreiben dieses Tests hereingefallen. */
  const kurve = EQ.kurveDb(b, SR);
  const lo = Math.log10(20), hi = Math.log10(20000);
  const beiHz = (f) => Math.round((Math.log10(f) - lo) / (hi - lo) * 128);
  pruefe('Index 64 ist das geometrische Mittel, nicht 1 kHz',
    nah(Math.pow(10, lo + 64 / 128 * (hi - lo)), 632.46, 0.1));
  const summe = 20 * Math.log10(EQ.betrag(b[2], 1000, SR) * EQ.betrag(b[3], 1000, SR));
  pruefe('zwei Glocken addieren sich in dB', nah(summe, 10, 0.02), summe.toFixed(3));
  pruefe('die Summenkurve trägt das auch', kurve[beiHz(1000)] > 9.5, kurve[beiHz(1000)].toFixed(2));
}
{
  const b = EQ.neueBaender();
  b.forEach((x) => { x.on = false; });
  const kurve = EQ.kurveDb(b, SR);
  pruefe('alles aus heißt überall 0 dB', kurve.every((v) => Math.abs(v) < 1e-9));
}

console.log('\nZiehen');

{
  const b = band({ type: 2, freq: 1000, gain: 0 });
  // Die Anzeige reicht bis +-24 dB, der Parameter nur bis +-18. Ganz oben
  // gezogen darf nicht mehr als 18 herauskommen.
  const aend = EQ.ziehen(b, 500, 0, 1000, 400, { y: 200, q: 1, slope: 12 }, false);
  pruefe('Gain wird auf den Parameterbereich geklemmt', aend.gain === 18, aend.gain);
}
{
  const b = band({ type: 0, freq: 100, slope: 12 });
  const aend = EQ.ziehen(b, 300, 100, 1000, 400, { y: 200, q: 1, slope: 12 }, false);
  pruefe('Flankensteilheit rastet auf Vielfache von 6', aend.slope % 6 === 0, aend.slope);
  pruefe('Flankensteilheit bleibt im Bereich', aend.slope >= 6 && aend.slope <= 48, aend.slope);
}
{
  const b = band({ q: 1 });
  const hoch = EQ.ziehen(b, 500, 100, 1000, 400, { y: 200, q: 1, slope: 12 }, true);
  const runter = EQ.ziehen(b, 500, 300, 1000, 400, { y: 200, q: 1, slope: 12 }, true);
  pruefe('nach oben ziehen macht die Güte schmaler', hoch.q > 1, hoch.q.toFixed(3));
  pruefe('nach unten ziehen macht sie breiter', runter.q < 1, runter.q.toFixed(3));
}

console.log(fehler === 0
  ? '\nALLE PRÜFUNGEN BESTANDEN\n'
  : `\n${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN\n`);
process.exit(fehler === 0 ? 0 : 1);
