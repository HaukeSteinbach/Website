document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('upload-job-form');
    const fileInput = document.getElementById('project-files');
    const selectFilesButton = document.getElementById('select-files-button');
    const fileList = document.getElementById('upload-file-list');
    const status = document.getElementById('upload-status');
    const successPanel = document.getElementById('upload-success-panel');
    const summaryList = document.getElementById('upload-summary-list');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    const originalButtonText = submitButton ? submitButton.textContent : '';

    if (!form || !fileInput || !selectFilesButton || !fileList || !status || !successPanel || !summaryList) {
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
            status.textContent = 'Select at least one file before creating an upload job.';
            status.className = 'handoff-status is-visible error';
            return;
        }

        const formData = new FormData(form);
        const payload = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            email: formData.get('email'),
            address: {
                street1: formData.get('street1'),
                street2: formData.get('street2'),
                postalCode: formData.get('postalCode'),
                city: formData.get('city'),
                region: formData.get('region'),
                country: String(formData.get('country') || '').toUpperCase()
            },
            service: formData.get('service'),
            projectNotes: formData.get('projectNotes'),
            privacyConsent: formData.get('privacyConsent') === 'on',
            policyVersion: '2026-03-26',
            captchaToken: 'demo-turnstile-token'
        };

        status.textContent = 'Creating upload job...';
        status.className = 'handoff-status is-visible';

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Uploading...';
        }

        try {
            const response = await fetch(buildApiUrl('/api/v1/public/jobs'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(await getApiErrorMessage(response, 'Unable to create upload job.'));
            }

            const result = await response.json();

            if (!hasConfiguredUploadEndpoint(result)) {
                throw new Error('Upload job created, but the file upload endpoint is not configured correctly.');
            }

            status.textContent = 'Uploading files...';

            const uploadResponse = await uploadSelectedFiles(resolveUploadUrl(result.upload.endpoint), fileInput.files);

            status.textContent = 'Finalizing upload...';

            const completionResponse = await finalizeUpload(result.jobId, uploadResponse.uploadedFiles);

            status.textContent = buildUploadSuccessMessage(completionResponse);
            status.className = 'handoff-status is-visible success';

            successPanel.hidden = false;
            summaryList.innerHTML = [
                `<div><dt>Reference</dt><dd>${completionResponse.reference}</dd></div>`,
                `<div><dt>Job ID</dt><dd>${result.jobId}</dd></div>`,
                `<div><dt>Files</dt><dd>${uploadResponse.uploadedFiles.length}</dd></div>`,
                `<div><dt>Upload endpoint</dt><dd>${result.upload.endpoint}</dd></div>`,
                `<div><dt>Notification</dt><dd>${formatNotificationStatus(completionResponse.notification)}</dd></div>`,
                `<div><dt>Source download</dt><dd>${formatSourceDownloadLink(completionResponse.sourceDownload)}</dd></div>`
            ].join('');
        } catch (error) {
            status.textContent = getUploadErrorMessage(error);
            status.className = 'handoff-status is-visible error';
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });
});

function renderFiles(files, container) {
    container.innerHTML = '';

    Array.from(files).forEach(function(file) {
        const item = document.createElement('li');
        item.className = 'upload-file-row';
        item.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)}</span>`;
        container.appendChild(item);
    });
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

function hasConfiguredUploadEndpoint(result) {
    const endpoint = result?.upload?.endpoint;

    return Boolean(endpoint) && !String(endpoint).includes('yourdomain.com');
}

function resolveUploadUrl(endpoint) {
    if (/^https?:\/\//i.test(endpoint)) {
        return endpoint;
    }

    return buildApiUrl(endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
}

async function uploadSelectedFiles(endpoint, files) {
    const payload = new FormData();

    Array.from(files).forEach(function(file) {
        payload.append('files', file);
    });

    const response = await fetch(endpoint, {
        method: 'POST',
        body: payload,
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Unable to upload files.'));
    }

    return response.json();
}

async function finalizeUpload(jobId, uploadedFiles) {
    const response = await fetch(buildApiUrl(`/api/v1/public/jobs/${jobId}/uploads/complete`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ uploadedFiles: uploadedFiles })
    });

    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Unable to finalize the upload.'));
    }

    return response.json();
}

async function getApiErrorMessage(response, fallbackMessage) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        return fallbackMessage;
    }

    const result = await response.json();
    return result.message || fallbackMessage;
}

function getUploadErrorMessage(error) {
    if (error && error.message === 'Failed to fetch') {
        return 'The upload service is not reachable right now. The website is up, but the API backend is not responding yet.';
    }

    return error && error.message ? error.message : 'Upload failed. Please try again.';
}

function buildUploadSuccessMessage(completionResponse) {
    if (completionResponse?.notification?.sent && completionResponse.notification.provider === 'formspree') {
        return 'Files uploaded successfully. Your project details and secure download link were forwarded via Formspree.';
    }

    if (completionResponse?.notification?.sent) {
        return 'Files uploaded successfully. Upload notification sent.';
    }

    if (completionResponse?.notification?.reason === 'mail_not_configured') {
        return 'Files uploaded successfully. Upload notification is not configured yet. Use the source download link below.';
    }

    return `Files uploaded successfully. Reference ${completionResponse.reference}.`;
}

function formatNotificationStatus(notification) {
    if (!notification) {
        return 'Not available';
    }

    if (notification.sent && notification.provider === 'formspree') {
        return 'Sent via Formspree';
    }

    if (notification.sent) {
        return notification.recipient ? `Sent to ${notification.recipient}` : 'Sent';
    }

    if (notification.reason === 'mail_not_configured') {
        return 'Mail not configured';
    }

    return 'Notification failed';
}

function formatSourceDownloadLink(sourceDownload) {
    const pageUrl = sourceDownload && sourceDownload.pageUrl;

    if (!pageUrl) {
        return 'Not available';
    }

    return `<a href="${pageUrl}" target="_blank" rel="noopener noreferrer">Open download page</a>`;
}
