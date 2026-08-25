/**
 * EQ-Kurve für das Steinbach UI Studio.
 *
 * Eine Elementart, die der Editor bisher nicht hatte: eine Anzeigefläche mit
 * ziehbaren Bandpunkten, Frequenzachse und dem summierten Frequenzgang. Knob,
 * Fader, Button, Text und Bild reichen dafür nicht — die Kurve ist keine
 * Grafik, sie entsteht aus den Bandwerten.
 *
 * WOHER DIE ZAHLEN KOMMEN
 *
 * Die Filtermathematik ist Zeile für Zeile aus `Source/DSP/EQBand.h` des
 * Plug-ins übernommen (computeCoefficients, magnitudeAt, buildHP/buildLP und
 * die Butterworth-Güten). Darstellung, Achsen und Mausverhalten stammen aus
 * `MaxPort/device/steinbach_eq_curve.js`, das seinerseits
 * `Source/GUI/EQDisplay.cpp` nachbildet.
 *
 * Das ist bewusst eine PORTIERUNG und keine Neuerfindung: es gibt die Kurve
 * damit dreimal — im Plug-in, im Max-Gerät und hier — und drei Fassungen, die
 * sich unterschiedlich verhalten, wären schlimmer als eine, die man an einer
 * Stelle nachzieht. Ändert sich EQBand.h, gehört das hier mitgezogen; die
 * Prüfungen in tools/uistudio/eqcurve-test.mjs schlagen dann an.
 *
 * NICHT ÜBERNOMMEN, weil dafür laufende Audiodaten nötig wären: das
 * FFT-Spektrum, das Aurora-Resonanzoverlay und der Ghost-Bereich des
 * Dynamic EQ. Der Frequenzachsen-Zoom fehlt ebenfalls.
 */
