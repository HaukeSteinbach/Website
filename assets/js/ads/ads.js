/**
 * Werbung — eigener Anzeigen-Manager für Meta und Google.
 *
 * Der Ads Manager von Meta fragt beim Anlegen einer Kampagne nach dreißig
 * Dingen. Hier sind es fünf: Bilder, Zielgruppe, Länder, Budget, Text. Der
 * Rest ist im Backend festgelegt (ads_config.ts) und für beide Plattformen
 * dasselbe.
 *
 * Reine Darstellung — jeder Aufruf geht an die ads-api Edge Function, kein
 * Zugangstoken kommt je in den Browser. Alles wird pausiert angelegt; Start
 * und Stopp sind eigene, ausdrückliche Klicks.
 *
 * Jede Marke hat ihren eigenen Adminbereich: steinbach-instruments.de/admin
 * verwaltet Steinbach Instruments, haukesteinbach.de/werbung.html verwaltet
 * Steinbach Audio. Beide laden diese Datei und rufen dieselbe Funktion, nur
 * mit unterschiedlichem `only`.
 *
 *   SteinbachAds.mount(element, { only: 'steinbach-audio' })
 *
 * Ohne `only` erscheint ein Umschalter über beide Marken — dann liegt die
 * Verantwortung beim Bedienenden, nicht mehr an der Adresse der Seite.
 */
