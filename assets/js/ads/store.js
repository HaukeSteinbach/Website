/**
 * Steinbach Instruments — store client
 *
 * Talks to Supabase (auth + entitlements) and the Edge Functions
 * (create-checkout, get-download) with plain fetch — no third-party
 * JavaScript is loaded on the site.
 *
 * Auth model: passwordless e-mail codes (Supabase OTP). The session tokens
 * are kept in localStorage; there is no password anywhere in the system.
 * Ownership checks for downloads happen server-side in the get-download
 * function — everything this file does is presentation.
 *
 * Loaded on every page after main.js:
 *  - injects the "Account" item into the nav
 *  - upgrades [data-store-cta] buttons on product pages
 *    (coming soon → buy → download, depending on config and ownership)
 * account.html additionally uses the API exposed as window.SteinbachStore.
 */
(function () {
  'use strict';

  var cfg = window.STORE_CONFIG || {};
  var configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  var AUTH = cfg.supabaseUrl + '/auth/v1';
  var REST = cfg.supabaseUrl + '/rest/v1';
  var FN = cfg.supabaseUrl + '/functions/v1';
  var LS_KEY = 'si-session';

  /* ---------------- session storage ---------------- */

  function loadSession() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.access_token && s.refresh_token) ? s : null;
    } catch (e) { return null; }
  }

  function saveSession(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }

  function normalizeSession(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      /* refresh one minute early */
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) - 60,
      email: data.user && data.user.email
    };
  }

  /* ---------------- http helpers ---------------- */

  function authHeaders(token) {
    return {
      'apikey': cfg.supabaseAnonKey,
      'Authorization': 'Bearer ' + (token || cfg.supabaseAnonKey),
      'Content-Type': 'application/json'
    };
  }

  function jsonOrThrow(res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) {
        var msg = body.msg || body.message || body.error_description || body.error || ('Request failed (' + res.status + ')');
        var err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return body;
    });
  }

  /* ---------------- auth ---------------- */

  function refreshSession(session) {
    return fetch(AUTH + '/token?grant_type=refresh_token', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(jsonOrThrow).then(function (data) {
      var s = normalizeSession(data);
      saveSession(s);
      return s;
    }).catch(function () {
      clearSession();
      return null;
    });
  }

  /* Resolves to a valid session or null. */
  function getSession() {
    var s = loadSession();
    if (!s) return Promise.resolve(null);
    if (s.expires_at > Math.floor(Date.now() / 1000)) return Promise.resolve(s);
    return refreshSession(s);
  }

  /* Step 1: e-mail the user a 6-digit code. */
  function requestCode(email) {
    return fetch(AUTH + '/otp', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: email, create_user: true })
    }).then(jsonOrThrow);
  }

  /* Step 2: exchange the code for a session. */
  function verifyCode(email, code) {
    return fetch(AUTH + '/verify', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'email', email: email, token: code })
    }).then(jsonOrThrow).then(function (data) {
      var s = normalizeSession(data);
      saveSession(s);
      return s;
    });
  }

  function signOut() {
    return getSession().then(function (s) {
      clearSession();
      if (!s) return;
      return fetch(AUTH + '/logout', {
        method: 'POST',
        headers: authHeaders(s.access_token)
      }).catch(function () {});
    });
  }

  /* ---------------- entitlements / store ---------------- */

  /* Resolves to a Set of owned product slugs (empty when signed out).
     Row-level security limits the query to the signed-in user's own rows. */
  function fetchOwned() {
    return getSession().then(function (s) {
      if (!s) return new Set();
      return fetch(REST + '/entitlements?select=product_slug', {
        headers: authHeaders(s.access_token)
      }).then(jsonOrThrow).then(function (rows) {
        return new Set(rows.map(function (r) { return r.product_slug; }));
      }).catch(function () { return new Set(); });
    });
  }

  function startCheckout(slug, edition) {
    return getSession().then(function (s) {
      return fetch(FN + '/create-checkout', {
        method: 'POST',
        headers: authHeaders(s && s.access_token),
        body: JSON.stringify({
          product: slug,
          edition: edition || 'standard'
        })
      });
    }).then(jsonOrThrow).then(function (data) {
      if (!data.url) throw new Error('Checkout could not be started.');
      window.location.href = data.url;
    });
  }

  /* Resolves to the signed-in user's invoices (newest first, empty when
     signed out). Row-level security limits the query to own rows. */
  function fetchInvoices() {
    return getSession().then(function (s) {
      if (!s) return [];
      return fetch(REST + '/invoices?select=number,product_slug,amount_cents,created_at&order=created_at.desc', {
        headers: authHeaders(s.access_token)
      }).then(jsonOrThrow).catch(function () { return []; });
    });
  }

  /* Short-lived signed URL for one of the user's own invoice PDFs. */
  function getInvoiceUrl(number) {
    return getSession().then(function (s) {
      if (!s) throw new Error('Please sign in first.');
      return fetch(FN + '/get-invoice', {
        method: 'POST',
        headers: authHeaders(s.access_token),
        body: JSON.stringify({ number: number })
      });
    }).then(jsonOrThrow).then(function (data) {
      if (!data.url) throw new Error('Invoice could not be prepared.');
      return data.url;
    });
  }

  /* Newsletter: status, subscribe, unsubscribe — always only for the
     signed-in user's own verified address (enforced by row-level security). */
  function newsletterStatus() {
    return getSession().then(function (s) {
      if (!s) return null;
      return fetch(REST + '/newsletter_subscribers?select=email', {
        headers: authHeaders(s.access_token)
      }).then(jsonOrThrow).then(function (rows) {
        return rows.length > 0;
      }).catch(function () { return null; });
    });
  }

  function subscribeNewsletter() {
    return getSession().then(function (s) {
      if (!s) throw new Error('Please sign in first.');
      return fetch(REST + '/newsletter_subscribers?on_conflict=email', {
        method: 'POST',
        headers: Object.assign(authHeaders(s.access_token), { 'Prefer': 'resolution=ignore-duplicates' }),
        body: JSON.stringify({ email: (s.email || '').toLowerCase(), source: 'account.html' })
      }).then(function (res) {
        if (!res.ok && res.status !== 409) throw new Error('Could not subscribe. Please try again.');
      });
    });
  }

  function unsubscribeNewsletter() {
    return getSession().then(function (s) {
      if (!s) throw new Error('Please sign in first.');
      return fetch(REST + '/newsletter_subscribers?email=eq.' + encodeURIComponent((s.email || '').toLowerCase()), {
        method: 'DELETE',
        headers: authHeaders(s.access_token)
      }).then(function (res) {
        if (!res.ok) throw new Error('Could not unsubscribe. Please try again.');
      });
    });
  }

  /* Asks the backend for a short-lived signed download URL; the entitlement
     check happens there, against the database, never in the browser. */
  function getDownloadUrl(slug, fileKey) {
    return getSession().then(function (s) {
      if (!s) throw new Error('Please sign in first.');
      return fetch(FN + '/get-download', {
        method: 'POST',
        headers: authHeaders(s.access_token),
        body: JSON.stringify({ product: slug, file: fileKey })
      });
    }).then(jsonOrThrow).then(function (data) {
      if (!data.url) throw new Error('Download could not be prepared.');
      return data.url;
    });
  }

  /* ---------------- UI: nav + product page CTAs ---------------- */

  function makeButton(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    return b;
  }

  function busy(btn, on) {
    btn.disabled = on;
    btn.style.opacity = on ? '0.6' : '';
    btn.style.cursor = on ? 'wait' : '';
  }

  function showError(after, message) {
    var id = 'store-cta-error';
    var el = after.parentNode.querySelector('.' + id) || document.createElement('div');
    el.className = id;
    el.style.cssText = 'margin-top:14px;font-family:var(--font-mono);font-size:0.72rem;letter-spacing:0.06em;color:#c96f5a;';
    el.textContent = message;
    after.parentNode.insertBefore(el, after.nextSibling);
  }

  /* 'mac' | 'win' — used to put the visitor's own system first. */
  function detectPlatform() {
    var ua = (navigator.platform || '') + ' ' + (navigator.userAgent || '');
    return /win/i.test(ua) && !/darwin/i.test(ua) ? 'win' : 'mac';
  }

  /* Download keys with the visitor's platform first, so the primary
     (filled) button is always the one they most likely need. */
  function orderedDownloadKeys(product) {
    var keys = Object.keys(product.downloads || {});
    var mine = detectPlatform();
    keys.sort(function (a, b) { return (b === mine) - (a === mine); });
    return keys;
  }

  /* Installationsleitfaden: dieselbe PDF, die auch der Rechnungsmail anhaengt
     (siehe _shared/mailer.ts). Sie liegt jetzt neben der Auswahl, damit sie
     beim ersten Herunterladen ins Auge faellt und nicht nur im
     Kleingedruckten steht. */
  var GUIDE_URL = 'assets/downloads/Installation%20Guide.pdf';

  /**
   * Fassung als Klappliste waehlen, daneben der Herunterladen-Knopf und der
   * Installationsleitfaden.
   *
   * Vorher stand hier eine Knopfreihe, eine pro Fassung. Bei der Orgel sind
   * das drei, und die Reihe wurde breiter als alles andere in der Zeile.
   * Welche Fassung man braucht, entscheidet man ausserdem einmal - das ist
   * eine Auswahl, keine drei gleichrangigen Handlungen.
   *
   * opts: { small: true fuer die Kontozeile, onError: fn(text) }
   */
  /**
   * Fassung waehlen, herunterladen, Installationsleitfaden - eine Zeile.
   *
   * Vorher stand hier eine Knopfreihe, eine pro Fassung. Bei der Orgel sind
   * das drei, und die Reihe wurde breiter als alles andere daneben. Welche
   * Fassung man braucht, entscheidet man ausserdem einmal: das ist eine
   * Auswahl, keine drei gleichrangigen Handlungen.
   *
   * Die Liste ist bewusst nachgebaut und kein <select>. Ein natives Auswahl-
   * feld klappt ein Systemmenue auf - graues Fenstergrau, Systemschrift,
   * Systemblau auf dem markierten Eintrag. Das ist das einzige Element auf
   * der Seite, das Jakobs Sprache verlaesst, und ausgerechnet beim Klick.
   *
   * opts: { small: true fuer die Kontozeile, onError: fn(text) }
   */
  function buildDownloadPicker(slug, product, opts) {
    opts = opts || {};
    var klein = !!opts.small;
    var onError = opts.onError || function () {};
    var keys = orderedDownloadKeys(product);
    var aktiv = keys[0];

    var row = document.createElement('span');
    row.style.cssText = 'display:inline-flex;flex-wrap:wrap;align-items:center;gap:10px;';

    /* Masse aus .btn / .btn-small, damit Liste und Knoepfe gleich hoch sind. */
    var polster = klein ? '10px 18px' : '15px 30px';
    var groesse = klein ? '0.68rem' : '0.75rem';

    /* Bei nur einer Fassung waere eine Liste mit einem Eintrag Unsinn -
       dann traegt der Knopf gleich den Namen der Fassung. */
    if (keys.length > 1) row.appendChild(buildDropdown());

    var dl = makeButton(keys.length > 1 ? 'Download' : (product.downloads[aktiv] || 'Download'),
                        'btn-fill' + (klein ? ' btn-small' : ''));
    dl.addEventListener('click', function () {
      if (!aktiv) return;
      busy(dl, true);
      getDownloadUrl(slug, aktiv).then(function (url) {
        busy(dl, false);
        window.location.href = url;
      }).catch(function (err) {
        busy(dl, false);
        onError(err.message);
      });
    });
    row.appendChild(dl);

    var guide = document.createElement('a');
    guide.className = 'btn btn-ghost' + (klein ? ' btn-small' : '');
    guide.href = GUIDE_URL;
    guide.target = '_blank';
    guide.rel = 'noopener';
    guide.textContent = 'Installation Guide';
    guide.style.textDecoration = 'none';
    row.appendChild(guide);

    return row;

    /* ---- die nachgebaute Auswahlliste ---- */
    function buildDropdown() {
      var box = document.createElement('span');
      box.style.cssText = 'position:relative;display:inline-block;';

      var knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'btn btn-ghost' + (klein ? ' btn-small' : '');
      knopf.setAttribute('aria-haspopup', 'listbox');
      knopf.setAttribute('aria-expanded', 'false');
      knopf.style.cssText = 'display:inline-flex;align-items:center;gap:14px;';

      var text = document.createElement('span');
      text.textContent = product.downloads[aktiv];
      knopf.appendChild(text);

      var pfeil = document.createElement('span');
      pfeil.setAttribute('aria-hidden', 'true');
      pfeil.style.cssText = 'display:inline-block;width:7px;height:7px;flex:0 0 auto;'
        + 'border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;'
        + 'transform:translateY(-2px) rotate(45deg);transition:transform 0.2s ease;';
      knopf.appendChild(pfeil);
      box.appendChild(knopf);

      var liste = document.createElement('div');
      liste.setAttribute('role', 'listbox');
      liste.style.cssText = 'position:absolute;left:0;top:calc(100% + 6px);z-index:40;'
        + 'min-width:100%;white-space:nowrap;display:none;'
        + 'background:var(--void-2);border:1px solid var(--line-strong);border-radius:2px;'
        + 'box-shadow:0 14px 34px rgba(0,0,0,0.55);padding:4px 0;';

      var eintraege = keys.map(function (key) {
        var e = document.createElement('button');
        e.type = 'button';
        e.setAttribute('role', 'option');
        e.dataset.key = key;
        e.textContent = product.downloads[key];
        e.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;'
          + 'font-family:var(--font-mono);font-size:' + groesse + ';letter-spacing:0.1em;'
          + 'text-transform:uppercase;padding:' + (klein ? '10px 18px' : '13px 30px') + ';'
          + 'cursor:pointer;transition:background 0.15s ease,color 0.15s ease;';
        e.addEventListener('mouseenter', function () { markieren(e); });
        e.addEventListener('click', function () { waehlen(key); });
        liste.appendChild(e);
        return e;
      });
      box.appendChild(liste);

      function faerben() {
        eintraege.forEach(function (e) {
          var gewaehlt = e.dataset.key === aktiv;
          e.style.color = gewaehlt ? 'var(--brass-bright)' : 'var(--parchment-dim)';
          e.style.background = 'none';
        });
      }
      function markieren(e) {
        faerben();
        e.style.background = 'rgba(181,138,74,0.14)';
        e.style.color = 'var(--brass-bright)';
      }
      function offen() { return liste.style.display === 'block'; }
      function auf() {
        liste.style.display = 'block';
        knopf.setAttribute('aria-expanded', 'true');
        pfeil.style.transform = 'translateY(2px) rotate(225deg)';
        faerben();
        var i = keys.indexOf(aktiv);
        if (eintraege[i]) { markieren(eintraege[i]); eintraege[i].focus(); }
        document.addEventListener('mousedown', aussen, true);
      }
      function zu(zurueck) {
        liste.style.display = 'none';
        knopf.setAttribute('aria-expanded', 'false');
        pfeil.style.transform = 'translateY(-2px) rotate(45deg)';
        document.removeEventListener('mousedown', aussen, true);
        if (zurueck) knopf.focus();
      }
      function aussen(ev) { if (!box.contains(ev.target)) zu(false); }
      function waehlen(key) {
        aktiv = key;
        text.textContent = product.downloads[key];
        zu(true);
      }

      knopf.addEventListener('click', function () { offen() ? zu(false) : auf(); });
      box.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && offen()) { ev.preventDefault(); zu(true); return; }
        if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
          ev.preventDefault();
          if (!offen()) { auf(); return; }
          var i = eintraege.indexOf(document.activeElement);
          if (i < 0) i = keys.indexOf(aktiv);
          i = (i + (ev.key === 'ArrowDown' ? 1 : -1) + eintraege.length) % eintraege.length;
          markieren(eintraege[i]);
          eintraege[i].focus();
        }
      });

      faerben();
      return box;
    }
  }

  function renderDownloadButtons(placeholder, slug, product) {
    var wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;gap:14px;';

    wrap.appendChild(buildDownloadPicker(slug, product, {
      onError: function (text) { showError(wrap, text); }
    }));

    var fine = document.createElement('span');
    fine.className = 'store-trust';
    fine.style.marginTop = '0';
    fine.textContent = 'In your library'
      + (product.versionLabel ? ' \u00b7 ' + product.versionLabel : '');
    wrap.appendChild(fine);

    placeholder.replaceWith(wrap);
  }

  function renderBuyButton(placeholder, slug, product) {
    var wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;';

    var row = document.createElement('span');
    row.style.cssText = 'display:inline-flex;flex-wrap:wrap;justify-content:center;gap:12px;';
    var checkoutBtn = function (label, cls, edition) {
      var btn = makeButton(label, cls);
      btn.addEventListener('click', function () {
        busy(btn, true);
        startCheckout(slug, edition).catch(function (err) {
          busy(btn, false);
          showError(wrap, err.message);
        });
      });
      return btn;
    };
    row.appendChild(checkoutBtn(product.priceLabel ? 'Buy · ' + product.priceLabel : 'Buy now', 'btn-fill', 'standard'));
    if (product.patronPriceLabel) {
      row.appendChild(checkoutBtn('Patron Edition · ' + product.patronPriceLabel, 'btn-ghost', 'patron'));
    }
    wrap.appendChild(row);

    var trust = document.createElement('div');
    trust.className = 'store-trust';
    trust.textContent = 'Secure checkout via Stripe · Instant download · No VAT (§ 19 UStG)';
    wrap.appendChild(trust);

    var preserve = document.createElement('div');
    preserve.className = 'store-trust';
    preserve.style.marginTop = '8px';
    preserve.textContent = 'Every purchase helps preserve the original' +
      (product.patronPriceLabel ? ' · Patron: printed, numbered certificate by post' : '') + '.';
    wrap.appendChild(preserve);

    placeholder.replaceWith(wrap);
  }

  function initProductCtas() {
    var ctas = document.querySelectorAll('[data-store-cta][data-product]');
    if (!ctas.length) return;

    /* "Already own it? Sign in" only makes sense for signed-out visitors. */
    getSession().then(function (s) {
      if (!s) return;
      document.querySelectorAll('.patreon-owned-hint').forEach(function (el) {
        el.style.display = 'none';
      });
    });

    fetchOwned().then(function (owned) {
      ctas.forEach(function (el) {
        var slug = el.getAttribute('data-product');
        var product = (cfg.products || {})[slug];
        if (!product) return;
        if (owned.has(slug)) {
          renderDownloadButtons(el, slug, product);
        } else if (product.available) {
          renderBuyButton(el, slug, product);
        }
        /* otherwise: keep the original "coming soon" markup untouched */
      });
    });
  }

  function initNavLink() {
    var links = document.querySelector('.nav-links');
    if (!links || links.querySelector('a[href="account.html"]')) return;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = 'account.html';
    a.textContent = 'Account';
    if (/(^|\/)account\.html$/.test(window.location.pathname)) a.className = 'active';
    li.appendChild(a);
    links.appendChild(li);
  }

  /* ---------------- boot ---------------- */

  window.SteinbachStore = {
    configured: configured,
    config: cfg,
    getSession: getSession,
    requestCode: requestCode,
    verifyCode: verifyCode,
    signOut: signOut,
    fetchOwned: fetchOwned,
    fetchInvoices: fetchInvoices,
    startCheckout: startCheckout,
    getDownloadUrl: getDownloadUrl,
    getInvoiceUrl: getInvoiceUrl,
    orderedDownloadKeys: orderedDownloadKeys,
    buildDownloadPicker: buildDownloadPicker,
    newsletterStatus: newsletterStatus,
    subscribeNewsletter: subscribeNewsletter,
    unsubscribeNewsletter: unsubscribeNewsletter
  };

  document.addEventListener('DOMContentLoaded', function () {
    initNavLink();
    if (!configured) return; /* store not set up yet — CTAs keep their fallback */
    initProductCtas();
  });
})();