(function () {
  'use strict';

  // ── Konstanten aus EQDisplay.h ────────────────────────────────────────────
  var BAENDER = 8;
  var GAIN_RANGE_DB = 24.0;
  var PAD_L = 40.0, PAD_R = 10.0, PAD_T = 8.0, PAD_B = 16.0;
  var MIN_HZ = 20.0, MAX_HZ = 20000.0;
  var TREFFER_R = 14.0;
  var PUNKTE = 129;                 // SteinbachEngine::EQ_CURVE_POINTS

  var TYP_NAMEN = ['Low Cut', 'Low Shelf', 'Bell', 'Notch', 'High Shelf', 'High Cut', 'Band Pass'];
  // EQDisplay.cpp, kFTColours
  var TYP_FARBEN = ['#ff5040', '#ffaa40', '#40a8ff', '#bb60ff', '#40d8c0', '#6090ff', '#70d870'];

  var FARBEN = {
    grund:      '#0a0d12',
    gitterHaupt:'rgba(85,85,85,0.45)',
    gitterFein: 'rgba(48,48,48,0.35)',
    gitterNull: 'rgba(102,102,102,0.65)',
    kurve:      '#40a8ff',
    fuellung:   'rgba(32,128,255,0.19)',
    schrift:    'rgba(217,219,224,0.9)'
  };

  // Aus PluginProcessor.cpp, createParameterLayout()
  var STD_FREQ  = [80, 200, 500, 1000, 2500, 5000, 10000, 16000];
  var STD_TYP   = [0, 1, 2, 2, 2, 2, 4, 5];
  var STD_SLOPE = 12;
  var STD_Q     = 0.7071;

  function neueBaender() {
    var b = [];
    for (var i = 0; i < BAENDER; i++) {
      b.push({
        /* Band 1 und 8 sind Cut-Filter und stehen im Plug-in aus, damit es
           auf einem Insert wirklich flach ist. */
        on: !(i === 0 || i === BAENDER - 1),
        type: STD_TYP[i], freq: STD_FREQ[i], gain: 0, q: STD_Q, slope: STD_SLOPE
      });
    }
    return b;
  }

  // ── Filter: Koeffizienten, aus EQBand.h ───────────────────────────────────
  // Ein Abschnitt ist [b0, b1, b2, a1, a2].
  var BUTTER_Q = {
    2: [0.70710678],
    3: [1.00000000],                                     // + Abschnitt 1. Ordnung
    4: [0.54119610, 1.30656296],
    5: [0.61803399, 1.61803399],                         // + 1. Ordnung
    6: [0.51763809, 0.70710678, 1.93185165],
    7: [0.55496439, 0.80193774, 2.24697960],             // + 1. Ordnung
    8: [0.50979558, 0.60134489, 0.89997622, 2.56291544]
  };

  function hp1(f, sr) {
    var K = Math.tan(Math.PI * f / sr), d = 1 + K;
    return [1 / d, -1 / d, 0, (K - 1) / d, 0];
  }
  function lp1(f, sr) {
    var K = Math.tan(Math.PI * f / sr), d = 1 + K;
    return [K / d, K / d, 0, (K - 1) / d, 0];
  }
  function hp2(f, q, sr) {
    var w0 = 2 * Math.PI * f / sr, a = Math.sin(w0) / (2 * q), c = Math.cos(w0), d = 1 + a;
    return [(1 + c) / (2 * d), -(1 + c) / d, (1 + c) / (2 * d), -2 * c / d, (1 - a) / d];
  }
  function lp2(f, q, sr) {
    var w0 = 2 * Math.PI * f / sr, a = Math.sin(w0) / (2 * q), c = Math.cos(w0), d = 1 + a;
    return [(1 - c) / (2 * d), (1 - c) / d, (1 - c) / (2 * d), -2 * c / d, (1 - a) / d];
  }

  /* Ungerade Ordnungen brauchen zusätzlich einen Abschnitt erster Ordnung —
     genau die Aufteilung aus buildHP/buildLP. */
  function kaskade(hoch, f, ordnung, qSkala, sr) {
    var aus = [];
    var erste = (ordnung === 1 || ordnung === 3 || ordnung === 5 || ordnung === 7);
    if (ordnung === 1) return [hoch ? hp1(f, sr) : lp1(f, sr)];
    if (erste) aus.push(hoch ? hp1(f, sr) : lp1(f, sr));
    var tabelle = BUTTER_Q[Math.min(8, Math.max(2, ordnung))] || BUTTER_Q[8];
    for (var i = 0; i < tabelle.length; i++) {
      aus.push(hoch ? hp2(f, tabelle[i] * qSkala, sr) : lp2(f, tabelle[i] * qSkala, sr));
    }
    return aus;
  }

  /**
   * Liefert { abschnitte, abschnitteHoch, mischung } für ein Band.
   * Bei Cut-Filtern wird zwischen zwei benachbarten Ordnungen überblendet,
   * damit die Flankensteilheit stufenlos wirkt — dieselbe Rechnung wie im
   * Plug-in, sonst sähe die Kurve zwischen 12 und 18 dB/oct anders aus als
   * sie klingt.
   */
  function koeffizienten(band, sr) {
    var f = Math.min(Math.max(band.freq, 20), sr * 0.4998);
    var w0 = 2 * Math.PI * f / sr;
    var sinW = Math.sin(w0), cosW = Math.cos(w0);
    var A = Math.pow(10, band.gain / 40);
    var q = Math.max(band.q, 0.01);
    var alpha = sinW / (2 * q);
    var a0;

    switch (band.type) {
      case 2: {   // Bell
        a0 = 1 + alpha / A;
        return { abschnitte: [[(1 + alpha * A) / a0, -2 * cosW / a0, (1 - alpha * A) / a0,
                               -2 * cosW / a0, (1 - alpha / A) / a0]] };
      }
      case 1: {   // Low Shelf
        var sa = 2 * Math.sqrt(A) * alpha;
        a0 = (A + 1) + (A - 1) * cosW + sa;
        return { abschnitte: [[A * ((A + 1) - (A - 1) * cosW + sa) / a0,
                               2 * A * ((A - 1) - (A + 1) * cosW) / a0,
                               A * ((A + 1) - (A - 1) * cosW - sa) / a0,
                               -2 * ((A - 1) + (A + 1) * cosW) / a0,
                               ((A + 1) + (A - 1) * cosW - sa) / a0]] };
      }
      case 4: {   // High Shelf
        var sb = 2 * Math.sqrt(A) * alpha;
        a0 = (A + 1) - (A - 1) * cosW + sb;
        return { abschnitte: [[A * ((A + 1) + (A - 1) * cosW + sb) / a0,
                               -2 * A * ((A - 1) + (A + 1) * cosW) / a0,
                               A * ((A + 1) + (A - 1) * cosW - sb) / a0,
                               2 * ((A - 1) - (A + 1) * cosW) / a0,
                               ((A + 1) - (A - 1) * cosW - sb) / a0]] };
      }
      case 3: {   // Notch
        a0 = 1 + alpha;
        return { abschnitte: [[1 / a0, -2 * cosW / a0, 1 / a0, -2 * cosW / a0, (1 - alpha) / a0]] };
      }
      case 6: {   // Band Pass
        a0 = 1 + alpha;
        return { abschnitte: [[(sinW * 0.5) / a0, 0, -(sinW * 0.5) / a0,
                               -2 * cosW / a0, (1 - alpha) / a0]] };
      }
      case 0:     // Low Cut
      case 5: {   // High Cut
        var hoch = (band.type === 0);
        var geklemmt = Math.min(Math.max(band.slope, 6), 48);
        var genau = geklemmt / 6;
        var unten = Math.max(1, Math.floor(genau));
        var oben = Math.min(8, unten + 1);
        var mischung = genau - unten;
        var qSkala = Math.min(q / 0.70710678, 5);
        var r = { abschnitte: kaskade(hoch, f, unten, qSkala, sr) };
        if (mischung > 1e-5 && mischung < 1 - 1e-5) {
          r.abschnitteHoch = kaskade(hoch, f, oben, qSkala, sr);
          r.mischung = mischung;
        }
        return r;
      }
      default:
        return { abschnitte: [[1, 0, 0, 0, 0]] };
    }
  }

  function abschnittBetrag(c, freq, sr) {
    var w = 2 * Math.PI * freq / sr;
    var cw = Math.cos(w), sw = Math.sin(w);
    var c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
    var nRe = c[0] + c[1] * cw + c[2] * c2w;
    var nIm = -(c[1] * sw + c[2] * s2w);
    var dRe = 1 + c[3] * cw + c[4] * c2w;
    var dIm = -(c[3] * sw + c[4] * s2w);
    var d2 = dRe * dRe + dIm * dIm;
    if (d2 < 1e-30) return 1;
    return Math.sqrt((nRe * nRe + nIm * nIm) / d2);
  }

  /** Betrag eines Bandes bei einer Frequenz. Ausgeschaltet heißt 1,0 —
      genau wie EQBandProcessor::magnitudeAt, weshalb ein ausgeschaltetes
      Band die Kurve nie bewegt, egal wie seine Werte stehen. */
  function betrag(band, freq, sr) {
    if (!band.on) return 1;
    var k = koeffizienten(band, sr);
    var i, m = 1;
    if (k.abschnitteHoch) {
      var mLo = 1, mHi = 1;
      for (i = 0; i < k.abschnitte.length; i++) mLo *= abschnittBetrag(k.abschnitte[i], freq, sr);
      for (i = 0; i < k.abschnitteHoch.length; i++) mHi *= abschnittBetrag(k.abschnitteHoch[i], freq, sr);
      var t = k.mischung * (Math.PI * 0.5);
      return Math.cos(t) * mLo + Math.sin(t) * mHi;
    }
    for (i = 0; i < k.abschnitte.length; i++) m *= abschnittBetrag(k.abschnitte[i], freq, sr);
    return m;
  }

  /** Summenkurve in dB, log-verteilt — wie SteinbachEngine::computeEQCurveDb. */
  function kurveDb(baender, sr, punkte) {
    var n = punkte || PUNKTE;
    var lo = Math.log(MIN_HZ) / Math.LN10, hi = Math.log(MAX_HZ) / Math.LN10;
    var aus = new Array(n);
    for (var p = 0; p < n; p++) {
      var f = Math.pow(10, lo + (p / (n - 1)) * (hi - lo));
      var mag = 1;
      for (var b = 0; b < baender.length; b++) mag *= betrag(baender[b], f, sr);
      aus[p] = 20 * Math.log(Math.max(mag, 1e-6)) / Math.LN10;
    }
    return aus;
  }

  // ── Abbildung Fläche ↔ Werte ─────────────────────────────────────────────
  function feld(w, h) {
    return { l: PAD_L, t: PAD_T,
             w: Math.max(2, w - PAD_L - PAD_R),
             h: Math.max(2, h - PAD_T - PAD_B) };
  }
  function freqZuX(f, fl) {
    var lo = Math.log(MIN_HZ) / Math.LN10, hi = Math.log(MAX_HZ) / Math.LN10;
    var c = Math.min(Math.max(f, MIN_HZ), MAX_HZ);
    return fl.l + fl.w * (Math.log(c) / Math.LN10 - lo) / (hi - lo);
  }
  function xZuFreq(x, fl) {
    var lo = Math.log(MIN_HZ) / Math.LN10, hi = Math.log(MAX_HZ) / Math.LN10;
    var t = Math.min(Math.max((x - fl.l) / fl.w, 0), 1);
    return Math.pow(10, lo + t * (hi - lo));
  }
  function gainZuY(db, fl) {
    var d = Math.min(Math.max(db, -GAIN_RANGE_DB), GAIN_RANGE_DB);
    return fl.t + fl.h * (GAIN_RANGE_DB - d) / (2 * GAIN_RANGE_DB);
  }
  function yZuGain(y, fl) {
    var roh = GAIN_RANGE_DB - 2 * GAIN_RANGE_DB * (y - fl.t) / fl.h;
    return Math.min(Math.max(roh, -GAIN_RANGE_DB), GAIN_RANGE_DB);
  }
  function hatGain(typ) { return typ === 1 || typ === 2 || typ === 4; }
  function istCut(typ) { return typ === 0 || typ === 5; }

  function punktLage(band, fl) {
    return [freqZuX(band.freq, fl), gainZuY(hatGain(band.type) ? band.gain : 0, fl)];
  }

  /** Welcher Bandpunkt liegt unter (x,y)? Bei Cut-Filtern zählt nur der
      waagerechte Abstand — ihr Punkt sitzt immer auf der Null-Linie. */
  function treffer(baender, x, y, w, h) {
    var fl = feld(w, h), best = -1, dBest = TREFFER_R;
    for (var i = 0; i < baender.length; i++) {
      var p = punktLage(baender[i], fl);
      var d = istCut(baender[i].type)
        ? Math.abs(p[0] - x)
        : Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y));
      if (d < dBest) { dBest = d; best = i; }
    }
    return best;
  }

  // ── Zeichnen ─────────────────────────────────────────────────────────────
  function zeichnen(ctx, w, h, baender, sr, zustand) {
    var z = zustand || {};
    var fl = feld(w, h);

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = FARBEN.grund;
    ctx.fillRect(0, 0, w, h);

    // Gitter: Dekaden kräftig, 2..9 fein, alle 6 dB waagerecht
    ctx.lineWidth = 1;
    var haupt = [20, 100, 1000, 10000, 20000], namen = ['20', '100', '1k', '10k', '20k'], i, x, y;
    ctx.strokeStyle = FARBEN.gitterFein;
    ctx.beginPath();
    for (var dek = 10; dek <= 10000; dek *= 10) {
      for (var m = 2; m <= 9; m++) {
        var f = dek * m;
        if (f < MIN_HZ || f > MAX_HZ) continue;
        x = Math.round(freqZuX(f, fl)) + 0.5;
        ctx.moveTo(x, fl.t); ctx.lineTo(x, fl.t + fl.h);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = FARBEN.gitterHaupt;
    ctx.beginPath();
    for (i = 0; i < haupt.length; i++) {
      x = Math.round(freqZuX(haupt[i], fl)) + 0.5;
      ctx.moveTo(x, fl.t); ctx.lineTo(x, fl.t + fl.h);
    }
    ctx.stroke();

    for (var db = -GAIN_RANGE_DB; db <= GAIN_RANGE_DB; db += 6) {
      y = Math.round(gainZuY(db, fl)) + 0.5;
      ctx.strokeStyle = Math.abs(db) < 0.01 ? FARBEN.gitterNull : FARBEN.gitterFein;
      ctx.beginPath(); ctx.moveTo(fl.l, y); ctx.lineTo(fl.l + fl.w, y); ctx.stroke();
    }

    // Beschriftung
    ctx.fillStyle = FARBEN.schrift;
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (i = 0; i < haupt.length; i++) {
      ctx.fillText(namen[i], freqZuX(haupt[i], fl), fl.t + fl.h + 12);
    }
    ctx.textAlign = 'right';
    for (var d2 = -18; d2 <= 18; d2 += 6) {
      if (d2 === 0) continue;
      ctx.fillText((d2 > 0 ? '+' : '') + d2, fl.l - 6, gainZuY(d2, fl) + 3);
    }

    // Summenkurve
    var kurve = kurveDb(baender, sr, PUNKTE);
    var px = function (k) { return fl.l + fl.w * (k / (PUNKTE - 1)); };

    ctx.beginPath();
    ctx.moveTo(px(0), gainZuY(kurve[0], fl));
    for (i = 1; i < PUNKTE; i++) ctx.lineTo(px(i), gainZuY(kurve[i], fl));
    ctx.lineTo(px(PUNKTE - 1), gainZuY(0, fl));
    ctx.lineTo(px(0), gainZuY(0, fl));
    ctx.closePath();
    ctx.fillStyle = FARBEN.fuellung;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px(0), gainZuY(kurve[0], fl));
    for (i = 1; i < PUNKTE; i++) ctx.lineTo(px(i), gainZuY(kurve[i], fl));
    ctx.strokeStyle = FARBEN.kurve;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bandpunkte
    ctx.textAlign = 'center';
    for (i = 0; i < baender.length; i++) {
      var b = baender[i], p = punktLage(b, fl);
      var gewaehlt = (z.gewaehlt === i), drueber = (z.drueber === i);
      var r = gewaehlt ? 9 : (drueber ? 8 : 7);
      var farbe = TYP_FARBEN[Math.min(6, Math.max(0, b.type))];

      ctx.globalAlpha = b.on ? 1 : 0.45;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = farbe; ctx.globalAlpha *= gewaehlt ? 0.85 : 0.6;
      ctx.fill();
      ctx.globalAlpha = b.on ? 1 : 0.45;
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 1, 0, Math.PI * 2);
      ctx.strokeStyle = gewaehlt ? '#ffffff' : farbe;
      ctx.lineWidth = 1.5; ctx.stroke();

      ctx.globalAlpha = b.on ? 0.92 : 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.fillText(String(i + 1), p[0], p[1] + 3.5);
      ctx.globalAlpha = 1;
    }

    // Was ist gewählt? Der Typ hat sonst keine Rückmeldung.
    if (z.gewaehlt >= 0 && z.gewaehlt < baender.length) {
      var g = baender[z.gewaehlt];
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px Arial, sans-serif';
      ctx.fillStyle = TYP_FARBEN[g.type];
      ctx.fillText('Band ' + (z.gewaehlt + 1) + ' · ' + TYP_NAMEN[g.type] +
                   (g.on ? '' : ' (aus)'), fl.l + 4, fl.t + 12);
    }
    ctx.restore();
  }

  // ── Ziehen ───────────────────────────────────────────────────────────────
  /**
   * Wendet eine Zugbewegung auf ein Band an und liefert die geänderten
   * Felder. Wie im Plug-in: ziehen bewegt Frequenz und Gain, bei Cut-Filtern
   * statt Gain die Flankensteilheit; mit gehaltenem Cmd/Strg die Güte.
   */
  function ziehen(band, x, y, w, h, anker, qModus) {
    var fl = feld(w, h), aend = {};

    if (qModus) {
      var faktor = Math.pow(2, -(y - anker.y) / 100);
      aend.q = Math.min(Math.max(anker.q * faktor, 0.025), 40);
      return aend;
    }

    aend.freq = Math.min(Math.max(xZuFreq(x, fl), 20), 20000);
    if (hatGain(band.type)) {
      /* Der sichtbare Bereich ist +-24 dB, der Parameter geht nur bis +-18 —
         sonst zieht man den Punkt in eine Stellung, die das Plug-in nicht
         annehmen kann. */
      aend.gain = Math.min(Math.max(yZuGain(y, fl), -18), 18);
    } else if (istCut(band.type)) {
      var roh = anker.slope + (anker.y - y) * 0.30;
      aend.slope = Math.min(Math.max(Math.round(roh / 6) * 6, 6), 48);
    }
    return aend;
  }

  window.SteinbachEQKurve = {
    BAENDER: BAENDER,
    TYP_NAMEN: TYP_NAMEN,
    TYP_FARBEN: TYP_FARBEN,
    GAIN_RANGE_DB: GAIN_RANGE_DB,
    neueBaender: neueBaender,
    koeffizienten: koeffizienten,
    betrag: betrag,
    kurveDb: kurveDb,
    zeichnen: zeichnen,
    treffer: treffer,
    ziehen: ziehen,
    hatGain: hatGain,
    istCut: istCut
  };
})();
