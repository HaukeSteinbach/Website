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
        if (!res.ok) { var e = new Error(body.error || ('HTTP ' + res.status)); e.code = res.status; throw e; }
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

    var kopf = presets.properties.length > 1
      ? '<h2>Marke</h2><div style="display:flex;gap:8px;flex-wrap:wrap;">' + props + '</div>'
      : '<h2>' + esc(prop().label) + '</h2>';

    root.innerHTML =
      '<div class="panel">'
      + kopf
      + '<div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:18px;">'
      + statusChip(presets.platforms.meta.connected, 'Meta')
      + statusChip(presets.platforms.google.connected, 'Google Ads')
      + '</div>'
      + '<div class="hint" id="ads-cap" style="margin-top:14px;"></div>'
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
      return '<tr>'
        + '<td><span class="em">' + esc(c.name) + '</span><br>'
        + '<span style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.1em;'
        + 'text-transform:uppercase;color:var(--parchment-faint);">' + esc(c.platform) + '</span></td>'
        + '<td style="color:' + farbe + ';">' + wort + '</td>'
        + '<td class="num">' + euro(c.dailyBudgetCents) + '</td>'
        + '<td class="num">' + euro(c.spendCents) + '</td>'
        + '<td class="num">' + c.impressions.toLocaleString('de-DE') + '</td>'
        + '<td class="num">' + c.clicks.toLocaleString('de-DE') + '</td>'
        + '<td class="num">' + ctr + '</td>'
        + '<td class="num"><button class="btn btn-mini' + (c.status === 'active' ? ' btn-danger' : '')
        + '" data-toggle="' + esc(c.id) + '" data-platform="' + esc(c.platform) + '" '
        + 'data-active="' + (c.status === 'active' ? '1' : '0') + '">' + klick + '</button></td>'
        + '</tr>';
    }).join('');

    box.innerHTML = hinweise + '<div class="tablewrap"><table>'
      + '<tr><th>Kampagne</th><th>Zustand</th><th class="num">Budget/Tag</th>'
      + '<th class="num">Ausgegeben</th><th class="num">Sichtkontakte</th>'
      + '<th class="num">Klicks</th><th class="num">Klickrate</th><th></th></tr>'
      + rows + '</table></div>';

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

  function renderImages(images) {
    var box = document.getElementById('ads-images');
    if (!box) return;
    if (!images.length) {
      box.innerHTML = '<p class="hint">Noch keine Bilder für dieses Objekt.</p>';
      return;
    }
    box.innerHTML = images.map(function (i) {
      var an = picked.some(function (p) { return p.key === i.key; });
      return '<button class="btn btn-mini' + (an ? ' btn-fill' : '') + '" data-img="' + esc(i.key)
        + '" style="margin:0 6px 6px 0;">' + esc(i.name.replace(/^\d+-/, '')) + '</button>';
    }).join('');
    box.querySelectorAll('[data-img]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.img;
        var at = picked.findIndex(function (p) { return p.key === k; });
        if (at >= 0) picked.splice(at, 1);
        else picked.push({ key: k });
        renderImages(images);
      });
    });
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
      + '<label for="ad-headline">Überschrift</label><input id="ad-headline" type="text" maxlength="30" placeholder="Eine Orgel von 1908">'
      + '<label for="ad-body">Anzeigentext</label><textarea id="ad-body" maxlength="300" style="min-height:90px;"></textarea>'
      + '<label>Bilder</label>'
      + '<div id="ads-images"><p class="hint">Lade …</p></div>'
      + '<div style="margin-top:12px;"><input type="file" id="ad-file" accept="image/png,image/jpeg" multiple></div>'
      + '<p class="hint">Google verlangt beides: ein liegendes Bild (etwa 1200 × 628) und ein '
      + 'quadratisches (etwa 1200 × 1200). Meta kommt mit einem aus.</p>'
      + '<button class="btn btn-fill" id="ad-create" style="margin-top:20px;">Angelegt lassen (pausiert)</button>'
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

    document.getElementById('ad-file').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files || []);
      if (!files.length) return;
      var msg = document.getElementById('ad-msg');
      msg.className = 'msg';
      msg.textContent = 'Lade ' + files.length + ' Bild(er) hoch …';
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
        msg.textContent = 'Angelegt und pausiert. Zum Ausliefern oben auf Starten drücken.';
        picked = [];
        refresh();
      }).catch(function (err) {
        msg.className = 'msg err';
        msg.textContent = err.message;
      });
    });
  }

  window.SteinbachAds = { mount: mount };
})();
