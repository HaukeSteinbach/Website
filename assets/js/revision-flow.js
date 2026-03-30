document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('revision-form');
    const status = document.getElementById('revision-status');
    const referenceStatus = document.getElementById('revision-reference');

    if (!form || !status) {
        return;
    }

    applyRevisionContext(form, referenceStatus);

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        const formData = new FormData(form);
        const endpoint = form.getAttribute('action');

        if (!endpoint) {
            status.textContent = 'Revision form endpoint is not configured yet.';
            status.className = 'handoff-status is-visible error';
            return;
        }

        status.textContent = 'Submitting revision request...';
        status.className = 'handoff-status is-visible';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(await getFormspreeError(response, 'Unable to submit revision request.'));
            }

            status.textContent = 'Revision request sent successfully.';
            status.className = 'handoff-status is-visible success';
            form.reset();
            applyRevisionContext(form, referenceStatus);
        } catch (error) {
            status.textContent = error.message;
            status.className = 'handoff-status is-visible error';
        }
    });
});

function applyRevisionContext(form, referenceStatus) {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || '';
    const deliveryTitle = params.get('deliveryTitle') || '';
    const deliveryLink = params.get('deliveryLink') || '';
    const recipientName = params.get('name') || '';
    const recipientEmail = params.get('email') || '';

    const referenceInput = document.getElementById('delivery-reference-input');
    const titleInput = document.getElementById('delivery-title-input');
    const linkInput = document.getElementById('delivery-link-input');
    const nameInput = document.getElementById('revision-name');
    const emailInput = document.getElementById('revision-email');

    if (referenceInput) {
        referenceInput.value = reference;
    }

    if (titleInput) {
        titleInput.value = deliveryTitle;
    }

    if (linkInput) {
        linkInput.value = deliveryLink;
    }

    if (nameInput && recipientName) {
        nameInput.value = recipientName;
    }

    if (emailInput && recipientEmail) {
        emailInput.value = recipientEmail;
    }

    if (referenceStatus && reference) {
        referenceStatus.hidden = false;
        referenceStatus.textContent = deliveryTitle
            ? `Reference ${reference} · ${deliveryTitle}`
            : `Reference ${reference}`;
        referenceStatus.className = 'handoff-status is-visible';
    }
}

async function getFormspreeError(response, fallbackMessage) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        return fallbackMessage;
    }

    const result = await response.json();

    if (Array.isArray(result.errors) && result.errors.length > 0) {
        return result.errors.map(function(error) {
            return error.message;
        }).join(' ') || fallbackMessage;
    }

    return result.message || fallbackMessage;
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
