/* =============================================================================
   chain-page.js — was vorher als zwei <script>-Bloecke in steinbach-chain.html
   stand.

   WARUM AUSGELAGERT: Die Seite kam beim Besucher LEER an. Der Server schickt
   eine Content Security Policy mit script-src 'self', und darin ist kein
   'unsafe-inline'. Beide Bloecke wurden deshalb blockiert. Weil .chain .rise
   mit opacity:0 startet und erst das Skript die Klasse .in setzt, blieb der
   gesamte Inhalt unsichtbar -- die Ueberschriften standen im Quelltext, aber
   nichts davon war zu sehen.

   Die Policy zu lockern waere der falsche Weg gewesen: 'unsafe-inline' haette
   sie fuer die ganze Website ausgehebelt, und zwar dauerhaft. Eine eigene
   Datei erfuellt 'self' und kostet nichts.

   NICHT WIEDER INLINE SCHREIBEN. Jedes <script> ohne src faellt hier still auf
   die Nase, und still heisst: die Seite sieht leer aus und niemand sieht warum.
   ============================================================================= */

/* ERSTE ANWEISUNG, vor allem anderen: dem Dokument sagen, dass das Skript
   laeuft. Erst diese Klasse schaltet in steinbach-chain.html das opacity:0
   der Einblendung ein. Faellt die Datei aus, aus welchem Grund auch immer,
   steht der Inhalt sichtbar da und es fehlt nur der Weg. */
document.documentElement.classList.add('rise-an');

/* ---- Block 1 von 2, unveraendert uebernommen ---- */
/* ---------------------------------------------------------------------------
   Drei kleine Dinge, mehr braucht die Seite nicht.

   Die Rail baut hier NICHT mehr auf: das macht assets/js/steinbach-ui.js fuer
   die ganze Website. Stuende der Bau hier noch einmal, saeszen vierzig Striche
   am Rand statt zwanzig.

   Alles hoert auf prefers-reduced-motion: wer weniger Bewegung eingestellt hat,
   bekommt die Inhalte sofort und ohne Weg, aber nicht weniger Inhalt.
   --------------------------------------------------------------------------- */
(function () {
  var ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1. Eintreten beim Scrollen. Einmal und nie wieder — etwas, das bei jedem
        Vorbeiscrollen erneut hereinfliegt, wird beim zweiten Mal laestig. */
  var teile = document.querySelectorAll('.chain .rise');

  if (!('IntersectionObserver' in window) || ruhig) {
    teile.forEach(function (el) { el.classList.add('in'); });
  } else {
    var beobachter = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        beobachter.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

    teile.forEach(function (el) { beobachter.observe(el); });
  }

  /* 2. Der A/B-Umschalter.

     DAS ABSPIELEN MACHT assets/js/audio-comparison.js, dieselbe Datei wie auf
     der Mixing- und der Mastering-Seite. Hier steht nur noch die Verbindung
     zwischen den beiden sichtbaren Knoepfen und dem versteckten Umschalter,
     den jene Datei erwartet.

     WARUM DER EIGENE ABSPIELER WEG IST. Er baute den Ton ueber
     createMediaElementSource und tauschte danach die Quelle des Elements gegen
     eine blob-Adresse. In Chrome lief das; Safari gab dabei Stille aus, und
     zwar ohne Fehlermeldung. Der gemeinsame Abspieler geht den anderen Weg:
     er holt beide Dateien, dekodiert sie zu Puffern und startet zwei
     AudioBufferSourceNode zur selben Zeit. Das ist nicht nur vertraeglicher,
     es ist auch genauer -- beide Seiten starten auf dasselbe Sample.

     Eine Sache kann er, die hier vorher fehlte: auf Telefonen faellt er auf
     zwei gewoehnliche Audio-Elemente zurueck, statt zwei ganze Stuecke in den
     Speicher zu dekodieren.

     Der Lautheitsausgleich wandert mit: er steht als data-gain-primary und
     data-gain-secondary am Feld und wird dort angewandt. */
  document.querySelectorAll('.chain .ab[data-comparison-id]').forEach(function (feld) {
    var schalter = feld.querySelector('.ab-switch');
    var umschalter = feld.querySelector('.toggle-checkbox');
    if (!schalter || !umschalter) return;

    var knoepfe = schalter.querySelectorAll('button');

    function zeigen(i) {
      knoepfe.forEach(function (k, j) { k.setAttribute('aria-pressed', String(i === j)); });
      schalter.classList.toggle('b', i === 1);
    }

    knoepfe.forEach(function (knopf, i) {
      knopf.addEventListener('click', function () {
        zeigen(i);
        /* Der Umschalter ist die Wahrheit, nicht die Knoepfe: audio-comparison
           liest ihn und hoert auf change. Ohne das ausgeloeste Ereignis
           bliebe der Ton stehen, waehrend die Knoepfe schon umgesprungen
           sind. */
        umschalter.checked = (i === 1);
        umschalter.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    /* Springt der Umschalter woanders um -- etwa weil ein Stueck zu Ende ist
       und zurueckgesetzt wird --, ziehen die Knoepfe nach. */
    umschalter.addEventListener('change', function () {
      zeigen(umschalter.checked ? 1 : 0);
    });
  });

  /* Die Abschnittsleiste ist am 08.09. entfallen, und mit ihr der Beobachter,
     der markierte, in welchem Abschnitt man gerade steht. Er lief bei jedem
     Scrollen ueber fuenf Ziele und hatte danach nichts mehr, dem er es sagen
     konnte. Die Sprungmarken selbst bleiben, sie stehen jetzt im Text. */
})();

/* ---- Block 2 von 2, unveraendert uebernommen ---- */
/* Modulkacheln: Ueberfahren startet, Verlassen haelt an und spult zurueck.
   Weil das Standbild das erste Bild der Schleife ist, sieht man den
   Uebergang nicht. */
(function(){
  var ruhig  = window.matchMedia('(prefers-reduced-motion: reduce)');
  var schmal = window.matchMedia('(max-width: 720px)');
  /* Auf dem Handy bleibt es beim Standbild. Die Kacheln tragen
     preload="none", es faellt also kein Byte, solange niemand sie
     startet -- und starten kann sie hier niemand. */
  if (schmal.matches) return;
  document.querySelectorAll('.chain [data-modul]').forEach(function(box){
    var v = box.querySelector('video');
    if (!v) return;
    function los(){
      if (ruhig.matches) return;          /* Wer weniger Bewegung will, behaelt das Standbild. */
      var q = v.play(); if (q && q.catch) q.catch(function(){});
    }
    function halt(){ v.pause(); try { v.currentTime = 0; } catch(e){} }
    box.addEventListener('mouseenter', los);
    box.addEventListener('mouseleave', halt);
    /* Tastfeld kennt kein Ueberfahren: dort schaltet ein Tippen. Mit Maus
       laeuft das Video beim Klick schon, wird also nicht abgeschaltet. */
    box.addEventListener('click', function(){ v.paused ? los() : halt(); });
    box.addEventListener('focus', los);
    box.addEventListener('blur',  halt);
    box.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); v.paused ? los() : halt(); }
    });
  });
})();