(function () {
  'use strict';

  var store = window.SteinbachStore;
  var cfg = window.STORE_CONFIG;

  function api(action, params) {
    return store.getSession().then(function (s) {
      if (!s) { var e = new Error('signin'); e.code = 401; throw e; }
      return fetch(cfg.supabaseUrl + '/functions/v1/ads-api', {
        method: 'POST',
        headers: {
          'apikey': cfg.supabaseAnonKey,
          'Authorization': 'Bearer ' + s.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(Object.assign({ action: action }, params || {}))
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var text = body.error || ('HTTP ' + res.status);
          /* Der Server kennt die Aktion nicht — das heißt fast immer, dass er
             älter ist als die Oberfläche, und nicht, dass etwas kaputt ist. */
          if (/Unbekannte Aktion/.test(text)) {
            text = 'Der Dienst kennt diese Funktion noch nicht — er ist älter als '
                 + 'diese Oberfläche. Einmal neu ausrollen (ads-assistent.command, '
                 + 'Menüpunkt 3), dann geht es.';
          }
          var e = new Error(text); e.code = res.status; throw e;
        }
        return body;
      });
    });
  }

  var euro = function (c) { return (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €'; };
  var esc = function (s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; };

  var presets = null;      // Ziele, Zielgruppen, Länder — kommen vom Server
  var property = null;     // aktuell gewähltes Objekt (Schlüssel)

  /** Das ausgewählte Objekt als Datensatz. */
  function prop() {
    return presets.properties.filter(function (p) { return p.slug === property; })[0];
  }

  /** Nur die Zielgruppen, die zu diesem Objekt passen. Wer Kirchenorgeln
   *  bewirbt, braucht andere Leute als wer einen Kopfhörer-Renderer bewirbt. */
  function audiencesOf() {
    var erlaubt = prop().audiences || [];
    return presets.audiences.filter(function (a) { return erlaubt.indexOf(a.key) >= 0; });
  }
  var picked = [];         // ausgewählte Bilder: { key, name, width, height }
  var root = null;
  var only = null;         // auf eine Marke festgenagelt?
  var neuBenannt = null;   // zuletzt angelegte Kampagne, wird kurz hervorgehoben

  /* ── Aufbau ───────────────────────────────────────────────────────── */

  function mount(container, opts) {
    root = container;
    only = (opts && opts.only) || null;
    root.innerHTML = '<div class="panel"><p class="hint">Lade …</p></div>';
    api('presets').then(function (p) {
      presets = p;
      if (only) {
        presets.properties = p.properties.filter(function (x) { return x.slug === only; });
        if (!presets.properties.length) {
          throw new Error('Unbekannte Marke in dieser Oberfläche: ' + only);
        }
      }
      property = presets.properties[0].slug;
      render();
      refresh();
    }).catch(fail);
  }

  function fail(err) {
    root.innerHTML = '<div class="panel"><p class="msg err">' + esc(err.message) + '</p></div>';
  }

  function statusChip(connected, label) {
    return '<span style="display:inline-flex;align-items:center;gap:7px;font-family:var(--font-mono);'
      + 'font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:'
      + (connected ? 'var(--brass-bright)' : 'var(--parchment-faint)') + ';">'
      + '<span style="width:7px;height:7px;border-radius:50%;background:'
      + (connected ? 'var(--brass-bright)' : 'var(--parchment-faint)') + ';"></span>'
      + esc(label) + (connected ? '' : ' · nicht verbunden') + '</span>';
  }

  function render() {
    var props = presets.properties.map(function (p) {
      return '<button class="btn btn-mini' + (p.slug === property ? ' btn-fill' : '') + '" '
        + 'data-prop="' + esc(p.slug) + '">' + esc(p.label) + '</button>';
    }).join(' ');

    /* Wer die Oberflaeche lokal ausprobiert, sieht sonst nicht, dass die
       Knoepfe echtes Geld bewegen: der Dienst dahinter ist derselbe wie
       online. Ein Hinweis, der nicht zu uebersehen ist. */
    var lokal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? '<div style="margin:0 0 16px;padding:9px 13px;border:1px solid var(--brass);'
        + 'border-radius:2px;font-family:var(--font-mono);font-size:0.62rem;'
        + 'letter-spacing:0.1em;text-transform:uppercase;color:var(--brass-bright);">'
        + 'Lokale Oberfläche · echter Dienst · echtes Geld</div>'
      : '';

    var kopf = presets.properties.length > 1
      ? '<h2>Marke</h2><div style="display:flex;gap:8px;flex-wrap:wrap;">' + props + '</div>'
      : '<h2>' + esc(prop().label) + '</h2>';

    root.innerHTML =
      lokal
      + '<div class="panel">'
      + kopf
      + '<div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:18px;">'
      + statusChip(presets.platforms.meta.connected, 'Meta')
      + statusChip(presets.platforms.google.connected, 'Google Ads')
      + '</div>'
      + '<div class="hint" id="ads-cap" style="margin-top:14px;"></div>'
      + '<button class="btn btn-mini" id="ads-test" style="margin-top:14px;">Verbindung prüfen</button>'
      + '<div class="hint" id="ads-veraltet" style="margin-top:8px;"></div>'
      + '<div id="ads-test-out"></div>'
      + '</div>'
      + '<div class="panel"><h2>Kampagnen</h2><div id="ads-list"><p class="hint">Lade …</p></div></div>'
      + formPanel();

    root.querySelectorAll('[data-prop]').forEach(function (b) {
      b.addEventListener('click', function () {
        property = b.dataset.prop;
        picked = [];
        render();
        refresh();
      });
    });
    wireForm();

    /* Die Punkte oben sagen nur, ob Zugangsdaten hinterlegt sind. Ob sie
       auch taugen, weiß erst der Server, nachdem er Meta gefragt hat. */
    /* Kennt der Dienst diese Aktion überhaupt? Die Oberfläche liegt auf der
       Website und ist nach jedem Push da; die Funktion muss eigens ausgerollt
       werden. Läuft beides auseinander, sagt es das hier — statt später ein
       „Unbekannte Aktion" zu zeigen, mit dem niemand etwas anfangen kann. */
    if (presets.actions && presets.actions.indexOf('selftest') < 0) {
      var t = document.getElementById('ads-test');
      t.disabled = true;
      t.style.opacity = '0.5';
      document.getElementById('ads-veraltet').innerHTML =
        'Der Dienst ist älter als diese Oberfläche. Zum Prüfen einmal neu '
        + 'ausrollen: <span style="color:var(--brass);">ads-assistent.command '
        + '→ Menüpunkt 3</span>.';
    }

    document.getElementById('ads-test').addEventListener('click', function () {
      var b = this, out = document.getElementById('ads-test-out');
      b.disabled = true; b.textContent = 'Frage nach …';
      api('selftest', { property: property }).then(function (r) {
        b.disabled = false; b.textContent = 'Verbindung prüfen';
        out.innerHTML = ['meta', 'google'].map(function (k) {
          var t = r[k];
          if (!t) return '';
          return '<div style="margin-top:14px;">'
            + '<div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;'
            + 'text-transform:uppercase;color:var(--brass);margin-bottom:6px;">'
            + (k === 'meta' ? 'Meta' : 'Google Ads') + '</div>'
            + t.zeilen.map(function (z) {
                return '<div style="font-family:var(--font-mono);font-size:0.68rem;'
                  + 'line-height:1.8;color:' + (z.gut ? 'var(--parchment-dim)' : '#c96f5a') + ';">'
                  + (z.gut ? '✓' : '✗') + ' ' + esc(z.was) + ': ' + esc(z.wert) + '</div>';
              }).join('')
            + '</div>';
        }).join('');
      }).catch(function (err) {
        b.disabled = false; b.textContent = 'Verbindung prüfen';
        out.innerHTML = '<p class="msg err">' + esc(err.message) + '</p>';
      });
    });
  }

  /* ── Kampagnenliste ───────────────────────────────────────────────── */

  function refresh() {
    api('list', { property: property }).then(function (d) {
      var cap = document.getElementById('ads-cap');
      if (cap) {
        cap.innerHTML = 'Läuft gerade: <span class="em">' + euro(d.runningDailyCents)
          + '</span> am Tag im Werbekonto · Grenze: ' + euro(d.dailyCapCents)
          + '. Gezählt wird alles im Konto, auch die andere Marke. '
          + 'Ein Start darüber hinaus wird abgelehnt.';
      }
      renderList(d);
      renderImages(d.images || []);
    }).catch(function (err) {
      var l = document.getElementById('ads-list');
      if (l) l.innerHTML = '<p class="msg err">' + esc(err.message) + '</p>';
    });
  }

  function renderList(d) {
    var box = document.getElementById('ads-list');
    if (!box) return;
    var hinweise = (d.notes || []).map(function (n) {
      return '<p class="msg err">' + esc(n) + '</p>';
    }).join('');

    if (!d.campaigns.length) {
      box.innerHTML = hinweise + '<p class="hint">Noch keine Kampagne für dieses Objekt.</p>';
      return;
    }

    var rows = d.campaigns.map(function (c) {
      var wort = { active: 'läuft', paused: 'angehalten', pending: 'in Prüfung', error: 'Fehler' }[c.status];
      var farbe = c.status === 'active' ? 'var(--brass-bright)' : 'var(--parchment-faint)';
      var klick = c.status === 'active' ? 'Anhalten' : 'Starten';
      var ctr = c.impressions ? (c.clicks / c.impressions * 100).toFixed(2) + ' %' : '–';
      var frisch = neuBenannt && c.name === neuBenannt;
      return '<tr' + (frisch ? ' style="background:rgba(181,138,74,0.10);"' : '') + '>'
        + '<td><span class="em">' + esc(c.name) + '</span>'
        + (frisch ? ' <span style="font-family:var(--font-mono);font-size:0.55rem;'
            + 'letter-spacing:0.1em;text-transform:uppercase;color:var(--brass-bright);">neu</span>' : '')
        + '<br>'
        + '<span style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.1em;'
        + 'text-transform:uppercase;color:var(--parchment-faint);">' + esc(c.platform) + '</span></td>'
        + '<td style="color:' + farbe + ';">' + wort + '</td>'
        + '<td class="num"><button class="btn btn-mini" data-budget="' + esc(c.id) + '" '
        + 'data-platform="' + esc(c.platform) + '" data-cents="' + c.dailyBudgetCents + '" '
        + 'title="Tagesbudget ändern">' + euro(c.dailyBudgetCents) + '</button></td>'
        + '<td class="num">' + euro(c.spendCents) + '</td>'
        + '<td class="num">' + c.impressions.toLocaleString('de-DE') + '</td>'
        + '<td class="num">' + c.clicks.toLocaleString('de-DE') + '</td>'
        + '<td class="num">' + ctr + '</td>'
        + '<td class="num"><button class="btn btn-mini' + (c.status === 'active' ? ' btn-danger' : '')
        + '" data-toggle="' + esc(c.id) + '" data-platform="' + esc(c.platform) + '" '
        + 'data-active="' + (c.status === 'active' ? '1' : '0') + '">' + klick + '</button> '
        + '<button class="btn btn-mini" data-remove="' + esc(c.id) + '" '
        + 'data-platform="' + esc(c.platform) + '" data-name="' + esc(c.name) + '" '
        + 'title="Kampagne entfernen">×</button></td>'
        + '</tr>';
    }).join('');

    box.innerHTML = hinweise + '<div class="tablewrap"><table>'
      + '<tr><th>Kampagne</th><th>Zustand</th><th class="num">Budget/Tag</th>'
      + '<th class="num">Ausgegeben</th><th class="num">Sichtkontakte</th>'
      + '<th class="num">Klicks</th><th class="num">Klickrate</th><th></th></tr>'
      + rows + '</table></div>';

    box.querySelectorAll('[data-budget]').forEach(function (b) {
      b.addEventListener('click', function () {
        var jetzt = (Number(b.dataset.cents) / 100).toFixed(2);
        var ein = prompt('Neues Tagesbudget in Euro:', jetzt);
        if (ein === null) return;
        var cents = Math.round(parseFloat(ein.replace(',', '.')) * 100);
        if (!isFinite(cents)) { alert('Keine Zahl.'); return; }
        api('setBudget', {
          property: property, platform: b.dataset.platform,
          id: b.dataset.budget, dailyBudgetCents: cents
        }).then(refresh).catch(function (err) { alert(err.message); });
      });
    });

    box.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('„' + b.dataset.name + '" entfernen? '
          + 'Die Kampagne verschwindet aus der Liste; die bisherigen Zahlen bleiben '
          + 'im Ads Manager erhalten.')) return;
        api('deleteCampaign', {
          property: property, platform: b.dataset.platform, id: b.dataset.remove
        }).then(refresh).catch(function (err) { alert(err.message); });
      });
    });

    box.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var an = b.dataset.active !== '1';
        if (an && !confirm('Kampagne starten? Ab jetzt wird Geld ausgegeben.')) return;
        b.disabled = true;
        b.textContent = '…';
        api('setStatus', {
          property: property, platform: b.dataset.platform, id: b.dataset.toggle, active: an
        }).then(refresh).catch(function (err) {
          b.disabled = false;
          alert(err.message);
          refresh();
        });
      });
    });
  }

  /* ── Bilder ───────────────────────────────────────────────────────── */

  /**
   * Welches Seitenverhältnis, und wofür es taugt.
   *
   * Nicht "richtig oder falsch", sondern wo es ausgespielt wird: 9:16 ist
   * für Reels und Stories die wichtigste Fläche, für Google dagegen
   * unbrauchbar. Google nimmt bei einer Responsive Display Ad ausschließlich
   * 1,91:1 und 1:1 — 16:9 sieht liegend aus, wird dort aber abgelehnt.
   */
  var FORMATE = [
    { v: 1.91,   kurz: '1,91:1',  fuer: 'Meta-Feed · Google',       google: 'quer' },
    { v: 16 / 9, kurz: '16:9',    fuer: 'Meta-Feed',                google: null  },
    { v: 1,      kurz: '1:1',     fuer: 'Meta-Feed · Google',       google: 'quadrat' },
    { v: 4 / 5,  kurz: '4:5',     fuer: 'Meta-Feed (nimmt am meisten Platz)', google: null },
    { v: 9 / 16, kurz: '9:16',    fuer: 'Reels und Stories',        google: null }
  ];

  function format(i) {
    if (!i.width || !i.height) {
      return { kurz: '?', lang: 'Maße unbekannt', ton: 'warn', google: null };
    }
    var v = i.width / i.height;
    var masse = i.width + ' × ' + i.height;
    for (var n = 0; n < FORMATE.length; n++) {
      var f = FORMATE[n];
      if (Math.abs(v / f.v - 1) < 0.03) {
        return { kurz: f.kurz, lang: masse + ' · ' + f.fuer, ton: 'ok', google: f.google };
      }
    }
    return {
      kurz: (v > 1 ? 'quer' : 'hoch') + ' ?',
      lang: masse + ' — kein gängiges Verhältnis, Meta beschneidet selbst',
      ton: 'warn', google: null
    };
  }

  var bilderCache = [];

  function renderImages(images) {
    bilderCache = images;
    var box = document.getElementById('ads-images');
    if (!box) return;
    if (!images.length) {
      box.innerHTML = '<p class="hint">Noch keine Bilder. Unten hochladen.</p>';
      updatePreview();
      return;
    }
    box.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;">' + images.map(function (i) {
      var an = picked.some(function (p) { return p.key === i.key; });
      var f = format(i);
      return '<div style="width:132px;">'
        + '<button data-img="' + esc(i.key) + '" title="' + esc(i.name) + '" '
        + 'style="display:block;width:132px;height:96px;padding:0;cursor:pointer;'
        + 'border:2px solid ' + (an ? 'var(--brass-bright)' : 'var(--line-strong)') + ';'
        + 'border-radius:3px;overflow:hidden;background:var(--void-3);">'
        + (i.url
            ? '<img src="' + esc(i.url) + '" alt="" style="width:100%;height:100%;'
              + 'object-fit:cover;display:block;opacity:' + (an ? '1' : '0.55') + ';">'
            : '<span class="hint">keine Vorschau</span>')
        + '</button>'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;">'
        + '<span style="font-family:var(--font-mono);font-size:0.56rem;letter-spacing:0.08em;'
        + 'text-transform:uppercase;color:'
        + (f.ton === 'ok' ? 'var(--parchment-dim)' : 'var(--brass)') + ';" '
        + 'title="' + esc(f.lang) + '">' + esc(f.kurz) + '</span>'
        + '<button data-del="' + esc(i.key) + '" title="Bild löschen" '
        + 'style="background:none;border:0;color:var(--parchment-faint);cursor:pointer;'
        + 'font-family:var(--font-mono);font-size:0.7rem;padding:0 2px;">×</button>'
        + '</div></div>';
    }).join('') + '</div>';

    box.querySelectorAll('[data-img]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.img;
        var at = -1;
        picked.forEach(function (p, n) { if (p.key === k) at = n; });
        if (at >= 0) picked.splice(at, 1);
        else picked.push(images.filter(function (x) { return x.key === k; })[0] || { key: k });
        renderImages(images);
        updatePreview();
      });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Bild löschen? Bereits angelegte Anzeigen behalten es.')) return;
        api('deleteImage', { property: property, key: b.dataset.del })
          .then(refresh)
          .catch(function (err) { alert(err.message); });
      });
    });
    updatePreview();
  }

  /* ── Vorschau der fertigen Anzeige ─────────────────────────────────── */

  /** Zeigt, was Meta ausspielen wird. Ohne das müsste man jede Kampagne
   *  erst anlegen und dann im Ads Manager nachsehen — und genau das soll
   *  diese Oberfläche ja ersparen. */
  function updatePreview() {
    var box = document.getElementById('ad-preview');
    if (!box) return;
    var kopf = (document.getElementById('ad-headline') || {}).value || '';
    var text = (document.getElementById('ad-body') || {}).value || '';
    var bild = picked.filter(function (p) { return p.url; })[0];

    if (!kopf && !text && !bild) {
      box.innerHTML = '<p class="hint">Sobald Bild, Überschrift oder Text stehen, '
        + 'erscheint hier die Anzeige.</p>';
      return;
    }
    box.innerHTML =
      '<div style="max-width:330px;border:1px solid var(--line-strong);border-radius:4px;'
      + 'overflow:hidden;background:var(--void-3);">'
      + '<div style="display:flex;align-items:center;gap:9px;padding:11px 13px;">'
      + '<span style="width:26px;height:26px;border-radius:50%;background:var(--brass);'
      + 'display:inline-block;flex:0 0 auto;"></span>'
      + '<span><span style="display:block;font-size:0.76rem;color:var(--parchment);">'
      + esc(prop().label) + '</span>'
      + '<span style="display:block;font-family:var(--font-mono);font-size:0.56rem;'
      + 'letter-spacing:0.08em;text-transform:uppercase;color:var(--parchment-faint);">'
      + 'Gesponsert</span></span></div>'
      + (text ? '<p style="margin:0;padding:0 13px 11px;font-size:0.82rem;line-height:1.5;'
          + 'color:var(--parchment-dim);white-space:pre-wrap;">' + esc(text) + '</p>' : '')
      + (bild ? '<img src="' + esc(bild.url) + '" alt="" style="width:100%;display:block;">'
              : '<div style="height:150px;background:var(--void-2);display:flex;'
                + 'align-items:center;justify-content:center;" class="hint">kein Bild gewählt</div>')
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;'
      + 'padding:11px 13px;background:var(--void-2);">'
      + '<span><span style="display:block;font-family:var(--font-mono);font-size:0.56rem;'
      + 'letter-spacing:0.08em;text-transform:uppercase;color:var(--parchment-faint);">'
      + esc(prop().siteUrl.replace(/^https?:\/\//, '')) + '</span>'
      + '<span style="display:block;font-size:0.8rem;color:var(--parchment);">'
      + esc(kopf || 'Überschrift') + '</span></span>'
      + '<span class="btn btn-mini" style="pointer-events:none;">Mehr dazu</span>'
      + '</div></div>'
      + (picked.length > 1
          ? '<p class="hint" style="margin-top:10px;">' + picked.length + ' Motive gewählt — '
            + 'daraus werden ' + picked.length + ' Anzeigen in derselben Anzeigengruppe. '
            + 'Gezeigt ist das erste.</p>'
          : '');
  }

  /* ── Formular ─────────────────────────────────────────────────────── */

  function formPanel() {
    var ziele = presets.objectives.map(function (o) {
      return '<option value="' + esc(o.key) + '">' + esc(o.label) + '</option>';
    }).join('');
    var gruppen = audiencesOf().map(function (a) {
      return '<option value="' + esc(a.key) + '">' + esc(a.label) + ' (' + a.ageMin + '–' + a.ageMax + ')</option>';
    }).join('');
    var laender = presets.countries.map(function (c) {
      return '<label class="checkrow" style="margin:0 14px 0 0;"><input type="checkbox" value="'
        + esc(c.code) + '" data-country' + (c.code === 'DE' ? ' checked' : '') + '> ' + esc(c.label) + '</label>';
    }).join('');

    return '<div class="panel">'
      + '<h2>Neue Kampagne</h2>'
      + '<div class="formrow">'
      + '<div><label for="ad-name">Name</label><input id="ad-name" type="text" placeholder="Orgel · Herbst"></div>'
      + '<div><label for="ad-platform">Plattform</label><select id="ad-platform">'
      + '<option value="meta">Meta (Facebook &amp; Instagram)</option>'
      + '<option value="google">Google Ads</option></select></div>'
      + '</div>'
      + '<div class="formrow">'
      + '<div><label for="ad-objective">Ziel</label><select id="ad-objective">' + ziele + '</select></div>'
      + '<div><label for="ad-audience">Zielgruppe</label><select id="ad-audience">' + gruppen + '</select></div>'
      + '<div><label for="ad-budget">Budget pro Tag (€)</label><input id="ad-budget" type="number" min="1" step="1" value="5"></div>'
      + '</div>'
      + '<p class="hint" id="ad-hint" style="margin-top:10px;"></p>'
      + '<label>Länder</label><div style="display:flex;flex-wrap:wrap;">' + laender + '</div>'
      + '<label for="ad-path">Zielseite auf ' + esc(prop().siteUrl.replace(/^https?:\/\//, '')) + '</label>'
      + '<input id="ad-path" type="text" value="' + esc(prop().defaultLandingPath) + '">'
      + '<p class="hint">Die Herkunftsmarkierung (utm) hängt der Dienst selbst an.</p>'
      + '<label for="ad-headline">Überschrift <span id="zaehl-headline" class="hint"></span></label>'
      + '<input id="ad-headline" type="text" maxlength="30" placeholder="Eine Orgel von 1908">'
      + '<label for="ad-body">Anzeigentext <span id="zaehl-body" class="hint"></span></label>'
      + '<textarea id="ad-body" maxlength="300" style="min-height:90px;"></textarea>'
      + '<label>Bilder</label>'
      + '<div id="ads-images"><p class="hint">Lade …</p></div>'
      /* Das native Dateifeld bringt einen Systemknopf mit ("Datei auswählen",
         Grau, Systemschrift). Es wird versteckt und über ein Label bedient,
         das wie jeder andere Knopf hier aussieht. */
      + '<div style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
      + '<label for="ad-file" class="btn btn-ghost btn-mini" '
      + 'style="margin:0;cursor:pointer;">Bilder hinzufügen</label>'
      + '<input type="file" id="ad-file" accept="image/png,image/jpeg" multiple '
      + 'style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">'
      + '<span class="hint" id="ad-file-name">PNG oder JPEG, mehrere möglich</span>'
      + '</div>'
      + '<p class="hint">Für Meta: <b>9:16</b> (1080 × 1920) ist die wichtigste Fläche — '
      + 'Reels und Stories. <b>4:5</b> (1080 × 1350) nimmt im Feed am meisten Platz ein. '
      + 'Für Google zusätzlich <b>1,91:1</b> (1200 × 628) <i>und</i> <b>1:1</b> (1200 × 1200); '
      + 'beide zusammen, sonst legt Google nichts an. 16:9 nimmt Google nicht.</p>'
      + '<label>Vorschau</label>'
      + '<div id="ad-preview"></div>'
      + '<button class="btn btn-fill" id="ad-create" style="margin-top:20px;">Anlegen (pausiert)</button>'
      + '<div class="msg" id="ad-msg"></div>'
      + '</div>';
  }

  function wireForm() {
    var hint = document.getElementById('ad-hint');
    var sel = document.getElementById('ad-objective');
    var aud = document.getElementById('ad-audience');
    function updateHint() {
      var o = presets.objectives.filter(function (x) { return x.key === sel.value; })[0];
      var a = audiencesOf().filter(function (x) { return x.key === aud.value; })[0];
      hint.textContent = (o ? o.hint : '') + ' · ' + (a ? a.hint : '');
    }
    sel.addEventListener('change', updateHint);
    aud.addEventListener('change', updateHint);
    updateHint();

    /* Meta schneidet zu lange Überschriften wortlos ab. Lieber vorher sehen,
       wie nah es wird, als hinterher eine halbe Zeile in der Anzeige. */
    [['ad-headline', 'zaehl-headline', 30], ['ad-body', 'zaehl-body', 300]].forEach(function (z) {
      var feld = document.getElementById(z[0]);
      var anzeige = document.getElementById(z[1]);
      function zaehlen() {
        var n = feld.value.length;
        anzeige.textContent = n + ' / ' + z[2];
        anzeige.style.color = n >= z[2] ? '#c96f5a'
          : (n > z[2] * 0.85 ? 'var(--brass)' : 'var(--parchment-faint)');
        updatePreview();
      }
      feld.addEventListener('input', zaehlen);
      zaehlen();
    });

    document.getElementById('ad-file').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files || []);
      if (!files.length) return;
      var msg = document.getElementById('ad-msg');
      var name = document.getElementById('ad-file-name');
      msg.className = 'msg';
      msg.textContent = 'Lade ' + files.length + ' Bild(er) hoch …';
      if (name) {
        name.textContent = files.length === 1
          ? files[0].name
          : files.length + ' Dateien gewählt';
      }
      var kette = Promise.resolve();
      files.forEach(function (f) {
        kette = kette.then(function () {
          return f.arrayBuffer().then(function (buf) {
            var bin = '', b = new Uint8Array(buf);
            for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
            return api('upload', {
              property: property, filename: f.name, contentType: f.type, data: btoa(bin)
            });
          }).then(function (r) { picked.push(r); });
        });
      });
      kette.then(function () {
        msg.className = 'msg ok';
        msg.textContent = 'Hochgeladen.';
        ev.target.value = '';
        if (name) name.textContent = 'PNG oder JPEG, mehrere möglich';
        refresh();
      }).catch(function (err) {
        msg.className = 'msg err';
        msg.textContent = err.message;
      });
    });

    document.getElementById('ad-create').addEventListener('click', function () {
      var msg = document.getElementById('ad-msg');
      var laender = Array.prototype.slice.call(root.querySelectorAll('[data-country]:checked'))
        .map(function (c) { return c.value; });
      var draft = {
        property: property,
        platform: document.getElementById('ad-platform').value,
        name: document.getElementById('ad-name').value.trim(),
        objective: sel.value,
        audience: aud.value,
        countries: laender,
        dailyBudgetCents: Math.round(parseFloat(document.getElementById('ad-budget').value || '0') * 100),
        headline: document.getElementById('ad-headline').value.trim(),
        body: document.getElementById('ad-body').value.trim(),
        landingPath: document.getElementById('ad-path').value.trim(),
        imageKeys: picked.map(function (p) { return p.key; })
      };
      msg.className = 'msg';
      msg.textContent = 'Lege an …';
      api('create', { draft: draft }).then(function () {
        msg.className = 'msg ok';
        msg.textContent = '„' + draft.name + '" ist angelegt und pausiert. '
          + 'Zum Ausliefern oben auf Starten drücken.';
        /* Formular leeren: ein stehengebliebener Entwurf verleitet dazu,
           versehentlich dieselbe Kampagne zweimal anzulegen. */
        picked = [];
        neuBenannt = draft.name;
        ['ad-name', 'ad-headline', 'ad-body'].forEach(function (id) {
          document.getElementById(id).value = '';
          document.getElementById(id).dispatchEvent(new Event('input'));
        });
        refresh();
      }).catch(function (err) {
        msg.className = 'msg err';
        msg.textContent = err.message;
      });
    });
  }

  window.SteinbachAds = { mount: mount };
})();
