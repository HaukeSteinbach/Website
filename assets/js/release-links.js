document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('release-builder-form');
    const artworkInput = document.getElementById('artwork-file');
    const artworkButton = document.getElementById('artwork-select-button');
    const artworkList = document.getElementById('artwork-file-list');
    const status = document.getElementById('release-builder-status');
    const successPanel = document.getElementById('release-builder-success');
    const summaryList = document.getElementById('release-builder-summary-list');
    const submitButton = document.getElementById('release-builder-submit');
    const openLink = document.getElementById('release-builder-open-link');
    const copyButton = document.getElementById('release-builder-copy-link');
    const copyStatus = document.getElementById('release-builder-copy-status');
    const originalSubmitText = submitButton ? submitButton.textContent : '';
    let latestPageUrl = '';

    if (!form || !artworkInput || !artworkButton || !artworkList || !status || !successPanel || !summaryList || !submitButton || !openLink || !copyButton || !copyStatus) {
        return;
    }

    artworkButton.addEventListener('click', function() {
        artworkInput.click();
    });

    artworkInput.addEventListener('change', function() {
        renderFiles(artworkInput.files, artworkList);
    });

    copyButton.addEventListener('click', async function() {
        if (!latestPageUrl) {
            return;
        }

        try {
            await navigator.clipboard.writeText(latestPageUrl);
            setStatus(copyStatus, 'success', 'Release link copied to clipboard.');
        } catch (_error) {
            setStatus(copyStatus, 'error', 'Could not copy automatically. Please copy the link from the summary.');
        }
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        if (!artworkInput.files || artworkInput.files.length === 0) {
            setStatus(status, 'error', 'Upload artwork before creating the release page.');
            return;
        }

        const payload = new FormData(form);

        setStatus(status, '', 'Creating release page...');
        copyStatus.className = 'handoff-status';
        copyStatus.textContent = '';
        submitButton.disabled = true;
        submitButton.textContent = 'Creating...';

        try {
            const response = await fetch(buildApiUrl('/api/v1/public/release-pages'), {
                method: 'POST',
                body: payload,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(await getApiErrorMessage(response, 'Unable to create the release page right now.'));
            }

            const result = await response.json();
            const releasePage = result.releasePage;
            latestPageUrl = releasePage.pageUrl;

            summaryList.innerHTML = [
                `<div><dt>Release URL</dt><dd><a href="${releasePage.pageUrl}" target="_blank" rel="noopener noreferrer">${releasePage.path}</a></dd></div>`,
                `<div><dt>Title</dt><dd>${escapeHtml(releasePage.title)}</dd></div>`,
                `<div><dt>Artist</dt><dd>${escapeHtml(releasePage.artist)}</dd></div>`,
                `<div><dt>Platforms</dt><dd>${releasePage.services.length}</dd></div>`
            ].join('');

            openLink.href = releasePage.pageUrl;
            successPanel.hidden = false;
            setStatus(status, 'success', 'Release page created successfully.');
            form.reset();
            artworkList.innerHTML = '';
        } catch (error) {
            setStatus(status, 'error', error.message || 'Unable to create the release page.');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalSubmitText;
        }
    });
});

function renderFiles(files, container) {
    container.innerHTML = '';

    Array.from(files || []).forEach(function(file) {
        const item = document.createElement('li');
        item.className = 'upload-file-row';
        item.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${formatBytes(file.size)}</span>`;
        container.appendChild(item);
    });
}

function setStatus(element, type, message) {
    element.textContent = message;
    element.className = 'handoff-status is-visible';

    if (type) {
        element.classList.add(type);
    }
}

function buildApiUrl(path) {
    const base = getApiBaseUrl();

    return `${base}${path}`;
}

function getApiBaseUrl() {
    const configuredBase = document.body.dataset.apiBase;

    if (configuredBase) {
        return configuredBase.replace(/\/$/, '');
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    }

    return window.location.origin;
}

async function getApiErrorMessage(response, fallbackMessage) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        return fallbackMessage;
    }

    const result = await response.json();
    return result.message || fallbackMessage;
}

function formatBytes(size) {
    if (size < 1024) {
        return `${size} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}