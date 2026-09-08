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

     Beide Dateien laufen gleichzeitig und an derselben Stelle; umgeschaltet
     wird nur, welche zu hoeren ist. Nur so springt der Vergleich nicht in der
     Zeit, und man vergleicht wirklich denselben Takt.

     Uebergeblendet wird ueber 20 ms statt hart geschaltet — ein harter Wechsel
     mitten in der Welle knackt, und dieses Knacken hoert man dann als
     Unterschied zwischen den Fassungen, obwohl es keiner ist.

     Der Ton startet erst auf Klick. Eine Seite, die von allein Krach macht,
     wird geschlossen, bevor irgendein Argument gelesen wurde.

     Solange kein data-quelle gesetzt ist, uebergeht die Schleife das Feld: ein
     Knopf, der eine fehlende Datei anfordert, ist schlimmer als einer, der
     stillsteht.

     DER LAUTHEITSAUSGLEICH LIEGT HIER, nicht in den Dateien. Gemessen (EBU
     R 128, integriert) kamen die Paare unterschiedlich laut an: beim Bell war
     B 1,9 LU lauter, beim Mix A 1,7 LU, bei den Transienten A 2,1 LU. Ohne
     Ausgleich gewinnt schlicht die lautere Fassung, und genau das ist der
     Vorwurf, den diese Seite an andere Plugins richtet.

     Ausgeglichen wird ueber die Verstaerkung im Abspieler, nicht durch
     Umrechnen der Dateien: eine mp3 noch einmal zu kodieren kostet Qualitaet,
     und ausgerechnet auf einer Seite, auf der es ums Hoeren geht, waere das
     der falsche Handel. data-a und data-b tragen die Korrektur in Dezibel,
     angehoben wird nie, nur abgesenkt -- so kann nichts uebersteuern. */
  document.querySelectorAll('.chain .ab').forEach(function (feld) {
    var quelle = feld.dataset.quelle;
    if (!quelle) return;

    var schalter = feld.querySelector('.ab-switch');
    var knoepfe = schalter.querySelectorAll('button');
    var abspielen = feld.querySelector('.ab-play');
    var ctx, quellen, verstaerker, laeuft = false;

    /* Dezibel in einen Faktor. Ohne Angabe bleibt es bei 1, also unveraendert. */
    function faktor(db) {
      var zahl = parseFloat(db);
      return isFinite(zahl) ? Math.pow(10, zahl / 20) : 1;
    }

    var pegel = [faktor(feld.dataset.a), faktor(feld.dataset.b)];

    /* BEIDE DATEIEN GANZ HOLEN, ERST DANN SPIELEN.

       Der naheliegende Weg -- preload="auto" setzen und warten, bis buffered
       die Dauer deckt -- fuehrt in eine Sackgasse: der Browser laedt nur so
       weit vor, wie er zum Anfangen braucht, und bleibt dann stehen, solange
       nichts spielt. Gemessen blieb er bei 60 Prozent haengen und kam nie
       weiter, weil er auf das Abspielen wartete und wir auf ihn.

       Also wird selbst geholt. fetch liefert die ganze Datei, der Fortschritt
       ist echt gezaehlt statt geschaetzt, und die fertigen Bytes gehen als
       blob-Adresse an das Audio-Element. Damit ist garantiert, dass beim
       ersten Ton beide Fassungen vollstaendig da sind und keine mitten im
       Vergleich nachladen muss. */
    function holen(pfad, melden) {
      return fetch(pfad).then(function (antwort) {
        if (!antwort.ok) throw new Error('http ' + antwort.status);

        var gesamt = Number(antwort.headers.get('content-length')) || 0;
        if (!antwort.body || !gesamt) {
          /* Ohne Laengenangabe oder ohne Stromleser: dann eben ohne Anzeige,
             aber weiterhin vollstaendig. */
          return antwort.blob();
        }

        var leser = antwort.body.getReader();
        var stuecke = [];
        var da = 0;

        return (function weiter() {
          return leser.read().then(function (ergebnis) {
            if (ergebnis.done) return new Blob(stuecke);
            stuecke.push(ergebnis.value);
            da += ergebnis.value.length;
            melden(da / gesamt);
            return weiter();
          });
        })();
      });
    }

    function aufbauen() {
      ctx = new (window.AudioContext || window.webkitAudioContext)();

      var pfade = [quelle + '-a.mp3', quelle + '-b.mp3'];
      var stand = [0, 0];

      function anzeigen() {
        var mittel = (stand[0] + stand[1]) / 2;
        abspielen.textContent = 'Loading ' + Math.round(mittel * 100) + ' %';
      }

      return Promise.all(pfade.map(function (pfad, i) {
        return holen(pfad, function (anteil) { stand[i] = anteil; anzeigen(); });
      })).then(function (brocken) {
        quellen = brocken.map(function (blob) {
          var el = new Audio(URL.createObjectURL(blob));
          el.loop = true;
          return el;
        });

        verstaerker = quellen.map(function (el, i) {
          var g = ctx.createGain();
          g.gain.value = i === 0 ? pegel[0] : 0;
          ctx.createMediaElementSource(el).connect(g).connect(ctx.destination);
          return g;
        });
      });
    }

    /* Umschalten heisst ueberblenden, nicht umstecken: 20 ms Rampe. Ein harter
       Wechsel mitten in der Welle knackt, und dieses Knacken hoert man dann als
       Unterschied zwischen den Fassungen, obwohl es keiner ist.

       Die Zielwerte kommen aus pegel[], also aus dem Lautheitsausgleich -- die
       leisere Seite bleibt auf 1, die lautere wird um ihre gemessene Differenz
       abgesenkt. */
    function waehlen(i) {
      knoepfe.forEach(function (k, j) { k.setAttribute('aria-pressed', String(i === j)); });
      schalter.classList.toggle('b', i === 1);

      if (!verstaerker) return;
      var jetzt = ctx.currentTime;
      verstaerker.forEach(function (g, j) {
        g.gain.cancelScheduledValues(jetzt);
        g.gain.setValueAtTime(g.gain.value, jetzt);
        g.gain.linearRampToValueAtTime(i === j ? pegel[j] : 0, jetzt + 0.02);
      });
    }

    knoepfe.forEach(function (knopf, i) {
      knopf.addEventListener('click', function () { waehlen(i); });
    });

    abspielen.addEventListener('click', function () {
      if (laeuft) {
        quellen.forEach(function (el) { el.pause(); });
        laeuft = false;
        abspielen.textContent = 'Play';
        return;
      }

      /* Waehrend des Ladens nicht anklickbar: ein zweiter Klick wuerde ein
         zweites Mal holen und am Ende zweimal abspielen. */
      abspielen.disabled = true;

      var bereit = quellen
        ? Promise.resolve()
        : (abspielen.textContent = 'Loading 0 %', aufbauen());

      bereit
        .then(function () {
          if (ctx.state === 'suspended') return ctx.resume();
        })
        .then(function () {
          /* Gemeinsam auf null, damit beide wirklich denselben Takt spielen. */
          quellen.forEach(function (el) { el.currentTime = 0; });
          return Promise.all(quellen.map(function (el) { return el.play(); }));
        })
        .then(function () { laeuft = true; abspielen.textContent = 'Stop'; })
        .catch(function () { abspielen.textContent = 'Audio unavailable'; })
        .then(function () { abspielen.disabled = false; });
    });
  });

  /* 3. Die Kaufleiste. Beobachtet Kopf und Kaufteil, statt mit Scrollhoehen zu
        rechnen — das ist auf dem Telefon verlaesslicher und in eingebetteten
        Vorschaufenstern ueberhaupt das Einzige, was funktioniert. */
  var leiste = document.getElementById('sticky');
  var kopf = document.querySelector('.chain .hero');
  var kauf = document.getElementById('buy');
  var kopfDa = true, kaufDa = false;

  function pruefen() { leiste.classList.toggle('show', !kopfDa && !kaufDa); }

  if ('IntersectionObserver' in window && leiste && kopf && kauf) {
    new IntersectionObserver(function (e) { kopfDa = e[0].isIntersecting; pruefen(); },
      { threshold: 0 }).observe(kopf);
    new IntersectionObserver(function (e) { kaufDa = e[0].isIntersecting; pruefen(); },
      { threshold: 0.08 }).observe(kauf);
  }

  /* 3b. Der Kopf-Film laeuft mit halber Geschwindigkeit.

         Ueber playbackRate statt ueber eine langsamere Datei: die Vorlage bleibt
         unangetastet, es entsteht kein zweiter Render, und der Wert ist eine
         Zahl statt einer Neukodierung. Preis dafuer: die 24 Bilder je Sekunde
         werden zu effektiv zwoelf, jedes Bild steht doppelt so lange. Bei einer
         so langsamen Fahrt faellt das kaum auf; falls doch, rechnen wir eine
         Fassung mit Zwischenbildern.

         Neu gesetzt wird bei jedem Schleifendurchlauf, weil einige Browser den
         Wert beim Neustart auf eins zuruecksetzen. */
  var kopfFilm = document.getElementById('hero-video');

  /* SCHMALE SCHIRME LADEN KEIN VIDEO. Nicht "spielen es nicht ab", sondern
     laden es nicht: die Quellen stehen als data-src im Markup und werden hier
     erst gesetzt. Ohne src zeigt das Element sein poster, und das ist auf dem
     Handy ohnehin fast das ganze Bild, weil die Schrift darueber liegt.
     Gespart werden damit 1,8 MB auf einer Verbindung, die sie am wenigsten
     hat. Wer kein JavaScript hat, sieht ebenfalls das Standbild. */
  var SCHMAL = window.matchMedia('(max-width: 720px)');

  /* Dieselbe Regel fuer die beiden Fahrten im Text. Sie trugen autoplay, und
     autoplay sticht preload="none": der Browser laedt sie sonst auch dann,
     wenn niemand sie je sieht. */
  if (!SCHMAL.matches) {
    Array.prototype.forEach.call(document.querySelectorAll('.chain video[data-film]'),
      function (f) {
        /* Zwei Bauarten: entweder EINE feste Quelle in data-src, oder mehrere
           source-Zeilen, aus denen der Browser selbst waehlt. Die zweite ist
           dort noetig, wo dasselbe Video schon im Kopfbereich laeuft: nur so
           trifft der Browser dieselbe Datei und nimmt sie aus dem
           Zwischenspeicher, statt fuer dasselbe Bild ein zweites Mal zu laden. */
        var quellen = f.querySelectorAll('source[data-src]');
        if (quellen.length) {
          Array.prototype.forEach.call(quellen,
            function (q) { q.src = q.getAttribute('data-src'); });
          f.load();
        } else {
          f.src = f.getAttribute('data-src');
        }
        var an = function () {
          var q = f.play(); if (q && q.catch) q.catch(function () {});
        };
        an();
        ['loadeddata', 'canplay'].forEach(function (e) { f.addEventListener(e, an); });
      });
  }

  if (kopfFilm && !SCHMAL.matches) {
    Array.prototype.forEach.call(kopfFilm.querySelectorAll('source[data-src]'),
      function (q) { q.src = q.getAttribute('data-src'); });
    kopfFilm.preload = 'auto';
    kopfFilm.load();
    /* Ein play() direkt nach load() kommt zu frueh und wird abgewiesen, ohne
       dass jemand es merkt: das autoplay-Attribut half hier nicht, weil beim
       Auswerten des Markups noch keine Quelle dranstand. Also nach dem Laden
       noch einmal anklopfen, und zwar bei beiden Meldungen -- welche zuerst
       kommt, haengt vom Browser ab. */
    var anlaufen = function () {
      var q = kopfFilm.play(); if (q && q.catch) q.catch(function () {});
    };
    anlaufen();
    ['loadeddata', 'canplay'].forEach(function (e) {
      kopfFilm.addEventListener(e, anlaufen);
    });

    var TEMPO = 0.5;
    var langsam = function () { kopfFilm.playbackRate = TEMPO; };

    langsam();
    ['loadedmetadata', 'play', 'seeked', 'ratechange'].forEach(function (e) {
      kopfFilm.addEventListener(e, function () {
        if (kopfFilm.playbackRate !== TEMPO) langsam();
      });
    });
  }

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
