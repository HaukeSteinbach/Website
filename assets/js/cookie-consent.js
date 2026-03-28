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
            <h2 class="cookie-banner-title">Deine Privatsphäre, klar und direkt</h2>
            <p class="cookie-banner-copy">
                Diese Website nutzt nur notwendige technische Speicherung und optionale externe Medien.
                YouTube-Inhalte werden erst nach deiner Zustimmung geladen.
                Details stehen in der <a href="datenschutz.html">Datenschutzerklärung</a>.
            </p>
            <div class="cookie-banner-actions">
                <button type="button" class="btn" data-consent-action="accept-selected">Auswahl speichern</button>
                <button type="button" class="btn btn-secondary" data-consent-action="accept-necessary">Nur notwendige</button>
                <button type="button" class="btn btn-secondary" data-consent-action="toggle-settings">Einstellungen</button>
            </div>
            <div class="cookie-settings" data-cookie-settings hidden>
                <div class="cookie-setting-row">
                    <div>
                        <strong>Notwendige Funktionen</strong>
                        <p>Speichert nur deine Einwilligungsentscheidung und sichert grundlegende Seitennavigation.</p>
                    </div>
                    <label class="cookie-switch" aria-label="Notwendige Funktionen immer aktiv">
                        <input type="checkbox" checked disabled>
                        <span class="cookie-switch-slider"></span>
                    </label>
                </div>
                <div class="cookie-setting-row">
                    <div>
                        <strong>Externe Medien</strong>
                        <p>Lädt eingebettete YouTube-Videos und andere externe Inhalte erst nach deiner Zustimmung.</p>
                    </div>
                    <label class="cookie-switch" aria-label="Externe Medien erlauben">
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
        reopenButton.textContent = 'Cookie-Einstellungen';

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

function syncExternalMedia(isEnabled) {
    const gatedEmbeds = Array.from(document.querySelectorAll('[data-consent-category="external-media"]'));

    gatedEmbeds.forEach(function(embed) {
        const wrapper = embed.parentElement;

        if (!wrapper) {
            return;
        }

        let placeholder = wrapper.querySelector('.consent-embed-placeholder');

        if (isEnabled) {
            if (!embed.getAttribute('src')) {
                embed.setAttribute('src', embed.dataset.consentSrc || '');
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
                    <strong>Externe Medien sind blockiert</strong>
                    <p>Dieses Video wird erst geladen, wenn du externe Medien in den Cookie-Einstellungen erlaubst.</p>
                </div>
                <div class="consent-embed-actions">
                    <button type="button" class="btn btn-secondary" data-consent-enable-media>Externe Medien erlauben</button>
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