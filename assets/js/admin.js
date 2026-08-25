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
    detail: document.getElementById('detail-view')
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

  var signinForm = document.getElementById('signin-form');
  var signinStatus = document.getElementById('signin-status');

  signinForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var submit = document.getElementById('signin-submit');
    submit.disabled = true;
    setStatus(signinStatus, 'Checking…');

    api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    })
      .then(function () {
        setStatus(signinStatus, '');
        document.getElementById('password').value = '';
        loadList();
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

  document.getElementById('refresh').addEventListener('click', loadList);
  document.getElementById('back').addEventListener('click', loadList);

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
      sourceCard(p),
      historyCard(p),
      closeCard(p)
    ].join('');

    wireDetail(p);
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
