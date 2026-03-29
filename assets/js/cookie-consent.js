document.addEventListener('DOMContentLoaded', function() {
    const storageKey = 'steinbach_cookie_consent_v1';
    const defaultConsent = {
        essential: true,
        externalMedia: false,
        updatedAt: null
    };

    const savedConsent = readConsent();
    const consent = savedConsent || { ...defaultConsent };
    const initialBannerSelection = {
        essential: true,
        externalMedia: savedConsent ? savedConsent.externalMedia : true,
        updatedAt: savedConsent ? savedConsent.updatedAt : null
    };

    createConsentUi(initialBannerSelection, Boolean(savedConsent));
    syncExternalMedia(consent.externalMedia);

    function createConsentUi(currentConsent, hasStoredConsent) {
        const banner = document.createElement('section');
        banner.className = 'cookie-banner';
        banner.setAttribute('aria-label', 'Cookie settings');
        banner.hidden = hasStoredConsent;
        banner.innerHTML = `
            <h2 class="cookie-banner-title">Your privacy, clearly handled</h2>
            <p class="cookie-banner-copy">
                This website only uses necessary technical storage and optional external media.
                YouTube content is only loaded after your consent.
                Details are available in the <a href="datenschutz.html">Privacy Policy</a>.
            </p>
            <div class="cookie-banner-actions">
                <button type="button" class="btn" data-consent-action="accept-selected">Save selection</button>
                <button type="button" class="btn btn-secondary" data-consent-action="accept-necessary">Necessary only</button>
                <button type="button" class="btn btn-secondary" data-consent-action="toggle-settings">Settings</button>
            </div>
            <div class="cookie-settings" data-cookie-settings hidden>
                <div class="cookie-setting-row">
                    <div>
                        <strong>Necessary functions</strong>
                        <p>Stores only your consent decision and ensures basic site navigation.</p>
                    </div>
                    <label class="cookie-switch" aria-label="Necessary functions always active">
                        <input type="checkbox" checked disabled>
                        <span class="cookie-switch-slider"></span>
                    </label>
                </div>
                <div class="cookie-setting-row">
                    <div>
                        <strong>External media</strong>
                        <p>Loads embedded YouTube videos and other external content only after your consent.</p>
                    </div>
                    <label class="cookie-switch" aria-label="Allow external media">
                        <input type="checkbox" data-consent-toggle="externalMedia" ${currentConsent.externalMedia ? 'checked' : ''}>
                        <span class="cookie-switch-slider"></span>
                    </label>
                </div>
            </div>
        `;

        const reopenButton = document.createElement('button');
        reopenButton.type = 'button';
        reopenButton.className = 'cookie-reopen';
        reopenButton.hidden = !hasStoredConsent;
        reopenButton.textContent = 'Cookie settings';

        document.body.appendChild(banner);
        document.body.appendChild(reopenButton);

        const settings = banner.querySelector('[data-cookie-settings]');
        const externalToggle = banner.querySelector('[data-consent-toggle="externalMedia"]');

        banner.addEventListener('click', function(event) {
            const trigger = event.target.closest('[data-consent-action]');

            if (!trigger) {
                return;
            }

            if (trigger.dataset.consentAction === 'toggle-settings') {
                const isHidden = settings.hidden;
                settings.hidden = !isHidden;
                document.body.classList.toggle('cookie-banner-open', isHidden);
                return;
            }

            if (trigger.dataset.consentAction === 'accept-necessary') {
                currentConsent.externalMedia = false;
                if (externalToggle) {
                    externalToggle.checked = false;
                }
                storeConsent(currentConsent);
                return;
            }

            if (externalToggle) {
                currentConsent.externalMedia = externalToggle.checked;
            }

            storeConsent(currentConsent);
        });

        reopenButton.addEventListener('click', function() {
            banner.hidden = false;
            settings.hidden = false;
            document.body.classList.add('cookie-banner-open');
        });

        function storeConsent(nextConsent) {
            const record = {
                essential: true,
                externalMedia: Boolean(nextConsent.externalMedia),
                updatedAt: new Date().toISOString()
            };

            window.localStorage.setItem(storageKey, JSON.stringify(record));
            banner.hidden = true;
            settings.hidden = true;
            reopenButton.hidden = false;
            document.body.classList.remove('cookie-banner-open');
            syncExternalMedia(record.externalMedia);
        }
    }

    function readConsent() {
        try {
            const raw = window.localStorage.getItem(storageKey);

            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);

            return {
                essential: true,
                externalMedia: Boolean(parsed.externalMedia),
                updatedAt: parsed.updatedAt || null
            };
        } catch (_error) {
            return null;
        }
    }
});

function getExternalMediaSrc(embed) {
    const rawUrl = embed.dataset.consentSrc || embed.getAttribute('src') || '';

    if (!rawUrl) {
        return '';
    }

    try {
        const url = new URL(rawUrl, window.location.href);
        const isYouTubeEmbed = /(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname) && url.pathname.startsWith('/embed/');

        if (isYouTubeEmbed && /^https?:$/.test(window.location.protocol)) {
            url.searchParams.set('origin', window.location.origin);
        }

        return url.toString();
    } catch (_error) {
        return rawUrl;
    }
}

function syncExternalMedia(isEnabled) {
    const gatedEmbeds = Array.from(document.querySelectorAll('[data-consent-category="external-media"]'));

    gatedEmbeds.forEach(function(embed) {
        const wrapper = embed.parentElement;

        if (!wrapper) {
            return;
        }

        let placeholder = wrapper.querySelector('.consent-embed-placeholder');

        embed.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

        if (isEnabled) {
            if (!embed.getAttribute('src')) {
                embed.setAttribute('src', getExternalMediaSrc(embed));
            }

            if (placeholder) {
                placeholder.remove();
            }

            return;
        }

        embed.removeAttribute('src');

        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'consent-embed-placeholder';
            placeholder.innerHTML = `
                <div class="consent-embed-copy">
                    <strong>External media is blocked</strong>
                    <p>This video will only load after you allow external media in the cookie settings.</p>
                </div>
                <div class="consent-embed-actions">
                    <button type="button" class="btn btn-secondary" data-consent-enable-media>Allow external media</button>
                </div>
            `;

            placeholder.querySelector('[data-consent-enable-media]').addEventListener('click', function() {
                const reopenButton = document.querySelector('.cookie-reopen');

                if (reopenButton) {
                    reopenButton.hidden = false;
                    reopenButton.click();
                }
            });

            wrapper.appendChild(placeholder);
        }
    });

    if (isEnabled) {
        document.dispatchEvent(new CustomEvent('steinbach:external-media-ready'));
    }
}