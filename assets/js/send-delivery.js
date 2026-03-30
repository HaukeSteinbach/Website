document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('direct-delivery-form');
    const fileInput = document.getElementById('direct-delivery-files');
    const selectFilesButton = document.getElementById('direct-delivery-select-files');
    const fileList = document.getElementById('direct-delivery-file-list');
    const status = document.getElementById('direct-delivery-status');
    const successPanel = document.getElementById('direct-delivery-success');
    const summary = document.getElementById('direct-delivery-summary');
    const submitButton = document.getElementById('direct-delivery-submit');
    const originalSubmitText = submitButton ? submitButton.textContent : '';

    if (!form || !fileInput || !selectFilesButton || !fileList || !status || !successPanel || !summary || !submitButton) {
        return;
    }

    selectFilesButton.addEventListener('click', function() {
        fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        renderFiles(fileInput.files, fileList);
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        if (!fileInput.files || fileInput.files.length === 0) {
            setStatus(status, 'error', 'Select at least one file before sending the delivery.');
            return;
        }

        const payload = new FormData();
        payload.append('recipientEmail', form.elements.recipientEmail.value);
        payload.append('recipientName', form.elements.recipientName.value);
        payload.append('deliveryTitle', form.elements.deliveryTitle.value);
        payload.append('message', form.elements.message.value);
        Array.from(fileInput.files).forEach(function(file) {
            payload.append('files', file);
        });

        setStatus(status, '', 'Preparing delivery...');
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';

        try {
            const response = await fetch(buildApiUrl('/api/v1/public/direct-deliveries'), {
                method: 'POST',
                body: payload,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(await getApiErrorMessage(response, 'Unable to create the delivery right now.'));
            }

            const result = await response.json();

            setStatus(status, 'success', buildSuccessMessage(result));
            successPanel.hidden = false;
            summary.innerHTML = [
                `<div><dt>Reference</dt><dd>${result.reference}</dd></div>`,
                `<div><dt>Recipient</dt><dd>${result.delivery.recipientEmail}</dd></div>`,
                `<div><dt>Files</dt><dd>${result.delivery.files.length}</dd></div>`,
                `<div><dt>Available until</dt><dd>${formatDate(result.delivery.expiresAt)}</dd></div>`,
                `<div><dt>Delivery link</dt><dd><a href="${result.delivery.pageUrl}" target="_blank" rel="noopener noreferrer">Open link</a></dd></div>`,
                `<div><dt>Status</dt><dd>${formatNotificationStatus(result.notification)}</dd></div>`
            ].join('');

            form.reset();
            fileList.innerHTML = '';
        } catch (error) {
            setStatus(status, 'error', error.message || 'Unable to create the delivery.');
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
        item.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)}</span>`;
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

function buildSuccessMessage(result) {
    if (result.notification && result.notification.sent) {
        return 'Delivery created and sent by email.';
    }

    if (result.notification && result.notification.reason === 'mail_not_configured') {
        return 'Delivery created. Please use the link below to send it manually.';
    }

    return `Delivery created. Reference ${result.reference}.`;
}

function formatNotificationStatus(notification) {
    if (!notification) {
        return 'Not available';
    }

    if (notification.sent) {
        return 'Email sent';
    }

    if (notification.reason === 'mail_not_configured') {
        return 'Send manually';
    }

    return 'Could not send automatically';
}

function formatBytes(size) {
    if (size < 1024) {
        return `${size} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value) {
    return new Date(value).toLocaleString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}