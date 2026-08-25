/**
 * Live-Verbindung für das UI Studio — zwei Leute an derselben Oberfläche.
 *
 * Spricht direkt das Realtime-Protokoll von Supabase (Phoenix-Kanäle über
 * WebSocket). Kein SDK: die Seite hat keinen Bauschritt, und der Teil des
 * Protokolls, den wir brauchen — beitreten, senden, mithören, Anwesenheit —
 * sind die vier Nachrichtenarten weiter unten. Ein nachgeladenes Bündel wäre
 * mehr Gewicht und weniger einsehbar als diese Datei.
 *
 * Die Kanäle sind PRIVAT (`private: true`). Der anon-Key ist öffentlich, und
 * die Themennamen sind die Projekt-Slugs — ohne diese Kennzeichnung könnte
 * jeder mithören, der einen Namen errät. Wer darf, entscheidet Postgres über
 * die Policies in 0010_uistudio_audio.sql.
 *
 * Was hier NICHT passiert: Konfliktauflösung. Diese Datei transportiert nur.
 * Was eine Änderung bedeutet und wer bei Gleichstand gewinnt, steht im Studio
 * selbst (uistudio-audio.html, Abschnitt „Gemeinsam arbeiten").
 */
(function () {
  'use strict';

  var VSN = '1.0.0';
  var HERZSCHLAG_MS = 25000;   // Server trennt nach 60 s Stille
  var WARTEZEITEN = [1000, 2000, 4000, 8000, 15000, 30000];

  /**
   * @param {object} o
   * @param {string} o.raum          Thema ohne Präfix, z. B. "steinbach-eq"
   * @param {function} o.holeToken   () -> Promise<string> — frisches JWT
   * @param {object} o.ich           beliebige Daten, die die anderen sehen
   * @param {function} o.aufOp       (name, daten, vonWem) bei fremder Änderung
   * @param {function} o.aufAnwesend (liste) bei jeder Änderung der Runde
   * @param {function} o.aufZustand  ('verbunden'|'getrennt'|'fehler', text)
   */
  function verbinden(o) {
    var cfg = window.STORE_CONFIG;
    var thema = 'realtime:uistudio-audio:' + o.raum;
    var meineKennung = 'u' + Math.random().toString(36).slice(2, 10);

    var ws = null;
    var zaehler = 0;
    var herzschlag = null;
    var versuche = 0;
    var beendet = false;
    var offen = false;
    /* Änderungen, die entstanden sind, während die Leitung weg war. Sie gehen
       raus, sobald wieder jemand zuhört — sonst verliert der, dessen WLAN
       kurz weg war, genau die Arbeit aus dieser Zeit. */
    var wartend = [];

    function naechsteRef() { zaehler += 1; return String(zaehler); }

    function sende(nachricht) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(nachricht));
      return true;
    }

    function beitreten(token) {
      sende({
        topic: thema,
        event: 'phx_join',
        payload: {
          config: {
            /* self:false — die eigene Änderung ist im Bild schon angewandt,
               sie käme sonst ein zweites Mal zurück und ließe das Ziehen
               springen. */
            broadcast: { self: false, ack: false },
            presence: { key: meineKennung },
            private: true
          },
          access_token: token
        },
        ref: naechsteRef(),
        join_ref: '1'
      });
    }

    function anwesenheitMelden() {
      sende({
        topic: thema,
        event: 'presence',
        payload: {
          type: 'presence',
          event: 'track',
          payload: Object.assign({ kennung: meineKennung }, o.ich)
        },
        ref: naechsteRef()
      });
    }

    /* Presence kommt als { kennung: [{ metas… }] }. Die Oberfläche will eine
       schlichte Liste, und sich selbst nicht darin. */
    function ausPresence(zustand) {
      var liste = [];
      Object.keys(zustand || {}).forEach(function (schluessel) {
        var eintraege = zustand[schluessel] && zustand[schluessel].metas;
        if (!eintraege || !eintraege.length) return;
        var m = eintraege[eintraege.length - 1];
        if (m.kennung === meineKennung) return;
        liste.push(m);
      });
      return liste;
    }

    var anwesend = {};

    function empfangen(roh) {
      var m;
      try { m = JSON.parse(roh); } catch (e) { return; }
      if (m.topic !== thema && m.topic !== 'phoenix') return;

      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'error') {
        /* Abgelehnt heißt fast immer: keine Berechtigung auf dem Kanal. Ein
           erneuter Versuch ändert daran nichts. */
        o.aufZustand('fehler', 'Kein Zugang zu diesem Projekt.');
        beendet = true;
        if (ws) ws.close();
        return;
      }

      if (m.event === 'phx_reply' && m.ref === '2') {
        /* Antwort auf den Beitritt: ab jetzt läuft es. */
        offen = true;
        versuche = 0;
        o.aufZustand('verbunden', '');
        anwesenheitMelden();
        var stau = wartend.splice(0, wartend.length);
        stau.forEach(function (x) { senden(x.name, x.daten); });
        return;
      }

      if (m.event === 'presence_state') {
        anwesend = m.payload || {};
        o.aufAnwesend(ausPresence(anwesend));
        return;
      }

      if (m.event === 'presence_diff') {
        var d = m.payload || {};
        Object.keys(d.leaves || {}).forEach(function (k) { delete anwesend[k]; });
        Object.keys(d.joins || {}).forEach(function (k) { anwesend[k] = d.joins[k]; });
        o.aufAnwesend(ausPresence(anwesend));
        return;
      }

      if (m.event === 'broadcast' && m.payload) {
        o.aufOp(m.payload.event, m.payload.payload, m.payload.von);
      }
    }

    function aufbauen() {
      if (beendet) return;
      o.aufZustand('getrennt', versuche ? 'Verbindung wird wiederhergestellt …' : 'verbinde …');

      o.holeToken().then(function (token) {
        if (beendet || !token) return;
        var url = cfg.supabaseUrl.replace(/^http/, 'ws') +
          '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.supabaseAnonKey) +
          '&vsn=' + VSN;

        ws = new WebSocket(url);

        ws.onopen = function () {
          zaehler = 1;           // der Beitritt bekommt Ref 2, siehe oben
          beitreten(token);
          herzschlag = setInterval(function () {
            sende({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: naechsteRef() });
          }, HERZSCHLAG_MS);
        };

        ws.onmessage = function (ev) { empfangen(ev.data); };

        ws.onclose = function () {
          offen = false;
          clearInterval(herzschlag);
          if (beendet) return;
          o.aufZustand('getrennt', 'Verbindung unterbrochen — Änderungen werden gesammelt.');
          var wartezeit = WARTEZEITEN[Math.min(versuche, WARTEZEITEN.length - 1)];
          versuche += 1;
          setTimeout(aufbauen, wartezeit);
        };

        ws.onerror = function () { /* onclose kommt gleich danach */ };
      }).catch(function () {
        o.aufZustand('fehler', 'Nicht angemeldet.');
      });
    }

    function senden(name, daten) {
      if (!offen) {
        wartend.push({ name: name, daten: daten });
        return false;
      }
      return sende({
        topic: thema,
        event: 'broadcast',
        payload: { type: 'broadcast', event: name, payload: daten, von: meineKennung },
        ref: naechsteRef()
      });
    }

    aufbauen();

    return {
      kennung: meineKennung,
      senden: senden,
      /* Anwesenheit erneut melden, wenn sich Zeiger oder Auswahl ändern. */
      michMelden: function (daten) {
        o.ich = Object.assign({}, o.ich, daten);
        if (offen) anwesenheitMelden();
      },
      trennen: function () {
        beendet = true;
        clearInterval(herzschlag);
        if (ws) ws.close();
      }
    };
  }

  window.SteinbachLive = { verbinden: verbinden };
})();
