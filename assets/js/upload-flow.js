/**
 * The customer upload on upload.html.
 *
 * One request now: details and files go together, and the server answers with
 * the reference. The old flow needed three — create a job, upload to a second
 * endpoint, then call a third to finalise — and a connection that dropped
 * between any two of them left a half-made job nobody ever saw.
 */
(function () {
  'use strict';

  var form = document.getElementById('upload-job-form');
  if (!form) return;

  var status = document.getElementById('upload-status');
  var successPanel = document.getElementById('upload-success-panel');
  var summaryList = document.getElementById('upload-summary-list');
  var fileInput = document.getElementById('project-files');
  var fileList = document.getElementById('upload-file-list');
  var dropzone = document.getElementById('upload-dropzone');
  var selectButton = document.getElementById('select-files-button');
  var submitButton = form.querySelector('button[type="submit"]');

  /* Held here rather than read off the input, so drag-and-drop and the file
     picker can both add to the same set. */
  var selected = [];

  /* ---------------------------------------------------------------- files */

  function refreshFileList() {
    if (!fileList) return;

    if (!selected.length) {
      fileList.innerHTML = '';
      return;
    }

    fileList.innerHTML = selected.map(function (file, index) {
      return '<li><div><span class="delivery-file-name">' + escapeHtml(file.name) + '</span>' +
        '<span class="delivery-file-size mono">' + formatBytes(file.size) + '</span></div>' +
        '<button type="button" class="btn btn-secondary upload-remove" data-index="' + index + '">Remove</button></li>';
    }).join('');

    Array.prototype.forEach.call(fileList.querySelectorAll('.upload-remove'), function (button) {
      button.addEventListener('click', function () {
        selected.splice(Number(button.dataset.index), 1);
        refreshFileList();
      });
    });
  }

  function addFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      var duplicate = selected.some(function (entry) {
        return entry.name === file.name && entry.size === file.size;
      });

      if (!duplicate) selected.push(file);
    });

    refreshFileList();
  }

  if (selectButton && fileInput) {
    selectButton.addEventListener('click', function () { fileInput.click(); });
  }

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      addFiles(fileInput.files);
      fileInput.value = '';
    });
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
    });
  }

  /* --------------------------------------------------------------- submit */

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!selected.length) {
      setStatus('Add at least one file before sending.', 'error');
      return;
    }

    var payload = new FormData(form);
    payload.delete('files');
    selected.forEach(function (file) { payload.append('files', file); });

    submitButton.disabled = true;
    setStatus('Uploading ' + selected.length + ' file' + (selected.length === 1 ? '' : 's') +
      '. Keep this tab open — large files take a while.');

    fetch('/api/v1/public/projects', { method: 'POST', body: payload })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.message || 'The upload did not go through.');
          return data;
        });
      })
      .then(function (data) {
        setStatus('');
        showSuccess(data);
      })
      .catch(function (error) {
        submitButton.disabled = false;
        setStatus(error.message + ' Nothing was saved — you can try again.', 'error');
      });
  });

  function showSuccess(data) {
    form.hidden = true;

    if (summaryList) {
      summaryList.innerHTML =
        '<div><dt>Reference</dt><dd>' + escapeHtml(data.reference) + '</dd></div>' +
        '<div><dt>Files</dt><dd>' + (data.files || []).length + '</dd></div>' +
        '<div><dt>Total size</dt><dd>' + formatBytes(data.totalSize) + '</dd></div>';
    }

    if (successPanel) {
      successPanel.hidden = false;
      successPanel.scrollIntoView({ block: 'start' });
    }
  }

  /* --------------------------------------------------------------- helpers */

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'handoff-status' + (text ? ' is-visible' : '') + (kind ? ' ' + kind : '');
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

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
