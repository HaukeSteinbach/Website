/**
 * The admin area: sign in, list every project, open one, send a delivery.
 *
 * Three views in one page. Navigating between a list and a detail should not
 * cost a page load when the whole dataset is a handful of records, and staying
 * on one page means the delivery form keeps its files if a send fails.
 */
(function () {
  'use strict';

  var API = '/api/v1/admin';

  var views = {
    signin: document.getElementById('signin-view'),
    list: document.getElementById('list-view'),
    detail: document.getElementById('detail-view'),
    order: document.getElementById('order-view'),
    customer: document.getElementById('customer-view'),
    document: document.getElementById('document-view')
  };

  /* Which tab the list is showing. Projects and orders share the page because
     they are both "what is on my plate", but they have nothing else in common
     — separate calls, separate tables, separate detail views. */
  var tab = 'projects';

  var ORDER_STATUS = {
    paid: 'To ship',
    shipped: 'Shipped',
    cancelled: 'Cancelled',
    refunded: 'Refunded'
  };

  var STATUS_LABELS = {
    new: 'New',
    in_progress: 'In progress',
    delivered: 'Delivered',
    revision_requested: 'Revision requested',
    done: 'Done'
  };

  /* ---------------------------------------------------------------------- */

  function show(name) {
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });
    document.getElementById('sign-out').hidden = name === 'signin';
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'handoff-status' + (text ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function api(path, options) {
    var settings = Object.assign({ credentials: 'same-origin' }, options || {});

    return fetch(API + path, settings).then(function (response) {
      if (response.status === 401) {
        show('signin');
        throw new Error('Your session expired. Sign in again.');
      }

      return response.json()
        .catch(function () { return {}; })
        .then(function (payload) {
          if (!response.ok) {
            throw new Error(payload.message || 'Something went wrong.');
          }
          return payload;
        });
    });
  }

  function formatBytes(size) {
    if (!size) return '0 B';
    if (size < 1024) return size + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var value = size / 1024;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return value.toFixed(1) + ' ' + units[unit];
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ----------------------------------------------------------------------
     Sign in
     ---------------------------------------------------------------------- */

  /* Das Codefeld erscheint nur, wenn der Server den zweiten Schritt auch
     verlangt. Sonst stuende dort auf jedem Server ein Feld, das niemand
     ausfuellen kann. */
  /* Das Codefeld erscheint sofort, wenn die App den Code liefert, und erst
     nach dem Passwort, wenn er per Mail kommt -- vorher gibt es ja keinen. */
  fetch('/health')
    .then(function (r) { return r.json(); })
    .then(function (h) {
      if (h && h.adminSecondFactor === 'totp') {
        document.getElementById('code-group').hidden = false;
        document.getElementById('code').required = true;
      }
    })
    .catch(function () { /* im Zweifel nur das Passwort zeigen */ });

  var signinForm = document.getElementById('signin-form');
  var signinStatus = document.getElementById('signin-status');

  /* Bei der Mailfassung laeuft die Anmeldung in zwei Schritten: das Passwort
     loest eine Mail aus und liefert eine Challenge zurueck, der Code loest
     die Challenge ein. Diese Variable haelt fest, wo wir gerade stehen. */
  var challenge = null;

  function angemeldet() {
    setStatus(signinStatus, '');
    document.getElementById('password').value = '';
    document.getElementById('code').value = '';
    challenge = null;
    loadList();
  }

  signinForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var submit = document.getElementById('signin-submit');
    var codeField = document.getElementById('code');
    submit.disabled = true;

    /* Zweiter Schritt: die Challenge steht, es fehlt nur der Code. */
    if (challenge) {
      setStatus(signinStatus, 'Checking the code…');

      api('/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: challenge, code: codeField.value })
      })
        .then(angemeldet)
        .catch(function (error) {
          setStatus(signinStatus, error.message, 'error');
          codeField.value = '';
          codeField.focus();
        })
        .then(function () { submit.disabled = false; });
      return;
    }

    setStatus(signinStatus, 'Checking…');

    api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: document.getElementById('password').value,
        code: codeField.value
      })
    })
      .then(function (data) {
        if (data && data.step === 'code') {
          challenge = data.challenge;
          document.getElementById('code-group').hidden = false;
          codeField.required = true;
          codeField.value = '';
          codeField.focus();
          document.getElementById('password').disabled = true;
          submit.textContent = 'Confirm code';
          setStatus(signinStatus, 'Code sent to ' + (data.sentTo || 'your inbox') + '. It is valid for ten minutes.');
          return;
        }

        angemeldet();
      })
      .catch(function (error) { setStatus(signinStatus, error.message, 'error'); })
      .then(function () { submit.disabled = false; });
  });

  document.getElementById('sign-out').addEventListener('click', function () {
    api('/auth/logout', { method: 'POST' })
      .catch(function () { /* signing out locally is what matters */ })
      .then(function () { show('signin'); });
  });

  /* ----------------------------------------------------------------------
     List
     ---------------------------------------------------------------------- */

  var listStatus = document.getElementById('list-status');

  function loadList() {
    setStatus(listStatus, 'Loading…');

    return api('/projects')
      .then(function (data) {
        setStatus(listStatus, '');
        renderList(data);
        show('list');
      })
      .catch(function (error) {
        if (error.message.indexOf('session') === -1) {
          setStatus(listStatus, error.message, 'error');
        }
      });
  }

  function renderList(data) {
    var body = document.getElementById('projects-body');
    var projects = data.projects || [];

    document.getElementById('counts').innerHTML =
      '<div><dt>Open</dt><dd>' + data.counts.open + '</dd></div>' +
      '<div><dt>Waiting on me</dt><dd class="' + (data.counts.awaitingRevision ? 'is-alert' : '') + '">' +
        data.counts.awaitingRevision + '</dd></div>' +
      '<div><dt>Total</dt><dd>' + data.counts.total + '</dd></div>';

    document.getElementById('orders-wrap').hidden = true;
    document.getElementById('orders-empty').hidden = true;
    document.getElementById('list-empty').hidden = projects.length > 0;
    document.querySelector('.admin-table-wrap').hidden = projects.length === 0;

    body.innerHTML = projects.map(function (p) {
      return '<tr tabindex="0" role="button" data-id="' + escapeHtml(p.id) + '">' +
        '<td class="mono">' + escapeHtml(p.reference) + '</td>' +
        '<td>' + escapeHtml(p.client && p.client.name ? p.client.name : (p.client && p.client.email) || '—') + '</td>' +
        '<td>' + escapeHtml(p.title || '—') + '</td>' +
        '<td class="mono">' + escapeHtml(p.service) + '</td>' +
        '<td class="num mono">' + (p.currentVersion || '—') + '</td>' +
        '<td>' + statusChip(p) + '</td>' +
        '<td class="mono">' + formatDate(p.updatedAt) + '</td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (row) {
      row.addEventListener('click', function () { openProject(row.dataset.id); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProject(row.dataset.id);
        }
      });
    });
  }

  function statusChip(project) {
    var label = STATUS_LABELS[project.status] || project.status;

    if (project.status === 'revision_requested' && project.openRevisionCount > 1) {
      label += ' (' + project.openRevisionCount + ')';
    }

    return '<span class="admin-chip is-' + escapeHtml(project.status) + '">' + escapeHtml(label) + '</span>';
  }

  document.getElementById('refresh').addEventListener('click', function () {
    return tab === 'orders' ? loadOrders() : loadList();
  });
  document.getElementById('back').addEventListener('click', loadList);
  document.getElementById('order-back').addEventListener('click', loadOrders);

  document.getElementById('tab-projects').addEventListener('click', function () { switchTab('projects'); });
  document.getElementById('tab-orders').addEventListener('click', function () { switchTab('orders'); });
  document.getElementById('tab-customers').addEventListener('click', function () { switchTab('customers'); });
  document.getElementById('tab-documents').addEventListener('click', function () { switchTab('documents'); });
  document.getElementById('document-refresh').addEventListener('click', loadDocuments);
  document.getElementById('document-back').addEventListener('click', function () { switchTab('documents'); });
  document.getElementById('customer-refresh').addEventListener('click', loadCustomers);
  document.getElementById('customer-back').addEventListener('click', function () { switchTab('customers'); });

  function switchTab(which) {
    tab = which;
    /* the heading is the only thing that says which list this is once you have
       scrolled past the tabs */
    var titel = { orders: 'Orders', customers: 'Customers', documents: 'Invoices & offers', projects: 'Projects' };
    document.getElementById('list-heading').textContent = titel[which] || 'Projects';
    ['projects', 'orders', 'customers', 'documents'].forEach(function (name) {
      var knopf = document.getElementById('tab-' + name);
      knopf.classList.toggle('on', which === name);
      knopf.setAttribute('aria-selected', String(which === name));
    });
    document.getElementById('project-actions').hidden = which !== 'projects';
    document.getElementById('customer-actions').hidden = which !== 'customers';
    document.getElementById('document-actions').hidden = which !== 'documents';
    document.getElementById('import-card').hidden = true;
    document.getElementById('new-customer-card').hidden = true;
    document.getElementById('payments-card').hidden = true;
    document.getElementById('pdfs-card').hidden = true;
    newCard.hidden = true;

    if (which === 'orders') return loadOrders();
    if (which === 'customers') return loadCustomers();
    if (which === 'documents') return loadDocuments();
    return loadList();
  }

  /* ----------------------------------------------------------------------
     Orders
     ---------------------------------------------------------------------- */

  function loadOrders() {
    setStatus(listStatus, 'Loading…');

    return api('/orders')
      .then(function (data) {
        setStatus(listStatus, '');
        renderOrders(data);
        show('list');
      })
      .catch(function (error) {
        if (error.message.indexOf('session') === -1) setStatus(listStatus, error.message, 'error');
      });
  }

  function euro(cents) {
    return ((cents || 0) / 100).toFixed(2).replace('.', ',') + ' €';
  }

  function renderOrders(data) {
    document.querySelector('.admin-table-wrap').hidden = true;
    document.getElementById('list-empty').hidden = true;

    var orders = data.orders || [];
    document.getElementById('counts').innerHTML =
      '<div><dt>To ship</dt><dd class="' + (data.counts.toShip ? 'is-alert' : '') + '">' + data.counts.toShip + '</dd></div>' +
      '<div><dt>Orders</dt><dd>' + data.counts.total + '</dd></div>' +
      '<div><dt>Taken</dt><dd>' + euro(data.counts.revenueCents) + '</dd></div>';

    document.getElementById('orders-empty').hidden = orders.length > 0;
    document.getElementById('orders-wrap').hidden = orders.length === 0;

    var body = document.getElementById('orders-body');
    body.innerHTML = orders.map(function (o) {
      return '<tr tabindex="0" role="button" data-id="' + escapeHtml(o.id) + '">' +
        '<td class="mono">' + escapeHtml(o.invoiceNumber) + '</td>' +
        '<td>' + escapeHtml(o.buyerName || o.buyerEmail || '—') + '<br>' +
          '<span class="mono" style="font-size:.7rem;color:var(--grey-3)">' +
          escapeHtml([o.city, o.country].filter(Boolean).join(', ')) + '</span></td>' +
        '<td>' + escapeHtml(o.product && o.product.name ? o.product.name : '—') + '</td>' +
        '<td class="num mono">' + euro(o.totalCents) + '</td>' +
        '<td><span class="admin-chip is-' + escapeHtml(o.status) + '">' +
          escapeHtml(ORDER_STATUS[o.status] || o.status) + '</span></td>' +
        '<td class="mono">' + formatDate(o.createdAt) + '</td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (row) {
      row.addEventListener('click', function () { openOrder(row.dataset.id); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrder(row.dataset.id); }
      });
    });
  }

  /* ----------------------------------------------------------------------
     Kunden
     ---------------------------------------------------------------------- */

  function loadCustomers() {
    setStatus(listStatus, 'Loading…');

    return api('/customers')
      .then(function (data) {
        setStatus(listStatus, '');
        renderCustomers(data);
        show('list');
      })
      .catch(function (error) {
        if (error.message.indexOf('session') === -1) setStatus(listStatus, error.message, 'error');
      });
  }

  function renderCustomers(data) {
    document.querySelector('.admin-table-wrap').hidden = true;
    document.getElementById('list-empty').hidden = true;
    document.getElementById('orders-wrap').hidden = true;
    document.getElementById('orders-empty').hidden = true;
    document.getElementById('documents-wrap').hidden = true;
    document.getElementById('documents-empty').hidden = true;

    var customers = data.customers || [];
    document.getElementById('counts').innerHTML =
      '<div><dt>Customers</dt><dd>' + data.counts.total + '</dd></div>';

    document.getElementById('customers-empty').hidden = customers.length > 0;
    document.getElementById('customers-wrap').hidden = customers.length === 0;

    var body = document.getElementById('customers-body');
    body.innerHTML = customers.map(function (c) {
      return '<tr tabindex="0" role="button" data-id="' + escapeHtml(c.id) + '">' +
        '<td>' + escapeHtml(c.name) +
          (c.city ? '<br><span class="mono" style="font-size:.7rem;color:var(--grey-3)">' +
            escapeHtml(c.city) + '</span>' : '') + '</td>' +
        '<td class="mono" style="font-size:.75rem">' + escapeHtml(c.email || '—') + '</td>' +
        '<td class="num mono">' + c.counts.projects + '</td>' +
        '<td class="num mono">' + c.counts.orders + '</td>' +
        '<td class="num mono' + (c.counts.unpaid ? ' is-alert' : '') + '">' +
          (c.counts.documents + c.counts.legacyInvoices) +
          (c.counts.unpaid ? ' (' + c.counts.unpaid + ' offen)' : '') + '</td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (row) {
      row.addEventListener('click', function () { openCustomer(row.dataset.id); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCustomer(row.dataset.id); }
      });
    });
  }

  var offenerKunde = null;

  function openCustomer(id) {
    return api('/customers/' + id)
      .then(function (data) { renderCustomerDetail(data.customer); show('customer'); window.scrollTo(0, 0); })
      .catch(function (error) { setStatus(listStatus, error.message, 'error'); });
  }

  var LEGACY_STATUS = { issued: 'Issued', paid: 'Paid', cancelled: 'Cancelled' };

  function renderCustomerDetail(c) {
    offenerKunde = c;
    var a = c.address || {};

    document.getElementById('customer-detail-source').textContent =
      c.source === 'onlydesk' ? 'Imported from Onlydesk' : 'Customer';
    document.getElementById('customer-detail-name').textContent = c.name;
    document.getElementById('customer-detail-contact').textContent =
      [c.email, c.phone].filter(Boolean).join(' · ');

    function block(titel, inhalt) {
      return '<section class="sec"><h2 class="fat sub-h">' + titel + '</h2>' + inhalt + '</section>';
    }

    var anschrift = [c.name, a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.country]
      .filter(Boolean).map(escapeHtml).join('<br>');

    var rechnungen = (c.legacyInvoices || []).length
      ? '<table class="admin-table"><thead><tr><th>Number</th><th>Date</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>' +
        c.legacyInvoices.map(function (r) {
          return '<tr><td class="mono">' +
            (r.pdfKey
              ? '<a href="#" data-altpdf="' + escapeHtml(r.number) + '">' + escapeHtml(r.number) + '</a>'
              : escapeHtml(r.number)) + '</td>' +
            '<td class="mono">' + escapeHtml(r.date || '—') + '</td>' +
            '<td class="num mono">' + euro(r.totalCents) + '</td>' +
            '<td>' + escapeHtml(LEGACY_STATUS[r.status] || r.status) +
            /* Bei stornierten Rechnungen fehlt das PDF zu Recht. */
            (r.pdfKey || r.status === 'cancelled' ? '' : ' <span class="is-alert">· no PDF</span>') +
            '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="note">Issued by the previous system. Kept as they were — original numbers, not renumbered.</p>'
      : '<p class="admin-empty">None.</p>';

    var projekte = (c.projects || []).length
      ? '<ul class="checklist">' + c.projects.map(function (p) {
          return '<li>' + escapeHtml(p.title || 'Project') + ' — ' + escapeHtml(p.status) + '</li>';
        }).join('') + '</ul>'
      : '<p class="admin-empty">None.</p>';

    var bestellungen = (c.orders || []).length
      ? '<ul class="checklist">' + c.orders.map(function (o) {
          return '<li><span class="mono">' + escapeHtml(o.invoiceNumber) + '</span> — ' +
            euro(o.totalCents) + ' — ' + escapeHtml(o.status) + '</li>';
        }).join('') + '</ul>'
      : '<p class="admin-empty">None.</p>';

    var belege = (c.documents || []).length
      ? '<table class="admin-table"><thead><tr><th>Number</th><th>Subject</th>' +
        '<th class="num">Amount</th><th>State</th></tr></thead><tbody>' +
        c.documents.map(function (d) {
          return '<tr tabindex="0" role="button" data-beleg="' + escapeHtml(d.id) + '">' +
            '<td class="mono">' + escapeHtml(d.number || 'Draft') + '<br>' +
            '<span class="mono" style="font-size:.7rem;color:var(--grey-3)">' +
            (d.kind === 'invoice' ? 'Invoice' : 'Offer') + '</span></td>' +
            '<td>' + escapeHtml(d.title || '—') + '</td>' +
            '<td class="num mono">' + euro(d.totalCents) + '</td>' +
            '<td>' + escapeHtml(DOC_STATE[d.state] || d.state) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="admin-empty">None yet.</p>';

    document.getElementById('customer-detail-body').innerHTML =
      block('Address', '<p class="copy">' + (anschrift || '—') + '</p>' +
        (c.vatId ? '<p class="mono">VAT ' + escapeHtml(c.vatId) + '</p>' : '') +
        (c.note ? '<p class="copy">' + escapeHtml(c.note) + '</p>' : '')) +
      block('Offers and invoices', belege +
        '<div class="btn-row">' +
        '<button type="button" class="btn" id="customer-new-offer">New offer</button>' +
        '<button type="button" class="btn" id="customer-new-invoice">New invoice</button>' +
        '</div>') +
      block('Invoices from Onlydesk', rechnungen) +
      block('Projects', projekte) +
      block('Shop orders', bestellungen);

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-altpdf]'),
      function (link) {
        link.addEventListener('click', function (event) {
          event.preventDefault();
          api('/customers/' + c.id + '/legacy/' + encodeURIComponent(link.dataset.altpdf) + '/pdf')
            .then(function (data) { window.open(data.url, '_blank'); })
            .catch(function (error) {
              setStatus(document.getElementById('customer-detail-status'), error.message, 'error');
            });
        });
      }
    );

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-beleg]'),
      function (zeile) {
        zeile.addEventListener('click', function () { openDocument(zeile.dataset.beleg); });
        zeile.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDocument(zeile.dataset.beleg);
          }
        });
      }
    );

    /* Von hier aus geschrieben, steht der Kunde schon fest — das ist der
       kürzere Weg als über den Belegreiter und dort die Auswahl. */
    document.getElementById('customer-new-offer').addEventListener('click', function () {
      neuerBeleg('offer', { customerId: c.id });
    });
    document.getElementById('customer-new-invoice').addEventListener('click', function () {
      neuerBeleg('invoice', { customerId: c.id });
    });
  }

  document.getElementById('customer-delete').addEventListener('click', function () {
    if (!offenerKunde) return;
    if (!window.confirm('Delete ' + offenerKunde.name + '? This cannot be undone.')) return;

    api('/customers/' + offenerKunde.id, { method: 'DELETE' })
      .then(function () { switchTab('customers'); })
      .catch(function (error) {
        setStatus(document.getElementById('customer-detail-status'), error.message, 'error');
      });
  });

  /* ----------------------------------------------------------------------
     Kunden anlegen
     ---------------------------------------------------------------------- */

  document.getElementById('new-customer').addEventListener('click', function () {
    var karte = document.getElementById('new-customer-card');
    karte.hidden = !karte.hidden;
    if (!karte.hidden) document.getElementById('nc-name').focus();
  });

  document.getElementById('new-customer-cancel').addEventListener('click', function () {
    document.getElementById('new-customer-card').hidden = true;
  });

  document.getElementById('new-customer-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var status = document.getElementById('new-customer-status');
    setStatus(status, 'Saving…');

    var wert = function (id) { return document.getElementById(id).value.trim(); };

    api('/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: wert('nc-name'),
        email: wert('nc-email'),
        phone: wert('nc-phone'),
        vatId: wert('nc-vat'),
        address: {
          line1: wert('nc-line1'),
          postalCode: wert('nc-postal'),
          city: wert('nc-city'),
          country: wert('nc-country')
        }
      })
    })
      .then(function (data) {
        setStatus(status, data.created ? '' : 'That one was already in the list.');
        if (data.created) {
          document.getElementById('new-customer-form').reset();
          document.getElementById('nc-country').value = 'Deutschland';
          document.getElementById('new-customer-card').hidden = true;
        }
        loadCustomers();
      })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  /* ----------------------------------------------------------------------
     Angebote und Rechnungen
     ---------------------------------------------------------------------- */

  var katalog = [];
  var offenerBeleg = null;

  var DOC_STATE = {
    draft: 'Draft', issued: 'Issued', paid: 'Paid', cancelled: 'Cancelled',
    accepted: 'Accepted', declined: 'Declined'
  };

  function ladeKatalog() {
    if (katalog.length) return Promise.resolve(katalog);

    return api('/catalogue').then(function (data) {
      katalog = data.services || [];
      return katalog;
    });
  }

  function loadDocuments() {
    setStatus(listStatus, 'Loading…');

    return api('/documents')
      .then(function (data) {
        setStatus(listStatus, '');
        renderDocuments(data);
        show('list');
      })
      .catch(function (error) {
        if (error.message.indexOf('session') === -1) setStatus(listStatus, error.message, 'error');
      });
  }

  function renderDocuments(data) {
    document.querySelector('.admin-table-wrap').hidden = true;
    document.getElementById('list-empty').hidden = true;
    document.getElementById('orders-wrap').hidden = true;
    document.getElementById('orders-empty').hidden = true;
    document.getElementById('customers-wrap').hidden = true;
    document.getElementById('customers-empty').hidden = true;

    var docs = data.documents || [];
    document.getElementById('counts').innerHTML =
      '<div><dt>Drafts</dt><dd>' + data.counts.drafts + '</dd></div>' +
      '<div><dt>Open invoices</dt><dd class="' + (data.counts.open ? 'is-alert' : '') + '">' +
        data.counts.open + '</dd></div>' +
      '<div><dt>Total</dt><dd>' + data.counts.total + '</dd></div>';

    document.getElementById('documents-empty').hidden = docs.length > 0;
    document.getElementById('documents-wrap').hidden = docs.length === 0;

    var body = document.getElementById('documents-body');
    body.innerHTML = docs.map(function (d) {
      return '<tr tabindex="0" role="button" data-id="' + escapeHtml(d.id) + '">' +
        '<td class="mono">' + escapeHtml(d.number || '—') + '<br>' +
          '<span class="mono" style="font-size:.7rem;color:var(--grey-3)">' +
          (d.kind === 'invoice' ? 'Invoice' : 'Offer') + '</span></td>' +
        '<td>' + escapeHtml(d.recipientName || '—') + '</td>' +
        '<td>' + escapeHtml(d.title || '—') + '</td>' +
        '<td class="num mono">' + euro(d.totalCents) + '</td>' +
        '<td><span class="admin-chip">' + escapeHtml(DOC_STATE[d.state] || d.state) + '</span></td>' +
        '<td class="mono">' + formatDate(d.issuedAt || d.createdAt) + '</td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (row) {
      row.addEventListener('click', function () { openDocument(row.dataset.id); });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDocument(row.dataset.id); }
      });
    });
  }

  function neuerBeleg(kind, vorgabe) {
    return ladeKatalog()
      .then(function () {
        return api('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ kind: kind, items: [] }, vorgabe || {}))
        });
      })
      .then(function (data) { return openDocument(data.document.id); })
      .catch(function (error) { setStatus(listStatus, error.message, 'error'); });
  }

  document.getElementById('new-offer').addEventListener('click', function () { neuerBeleg('offer'); });
  document.getElementById('new-invoice').addEventListener('click', function () { neuerBeleg('invoice'); });

  function openDocument(id) {
    return Promise.all([ladeKatalog(), api('/documents/' + id), api('/customers')])
      .then(function (ergebnisse) {
        renderDocument(ergebnisse[1].document, ergebnisse[2].customers || []);
        show('document');
        window.scrollTo(0, 0);
      })
      .catch(function (error) { setStatus(listStatus, error.message, 'error'); });
  }

  function renderDocument(d, kunden) {
    offenerBeleg = d;
    var entwurf = d.state === 'draft';
    var rechnung = d.kind === 'invoice';

    document.getElementById('document-kicker').textContent =
      (rechnung ? 'Invoice' : 'Offer') + ' · ' + (DOC_STATE[d.state] || d.state);
    document.getElementById('document-number').textContent = d.number || 'Draft';
    document.getElementById('document-recipient').textContent = d.recipient
      ? [d.recipient.name, d.recipient.email].filter(Boolean).join(' · ')
      : 'No recipient yet — pick a customer below.';

    document.getElementById('document-editor').hidden = !entwurf;
    document.getElementById('document-issue').hidden = !entwurf;
    document.getElementById('document-discard').hidden = !entwurf;
    document.getElementById('document-send').hidden = entwurf;
    document.getElementById('document-cancel').hidden = entwurf || d.state === 'cancelled';
    document.getElementById('doc-valid-hint').hidden = !rechnung;
    document.getElementById('doc-valid').parentNode.hidden = rechnung;

    if (entwurf) {
      var auswahl = document.getElementById('doc-customer');
      auswahl.innerHTML = '<option value="">— none —</option>' + kunden.map(function (k) {
        return '<option value="' + escapeHtml(k.id) + '"' + (k.id === d.customerId ? ' selected' : '') +
          '>' + escapeHtml(k.name) + '</option>';
      }).join('');

      document.getElementById('doc-add-service').innerHTML = katalog.map(function (service) {
        return '<option value="' + escapeHtml(service.slug) + '">' + escapeHtml(service.name) +
          ' — ' + euro(service.unitCents) + '</option>';
      }).join('');

      document.getElementById('doc-title').value = d.title || '';
      document.getElementById('doc-intro').value = d.intro || '';
      document.getElementById('doc-valid').value = d.validUntil ? d.validUntil.slice(0, 10) : '';

      zeichnePositionen(d.items || []);
    } else {
      /* Ausgestellt: nichts mehr zum Tippen, nur noch zum Nachlesen. */
      document.getElementById('document-frozen').hidden = false;
      document.getElementById('document-frozen').innerHTML =
        '<section class="sec"><h2 class="fat sub-h">' + escapeHtml(d.title || 'Document') + '</h2>' +
        '<table class="admin-table"><tbody>' +
        (d.items || []).map(function (p) {
          return '<tr><td>' + escapeHtml(p.name) + '</td><td class="num mono">' + p.quantity +
            '</td><td class="num mono">' + euro(p.totalCents) + '</td></tr>';
        }).join('') +
        '<tr><td><strong>Total</strong></td><td></td><td class="num mono"><strong>' +
        euro(d.totalCents) + '</strong></td></tr></tbody></table>' +
        (d.sentAt ? '<p class="note">Sent ' + formatDate(d.sentAt) + ' to ' +
          escapeHtml(d.recipient && d.recipient.email || '') + '.</p>' : '<p class="note">Not sent yet.</p>') +
        '</section>';
    }
  }

  var positionen = [];

  function zeichnePositionen(items) {
    positionen = items.slice();
    var ziel = document.getElementById('doc-items');

    ziel.innerHTML = positionen.map(function (p, i) {
      return '<div class="handoff-fieldset handoff-grid-two" data-zeile="' + i + '">' +
        '<div class="form-group"><label>Line</label>' +
        '<input type="text" data-feld="name" value="' + escapeHtml(p.name) + '"></div>' +
        '<div class="form-group"><label>Quantity × unit price (€)</label>' +
        '<span style="display:flex;gap:.5rem">' +
        '<input type="number" step="0.5" min="0" data-feld="quantity" value="' + p.quantity + '" style="width:5rem">' +
        '<input type="number" step="0.01" min="0" data-feld="unit" value="' + (p.unitCents / 100).toFixed(2) + '">' +
        '<button type="button" class="btn btn-secondary" data-weg="' + i + '">×</button>' +
        '</span></div>' +
        '<div class="form-group" style="grid-column:1/-1"><label>Description</label>' +
        '<textarea rows="2" data-feld="description">' + escapeHtml(p.description || '') + '</textarea></div>' +
        '</div>';
    }).join('') || '<p class="admin-empty">No lines yet.</p>';

    Array.prototype.forEach.call(ziel.querySelectorAll('[data-weg]'), function (knopf) {
      knopf.addEventListener('click', function () {
        positionen.splice(Number(knopf.dataset.weg), 1);
        zeichnePositionen(positionen);
      });
    });

    Array.prototype.forEach.call(ziel.querySelectorAll('input,textarea'), function (feld) {
      feld.addEventListener('input', function () { lesePositionen(); zeigeSumme(); });
    });

    zeigeSumme();
  }

  function lesePositionen() {
    var ziel = document.getElementById('doc-items');

    positionen = Array.prototype.map.call(ziel.querySelectorAll('[data-zeile]'), function (zeile, i) {
      var lies = function (feld) {
        var el = zeile.querySelector('[data-feld="' + feld + '"]');
        return el ? el.value : '';
      };

      return {
        slug: positionen[i] ? positionen[i].slug : null,
        name: lies('name'),
        description: lies('description'),
        quantity: Number(lies('quantity')) || 0,
        unitCents: Math.round(Number(lies('unit')) * 100) || 0
      };
    });

    return positionen;
  }

  function zeigeSumme() {
    var summe = positionen.reduce(function (s, p) { return s + Math.round(p.quantity * p.unitCents); }, 0);
    document.getElementById('doc-total').textContent = euro(summe);
  }

  document.getElementById('doc-add').addEventListener('click', function () {
    var slug = document.getElementById('doc-add-service').value;
    var service = katalog.filter(function (x) { return x.slug === slug; })[0];
    if (!service) return;

    lesePositionen();
    positionen.push({
      slug: service.slug, name: service.name,
      description: service.description, quantity: 1, unitCents: service.unitCents
    });
    zeichnePositionen(positionen);
  });

  document.getElementById('document-form').addEventListener('submit', function (event) {
    event.preventDefault();
    speichereBeleg().then(function () {
      setStatus(document.getElementById('document-status'), 'Saved.');
    });
  });

  function speichereBeleg() {
    var status = document.getElementById('document-status');
    setStatus(status, 'Saving…');
    lesePositionen();

    var gueltig = document.getElementById('doc-valid').value;
    var kundenId = document.getElementById('doc-customer').value;

    return api('/documents/' + offenerBeleg.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('doc-title').value,
        intro: document.getElementById('doc-intro').value,
        validUntil: gueltig ? new Date(gueltig).toISOString() : null,
        customerId: kundenId || null,
        items: positionen
      })
    }).then(function (data) {
      offenerBeleg = data.document;
      return data.document;
    }).catch(function (error) {
      setStatus(status, error.message, 'error');
      throw error;
    });
  }

  document.getElementById('document-preview').addEventListener('click', function () {
    var status = document.getElementById('document-status');

    var weiter = offenerBeleg.state === 'draft' ? speichereBeleg() : Promise.resolve();

    weiter.then(function () {
      return fetch(API + '/documents/' + offenerBeleg.id + '/pdf', { credentials: 'same-origin' });
    }).then(function (antwort) {
      var typ = antwort.headers.get('content-type') || '';

      if (typ.indexOf('application/pdf') !== -1) {
        return antwort.blob().then(function (blob) { window.open(URL.createObjectURL(blob), '_blank'); });
      }

      return antwort.json().then(function (data) { window.open(data.url, '_blank'); });
    }).catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  document.getElementById('document-issue').addEventListener('click', function () {
    var status = document.getElementById('document-status');

    if (!window.confirm('Issue this? It gets a number and cannot be changed afterwards.')) return;

    speichereBeleg()
      .then(function () {
        return api('/documents/' + offenerBeleg.id + '/issue', { method: 'POST' });
      })
      .then(function (data) { return openDocument(data.document.id); })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  document.getElementById('document-send').addEventListener('click', function () {
    var status = document.getElementById('document-status');
    var an = offenerBeleg.recipient && offenerBeleg.recipient.email;

    if (!an) { setStatus(status, 'This recipient has no email address.', 'error'); return; }
    if (!window.confirm('Send to ' + an + '?')) return;

    setStatus(status, 'Sending…');

    api('/documents/' + offenerBeleg.id + '/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    })
      .then(function (data) { setStatus(status, 'Sent to ' + data.sentTo + '.'); return openDocument(offenerBeleg.id); })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  document.getElementById('document-cancel').addEventListener('click', function () {
    if (!window.confirm('Cancel this document? It stays on file, marked cancelled.')) return;

    api('/documents/' + offenerBeleg.id + '/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'cancelled' })
    }).then(function () { return openDocument(offenerBeleg.id); });
  });

  document.getElementById('document-discard').addEventListener('click', function () {
    if (!window.confirm('Throw this draft away?')) return;

    api('/documents/' + offenerBeleg.id, { method: 'DELETE' })
      .then(function () { switchTab('documents'); })
      .catch(function (error) {
        setStatus(document.getElementById('document-status'), error.message, 'error');
      });
  });

  /* ----------------------------------------------------------------------
     Alte Rechnungs-PDFs einspielen
     ---------------------------------------------------------------------- */

  document.getElementById('pdfs-open').addEventListener('click', function () {
    var karte = document.getElementById('pdfs-card');
    karte.hidden = !karte.hidden;
    document.getElementById('pdfs-report').hidden = true;
    setStatus(document.getElementById('pdfs-status'), '');
  });

  document.getElementById('pdfs-cancel').addEventListener('click', function () {
    document.getElementById('pdfs-card').hidden = true;
  });

  document.getElementById('pdfs-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var dateien = document.getElementById('pdfs-files').files;
    var status = document.getElementById('pdfs-status');
    if (!dateien.length) return;

    var paket = new FormData();
    Array.prototype.forEach.call(dateien, function (datei) { paket.append('files', datei); });

    setStatus(status, 'Uploading ' + dateien.length + ' files…');

    /* Ohne Content-Type: den setzt der Browser samt Grenzmarkierung selbst. */
    api('/customers/legacy-invoices/pdfs', { method: 'POST', body: paket })
      .then(function (bericht) {
        setStatus(status, '');
        var ziel = document.getElementById('pdfs-report');

        ziel.innerHTML =
          '<dl class="admin-counts">' +
          '<div><dt>Filed</dt><dd>' + bericht.stored + '</dd></div>' +
          '<div><dt>No invoice</dt><dd class="' + (bericht.unknown.length ? 'is-alert' : '') + '">' +
            bericht.unknown.length + '</dd></div>' +
          '<div><dt>Still without PDF</dt><dd class="' +
            (bericht.stillWithoutPdf.length ? 'is-alert' : '') + '">' +
            bericht.stillWithoutPdf.length + '</dd></div></dl>' +
          (bericht.unknown.length
            ? '<p class="note">No invoice carries these numbers: ' +
              escapeHtml(bericht.unknown.join(', ')) + '</p>'
            : '') +
          (bericht.stillWithoutPdf.length
            ? '<p class="note">These invoices have no PDF on file. They have to be kept for ten ' +
              'years under § 147 AO, so it is worth tracking them down: ' +
              escapeHtml(bericht.stillWithoutPdf.join(', ')) + '</p>'
            : '<p class="note">Every invoice that is not cancelled has its PDF.</p>');

        ziel.hidden = false;
        loadCustomers();
      })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  /* ----------------------------------------------------------------------
     Kontoauszug einlesen
     ---------------------------------------------------------------------- */

  var gefundeneZahlungen = [];

  document.getElementById('payments-open').addEventListener('click', function () {
    var karte = document.getElementById('payments-card');
    karte.hidden = !karte.hidden;
    document.getElementById('payments-report').hidden = true;
    setStatus(document.getElementById('payments-status'), '');
  });

  document.getElementById('payments-cancel').addEventListener('click', function () {
    document.getElementById('payments-card').hidden = true;
    document.getElementById('pdfs-card').hidden = true;
  });

  document.getElementById('payments-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var datei = document.getElementById('payments-file').files[0];
    var status = document.getElementById('payments-status');
    if (!datei) return;

    setStatus(status, 'Reading…');

    datei.text()
      .then(function (csv) {
        return api('/payments/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csv })
        });
      })
      .then(function (bericht) { setStatus(status, ''); zeigeZahlungen(bericht); })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  function zeigeZahlungen(b) {
    gefundeneZahlungen = b.matches || [];
    var ziel = document.getElementById('payments-report');
    var sicher = gefundeneZahlungen.filter(function (m) { return m.certain; }).length;

    ziel.innerHTML =
      '<dl class="admin-counts">' +
      '<div><dt>Incoming</dt><dd>' + b.incoming + '</dd></div>' +
      '<div><dt>Matched</dt><dd>' + gefundeneZahlungen.length + '</dd></div>' +
      '<div><dt>By number</dt><dd>' + sicher + '</dd></div>' +
      '<div><dt>Still open</dt><dd class="' + (b.stillOpen.length ? 'is-alert' : '') + '">' +
        b.stillOpen.length + '</dd></div>' +
      '</dl>' +
      (gefundeneZahlungen.length
        ? '<table class="admin-table"><thead><tr><th></th><th>Invoice</th><th>Who</th>' +
          '<th class="num">Amount</th><th>Date</th><th>How</th></tr></thead><tbody>' +
          gefundeneZahlungen.map(function (m, i) {
            return '<tr><td><input type="checkbox" data-zahlung="' + i + '"' +
              (m.certain ? ' checked' : '') + '></td>' +
              '<td class="mono">' + escapeHtml(m.number) + '</td>' +
              '<td>' + escapeHtml(m.who || m.counterparty || '—') + '</td>' +
              '<td class="num mono">' + euro(m.amountCents) + '</td>' +
              '<td class="mono">' + escapeHtml(m.date) + '</td>' +
              '<td>' + (m.certain
                ? 'number in the reference'
                : '<span class="is-alert">amount only — check</span>') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          /* Unsichere Treffer stehen abgewählt da: sie beruhen nur auf dem
             Betrag, und eine falsch abgehakte Rechnung merkt niemand. */
          '<p class="note">Ticked rows carry the invoice number in the reference. ' +
          'Amount-only matches are left for you to confirm.</p>' +
          '<div class="btn-row"><button type="button" class="btn fill" id="payments-apply">Mark ticked as paid</button></div>'
        : '<p class="admin-empty">Nothing matched an open invoice.</p>') +
      (b.unmatched.length
        ? '<h3>Not matched</h3><ul class="checklist">' + b.unmatched.map(function (u) {
            return '<li>' + euro(u.amountCents) + ' on ' + escapeHtml(u.date) + ' — ' +
              escapeHtml(u.counterparty || u.reference || '') +
              (u.reason === 'ambiguous'
                ? ' <span class="is-alert">(several invoices have this amount: ' +
                  escapeHtml(u.candidates.join(', ')) + ')</span>'
                : '') + '</li>';
          }).join('') + '</ul>'
        : '');

    ziel.hidden = false;

    var knopf = document.getElementById('payments-apply');
    if (knopf) knopf.addEventListener('click', uebernehmeZahlungen);
  }

  function uebernehmeZahlungen() {
    var status = document.getElementById('payments-status');
    var gewaehlt = [];

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-zahlung]'),
      function (kasten) {
        if (kasten.checked) gewaehlt.push(gefundeneZahlungen[Number(kasten.dataset.zahlung)]);
      }
    );

    if (!gewaehlt.length) { setStatus(status, 'Nothing ticked.', 'error'); return; }

    setStatus(status, 'Marking…');

    api('/payments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches: gewaehlt })
    })
      .then(function (data) {
        setStatus(status, data.paid + ' marked as paid.' +
          (data.failed.length ? ' ' + data.failed.length + ' could not be.' : ''));
        document.getElementById('payments-report').hidden = true;
        loadDocuments();
      })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  }

  /* ----------------------------------------------------------------------
     Onlydesk-Import
     ---------------------------------------------------------------------- */

  var importDatei = null;

  document.getElementById('import-open').addEventListener('click', function () {
    var karte = document.getElementById('import-card');
    karte.hidden = !karte.hidden;
    document.getElementById('import-report').hidden = true;
    setStatus(document.getElementById('import-status'), '');
  });

  document.getElementById('import-cancel').addEventListener('click', function () {
    document.getElementById('import-card').hidden = true;
  });

  document.getElementById('import-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var datei = document.getElementById('import-file').files[0];
    var status = document.getElementById('import-status');

    if (!datei) return;

    setStatus(status, 'Reading…');

    datei.text()
      .then(function (text) {
        importDatei = JSON.parse(text);
        return schickeImport(false);
      })
      .catch(function (error) {
        setStatus(status, error.message.indexOf('JSON') !== -1
          ? 'That file is not the export — it does not parse as JSON.'
          : error.message, 'error');
      });
  });

  function schickeImport(anwenden) {
    var status = document.getElementById('import-status');
    setStatus(status, anwenden ? 'Importing…' : 'Checking…');

    return api('/customers/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ export: importDatei, apply: anwenden })
    }).then(function (bericht) {
      setStatus(status, '');
      zeigeBericht(bericht);
      if (anwenden) loadCustomers();
    }).catch(function (error) {
      setStatus(status, error.message, 'error');
    });
  }

  function zeigeBericht(b) {
    var ziel = document.getElementById('import-report');
    var offen = b.unmatched || [];

    ziel.innerHTML =
      '<dl class="admin-counts">' +
      '<div><dt>Customers</dt><dd>' + b.customers + '</dd></div>' +
      '<div><dt>Invoices</dt><dd>' + b.invoices + '</dd></div>' +
      '<div><dt>Matched</dt><dd>' + b.matched + '</dd></div>' +
      '<div><dt>Unmatched</dt><dd class="' + (offen.length ? 'is-alert' : '') + '">' + offen.length + '</dd></div>' +
      '</dl>' +
      (offen.length
        ? '<p class="note">These invoices name someone who is not in the list, so they were left alone rather than guessed at:</p><ul class="checklist">' +
          offen.map(function (r) {
            return '<li><span class="mono">' + escapeHtml(r.number) + '</span> — „' + escapeHtml(r.name) + '"</li>';
          }).join('') + '</ul>'
        : '') +
      (b.dryRun
        ? '<div class="btn-row"><button type="button" class="btn fill" id="import-apply">Import now</button></div>' +
          '<p class="note">Nothing has been written yet.</p>'
        : '<p class="note">Done. ' + b.created + ' customers added, ' + b.filed + ' invoices filed.</p>');

    ziel.hidden = false;

    var knopf = document.getElementById('import-apply');
    if (knopf) knopf.addEventListener('click', function () { schickeImport(true); });
  }

  function openOrder(id) {
    return api('/orders/' + id)
      .then(function (data) { renderOrderDetail(data.order); show('order'); window.scrollTo(0, 0); })
      .catch(function (error) { setStatus(listStatus, error.message, 'error'); });
  }

  function renderOrderDetail(o) {
    var b = o.buyer || {};
    document.getElementById('order-detail-reference').textContent =
      o.invoiceNumber + ' · ' + (ORDER_STATUS[o.status] || o.status);
    document.getElementById('order-detail-title').textContent = o.product ? o.product.name : 'Order';
    document.getElementById('order-detail-buyer').textContent =
      (b.name || '') + (b.email ? ' · ' + b.email : '');

    var anschrift = [b.name, b.line1, b.line2,
      [b.postalCode, b.city].filter(Boolean).join(' '), b.country]
      .filter(Boolean).map(escapeHtml).join('\n');

    document.getElementById('order-detail-body').innerHTML = [
      /* the address first: it is the reason this page gets opened */
      '<section class="handoff-card">' +
        '<h2>Post it to</h2>' +
        '<address class="admin-address">' + anschrift + '</address>' +
        '<div class="btn-row" style="margin-top:1.2rem">' +
          '<button type="button" class="btn btn-secondary admin-copy" data-url="' +
            escapeHtml([b.name, b.line1, b.line2, [b.postalCode, b.city].filter(Boolean).join(' '), b.country].filter(Boolean).join('\n')) +
          '">Copy address</button>' +
          (o.hasInvoice ? '<button type="button" class="btn btn-secondary" id="order-invoice">Invoice PDF</button>' : '') +
        '</div>' +
      '</section>',

      '<section class="handoff-card">' +
        '<h2>What was paid</h2>' +
        '<dl class="handoff-summary-list">' +
          '<div><dt>Item</dt><dd>' + euro(o.itemCents) + '</dd></div>' +
          '<div><dt>Shipping</dt><dd>' + euro(o.shippingCents) + '</dd></div>' +
          '<div><dt>Total</dt><dd>' + euro(o.totalCents) + '</dd></div>' +
        '</dl>' +
        (o.mailSent ? '' : '<p class="mono" style="color:var(--bad);margin-top:1rem">' +
          'The confirmation email did not go out. Send the invoice by hand.</p>') +
      '</section>',

      o.status === 'paid' ? '<section class="handoff-card">' +
        '<h2>Mark as posted</h2>' +
        '<p>Tells the buyer it is on its way.</p>' +
        '<form class="handoff-form" id="ship-form">' +
          '<div class="handoff-fieldset"><div class="form-group">' +
            '<label for="ship-note">Tracking or a note (optional)</label>' +
            '<input type="text" id="ship-note" name="note" placeholder="DHL 00340434161094042557">' +
          '</div></div>' +
          '<div class="handoff-actions"><button type="submit" class="btn fill">Posted</button></div>' +
          '<div class="handoff-status" id="ship-status" role="status" aria-live="polite"></div>' +
        '</form>' +
      '</section>' : '<section class="handoff-card"><h2>Posted</h2><p>' +
        formatDateTime(o.shippedAt) + (o.trackingNote ? ' · ' + escapeHtml(o.trackingNote) : '') + '</p></section>',

      (o.events || []).length ? '<section class="handoff-card"><h2>History</h2><ol class="admin-history">' +
        o.events.slice().reverse().map(function (e) {
          return '<li><span class="mono">' + formatDateTime(e.at) + '</span> ' + escapeHtml(e.type.replace(/_/g, ' ')) + '</li>';
        }).join('') + '</ol></section>' : ''
    ].join('');

    wireOrderDetail(o);
  }

  function wireOrderDetail(o) {
    var invoice = document.getElementById('order-invoice');
    if (invoice) {
      invoice.addEventListener('click', function () {
        api('/orders/' + o.id + '/invoice')
          .then(function (data) { window.location.href = data.url; })
          .catch(function (error) { window.alert(error.message); });
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.admin-copy'), function (button) {
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(button.dataset.url).then(function () {
          var original = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = original; }, 1500);
        });
      });
    });

    var form = document.getElementById('ship-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var shipStatus = document.getElementById('ship-status');
        setStatus(shipStatus, 'Sending…');

        api('/orders/' + o.id + '/shipped', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: document.getElementById('ship-note').value })
        })
          .then(function (data) {
            if (!data.notification || !data.notification.sent) {
              setStatus(shipStatus, 'Marked as posted, but the email did not go out.', 'error');
              window.setTimeout(function () { openOrder(o.id); }, 2500);
              return;
            }
            return openOrder(o.id);
          })
          .catch(function (error) { setStatus(shipStatus, error.message, 'error'); });
      });
    }
  }

  /* --- new project --- */

  var newCard = document.getElementById('new-project-card');

  document.getElementById('new-project').addEventListener('click', function () {
    newCard.hidden = !newCard.hidden;
    if (!newCard.hidden) document.getElementById('np-email').focus();
  });

  document.getElementById('new-project-cancel').addEventListener('click', function () {
    newCard.hidden = true;
  });

  document.getElementById('new-project-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var status = document.getElementById('new-project-status');
    setStatus(status, 'Creating…');

    var form = event.target;
    api('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: form.clientName.value,
        clientEmail: form.clientEmail.value,
        title: form.title.value,
        service: form.service.value
      })
    })
      .then(function (data) {
        setStatus(status, '');
        form.reset();
        newCard.hidden = true;
        openProject(data.project.id);
      })
      .catch(function (error) { setStatus(status, error.message, 'error'); });
  });

  /* ----------------------------------------------------------------------
     Detail
     ---------------------------------------------------------------------- */

  function openProject(id) {
    return api('/projects/' + id)
      .then(function (data) {
        renderDetail(data.project);
        show('detail');
        window.scrollTo(0, 0);
      })
      .catch(function (error) { setStatus(listStatus, error.message, 'error'); });
  }

  function renderDetail(p) {
    document.getElementById('detail-reference').textContent =
      p.reference + ' · ' + (STATUS_LABELS[p.status] || p.status);
    document.getElementById('detail-title').textContent = p.title || p.reference;
    document.getElementById('detail-client').textContent =
      (p.client.name ? p.client.name + ' · ' : '') + (p.client.email || 'no email on file');

    var openRevisions = (p.revisions || []).filter(function (r) {
      var last = (p.deliveries || [])[p.deliveries.length - 1];
      return !last || r.requestedAt > last.sentAt;
    });

    document.getElementById('detail-body').innerHTML = [
      openRevisions.length ? revisionAlert(openRevisions) : '',
      deliverCard(p),
      belegKarte(p),
      sourceCard(p),
      historyCard(p),
      closeCard(p)
    ].join('');

    wireDetail(p);
    ladeProjektbelege(p);
  }

  /* Was zu diesem Projekt abgerechnet wurde. Der Kunde steht hier schon fest,
     also ist das der kürzeste Weg zu einer Rechnung — kein zweites Mal Namen
     und Adresse suchen. */
  function belegKarte(p) {
    return '<section class="handoff-card">' +
      '<h2>Offers and invoices</h2>' +
      '<div id="projekt-belege"><p class="admin-empty">Loading…</p></div>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn" id="projekt-angebot">New offer</button>' +
      '<button type="button" class="btn" id="projekt-rechnung">New invoice</button>' +
      '</div></section>';
  }

  function ladeProjektbelege(p) {
    api('/documents?projectId=' + encodeURIComponent(p.id))
      .then(function (data) {
        var docs = data.documents || [];
        document.getElementById('projekt-belege').innerHTML = docs.length
          ? '<ul class="checklist">' + docs.map(function (d) {
              return '<li><a href="#" data-projektbeleg="' + escapeHtml(d.id) + '">' +
                '<span class="mono">' + escapeHtml(d.number || 'Draft') + '</span></a> — ' +
                escapeHtml(d.title || (d.kind === 'invoice' ? 'Invoice' : 'Offer')) + ' — ' +
                euro(d.totalCents) + ' — ' + escapeHtml(DOC_STATE[d.state] || d.state) + '</li>';
            }).join('') + '</ul>'
          : '<p class="admin-empty">Nothing billed for this project yet.</p>';

        Array.prototype.forEach.call(
          document.querySelectorAll('[data-projektbeleg]'),
          function (link) {
            link.addEventListener('click', function (event) {
              event.preventDefault();
              openDocument(link.dataset.projektbeleg);
            });
          }
        );
      })
      .catch(function () {
        document.getElementById('projekt-belege').innerHTML =
          '<p class="admin-empty">Could not load them.</p>';
      });

    document.getElementById('projekt-angebot').addEventListener('click', function () {
      neuerBeleg('offer', { projectId: p.id, title: p.title || '' });
    });
    document.getElementById('projekt-rechnung').addEventListener('click', function () {
      neuerBeleg('invoice', { projectId: p.id, title: p.title || '' });
    });
  }

  function revisionAlert(revisions) {
    return '<section class="handoff-card admin-alert">' +
      '<h2>' + revisions.length + ' change' + (revisions.length === 1 ? '' : 's') + ' requested</h2>' +
      revisions.map(function (r) {
        return '<blockquote class="admin-revision">' +
          '<p>' + escapeHtml(r.message).replace(/\n/g, '<br>') + '</p>' +
          '<footer class="mono">Version ' + r.version + ' · ' + formatDateTime(r.requestedAt) +
            (r.files && r.files.length ? ' · ' + r.files.length + ' attachment' + (r.files.length === 1 ? '' : 's') : '') +
          '</footer>' +
          (r.files || []).map(function (f) {
            return '<a class="admin-file-link" href="#" data-file="' + escapeHtml(f.id) + '">' +
              escapeHtml(f.name) + ' <span class="mono">' + formatBytes(f.size) + '</span></a>';
          }).join('') +
          (r.acknowledgedAt
            ? '<p class="mono admin-ack">Confirmed ' + formatDateTime(r.acknowledgedAt) + '</p>'
            : '<button type="button" class="btn btn-secondary admin-ack-btn" data-revision="' + escapeHtml(r.id) + '">Tell them it arrived</button>') +
        '</blockquote>';
      }).join('') +
    '</section>';
  }

  function deliverCard(p) {
    var next = (p.currentVersion || 0) + 1;

    return '<section class="handoff-card">' +
      '<h2>Send ' + (next > 1 ? 'version ' + next : 'the files') + '</h2>' +
      '<p>Pick the files, add a note if you like, and send. The client gets a link straight away' +
        (p.client.email ? ' at <strong>' + escapeHtml(p.client.email) + '</strong>' : '') + '.</p>' +
      '<form class="handoff-form" id="deliver-form">' +
        '<div class="handoff-fieldset">' +
          '<div class="form-group">' +
            '<label for="deliver-files">Files</label>' +
            '<input type="file" id="deliver-files" name="files" multiple required>' +
          '</div>' +
        '</div>' +
        '<div class="handoff-fieldset">' +
          '<div class="form-group">' +
            '<label for="deliver-note">Note for the client (optional)</label>' +
            '<textarea id="deliver-note" name="note" rows="3" placeholder="Brought the vocal up a little and tightened the low end."></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="handoff-actions">' +
          '<button type="submit" class="btn fill" id="deliver-submit">Upload and send</button>' +
        '</div>' +
        '<div class="handoff-status" id="deliver-status" role="status" aria-live="polite"></div>' +
      '</form>' +
      ((p.deliveries || []).length ? deliveryHistory(p) : '') +
    '</section>';
  }

  function deliveryHistory(p) {
    return '<div class="admin-deliveries"><h3>Already sent</h3>' +
      p.deliveries.slice().reverse().map(function (d) {
        return '<div class="admin-delivery">' +
          '<div>' +
            '<span class="admin-delivery-version mono">v' + d.version + '</span> ' +
            '<span class="mono">' + formatDateTime(d.sentAt) + '</span>' +
            (d.firstDownloadedAt
              ? '<span class="admin-dot is-ok" title="Collected ' + formatDateTime(d.firstDownloadedAt) + '">collected</span>'
              : '<span class="admin-dot">not collected yet</span>') +
          '</div>' +
          '<div class="admin-delivery-actions">' +
            '<button type="button" class="btn btn-secondary admin-copy" data-url="' + escapeHtml(d.pageUrl) + '">Copy link</button>' +
            '<button type="button" class="btn btn-secondary admin-resend" data-delivery="' + escapeHtml(d.id) + '">Send again</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function sourceCard(p) {
    if (!(p.sourceFiles || []).length) return '';

    return '<section class="handoff-card">' +
      '<h2>What the client sent</h2>' +
      (p.notes ? '<blockquote class="admin-revision"><p>' + escapeHtml(p.notes).replace(/\n/g, '<br>') + '</p></blockquote>' : '') +
      '<ul class="delivery-files">' +
        p.sourceFiles.map(function (f) {
          return '<li><div><span class="delivery-file-name">' + escapeHtml(f.name) + '</span>' +
            '<span class="delivery-file-size mono">' + formatBytes(f.size) + '</span></div>' +
            '<button type="button" class="btn admin-file-btn" data-file="' + escapeHtml(f.id) + '">Download</button></li>';
        }).join('') +
      '</ul>' +
    '</section>';
  }

  function historyCard(p) {
    if (!(p.events || []).length) return '';

    return '<section class="handoff-card">' +
      '<h2>History</h2>' +
      '<ol class="admin-history">' +
        p.events.slice().reverse().map(function (e) {
          return '<li><span class="mono">' + formatDateTime(e.at) + '</span> ' + escapeHtml(readableEvent(e)) + '</li>';
        }).join('') +
      '</ol>' +
    '</section>';
  }

  function readableEvent(event) {
    var map = {
      project_created: 'Project created',
      files_received: 'Client sent files',
      delivered: 'Delivered',
      delivery_resent: 'Link sent again',
      downloaded: 'Client downloaded',
      revision_requested: 'Client asked for a change',
      revision_acknowledged: 'Told the client it arrived',
      project_closed: 'Closed',
      project_reopened: 'Reopened'
    };

    var text = map[event.type] || event.type;
    if (event.detail && event.detail.version) text += ' (v' + event.detail.version + ')';
    if (event.detail && event.detail.files) text += ' — ' + event.detail.files + ' files';
    return text;
  }

  function closeCard(p) {
    return '<section class="handoff-card admin-close">' +
      '<button type="button" class="btn btn-secondary" id="toggle-closed" data-closed="' + (p.closed ? '1' : '') + '">' +
        (p.closed ? 'Reopen project' : 'Mark as done') +
      '</button>' +
      '<div class="handoff-status" id="close-status" role="status" aria-live="polite"></div>' +
    '</section>';
  }

  /* --- detail interactions --- */

  function wireDetail(p) {
    var deliverForm = document.getElementById('deliver-form');
    var deliverStatus = document.getElementById('deliver-status');

    deliverForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var submit = document.getElementById('deliver-submit');
      var files = document.getElementById('deliver-files').files;

      if (!files.length) {
        setStatus(deliverStatus, 'Pick at least one file.', 'error');
        return;
      }

      submit.disabled = true;
      setStatus(deliverStatus, 'Uploading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '… this can take a while for large files.');

      api('/projects/' + p.id + '/deliveries', { method: 'POST', body: new FormData(deliverForm) })
        .then(function (data) {
          if (data.notification && data.notification.sent) {
            setStatus(deliverStatus, 'Sent. The client has the link.', 'success');
          } else {
            /* The delivery exists either way — say so plainly and hand over
               the link instead of leaving it looking like a failure. */
            setStatus(deliverStatus,
              'Uploaded, but the email did not go out (' +
              ((data.notification && data.notification.message) || 'no mail server configured') +
              '). Copy the link below and send it yourself.', 'error');
          }
          return openProject(p.id);
        })
        .catch(function (error) {
          submit.disabled = false;
          setStatus(deliverStatus, error.message, 'error');
        });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.admin-file-btn, .admin-file-link'), function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        api('/projects/' + p.id + '/files/' + el.dataset.file)
          .then(function (data) { window.location.href = data.url; })
          .catch(function (error) { window.alert(error.message); });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.admin-copy'), function (button) {
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(button.dataset.url).then(function () {
          var original = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = original; }, 1500);
        });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.admin-resend'), function (button) {
      button.addEventListener('click', function () {
        button.disabled = true;
        api('/projects/' + p.id + '/deliveries/' + button.dataset.delivery + '/resend', { method: 'POST' })
          .then(function (data) {
            button.textContent = data.notification && data.notification.sent ? 'Sent' : 'Not sent';
          })
          .catch(function (error) {
            button.disabled = false;
            window.alert(error.message);
          });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.admin-ack-btn'), function (button) {
      button.addEventListener('click', function () {
        button.disabled = true;
        api('/projects/' + p.id + '/revisions/' + button.dataset.revision + '/acknowledge', { method: 'POST' })
          .then(function () { return openProject(p.id); })
          .catch(function (error) {
            button.disabled = false;
            window.alert(error.message);
          });
      });
    });

    document.getElementById('toggle-closed').addEventListener('click', function (event) {
      var closed = !event.target.dataset.closed;
      api('/projects/' + p.id + '/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: closed })
      })
        .then(function () { return openProject(p.id); })
        .catch(function (error) { setStatus(document.getElementById('close-status'), error.message, 'error'); });
    });
  }

  /* ----------------------------------------------------------------------
     Start: try the existing session before asking for the password again
     ---------------------------------------------------------------------- */

  api('/auth/me')
    .then(loadList)
    .catch(function () { show('signin'); });
})();
