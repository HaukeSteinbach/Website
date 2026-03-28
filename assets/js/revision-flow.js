document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('revision-form');
    const status = document.getElementById('revision-status');

    if (!form || !status) {
        return;
    }

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        const formData = new FormData(form);
        status.textContent = 'Submitting revision request...';
        status.className = 'handoff-status is-visible';

        try {
            const response = await fetch(buildApiUrl('/api/v1/public/revisions/demo-token'), {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Unable to submit revision request.');
            }

            const result = await response.json();
            status.textContent = `Revision request sent for ${result.jobReference}.`;
            status.className = 'handoff-status is-visible success';
            form.reset();
        } catch (error) {
            status.textContent = error.message;
            status.className = 'handoff-status is-visible error';
        }
    });
});

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
