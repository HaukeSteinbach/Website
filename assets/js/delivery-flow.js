document.addEventListener('DOMContentLoaded', function() {
    const downloadButton = document.getElementById('delivery-download-button');
    const status = document.getElementById('delivery-status');

    if (!downloadButton || !status) {
        return;
    }

    downloadButton.addEventListener('click', async function() {
        status.textContent = 'Preparing secure download links...';
        status.className = 'handoff-status is-visible';

        try {
            const response = await fetch('https://app.yourdomain.com/api/v1/public/deliveries/demo-token/download', {
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
