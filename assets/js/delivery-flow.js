document.addEventListener('DOMContentLoaded', function() {
    const downloadButton = document.getElementById('delivery-download-button');
    const status = document.getElementById('delivery-status');

    if (!downloadButton || !status) {
        return;
    }

    downloadButton.addEventListener('click', async function() {
        status.textContent = 'Preparing your download...';
        status.className = 'handoff-status is-visible';

        try {
            const response = await fetch(buildApiUrl('/api/v1/public/deliveries/demo-token/download'), {
                method: 'POST',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Unable to prepare the download.');
            }

            const result = await response.json();
            status.innerHTML = `Download event recorded. Signed links ready:<br>${result.download.urls.map(function(item) {
                return `<a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.fileName}</a>`;
            }).join('<br>')}`;
            status.className = 'handoff-status is-visible success';
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
