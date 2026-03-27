document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('upload-job-form');
    const fileInput = document.getElementById('project-files');
    const selectFilesButton = document.getElementById('select-files-button');
    const fileList = document.getElementById('upload-file-list');
    const status = document.getElementById('upload-status');
    const successPanel = document.getElementById('upload-success-panel');
    const summaryList = document.getElementById('upload-summary-list');

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

        try {
            const response = await fetch('https://app.yourdomain.com/api/v1/public/jobs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Unable to create upload job.');
            }

            const result = await response.json();
            status.textContent = 'Upload job created. Integrate tus upload next.';
            status.className = 'handoff-status is-visible success';
            successPanel.hidden = false;
            summaryList.innerHTML = [
                `<div><dt>Reference</dt><dd>${result.reference}</dd></div>`,
                `<div><dt>Job ID</dt><dd>${result.jobId}</dd></div>`,
                `<div><dt>Upload endpoint</dt><dd>${result.upload.endpoint}</dd></div>`
            ].join('');
        } catch (error) {
            status.textContent = error.message;
            status.className = 'handoff-status is-visible error';
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
