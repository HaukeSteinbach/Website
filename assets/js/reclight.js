document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('reclight-form');
    var statusEl = document.getElementById('rl-form-status');
    var submitBtn = document.getElementById('rl-submit');

    if (!form) return;

    // ── Dynamic price calculator ──────────────────────────────
    var pbCable    = document.getElementById('pb-cable');
    var pbPlug     = document.getElementById('pb-plug');
    var pbShipping = document.getElementById('pb-shipping');
    var pbTotal    = document.getElementById('pb-total');
    var countryEl  = document.getElementById('rl-country');

    var SHIPPING = (function () {
        var de  = ['germany','deutschland','de'];
        var eu  = ['austria','österreich','belgium','belgien','bulgaria','bulgarien',
                   'croatia','kroatien','czech republic','tschechien','czechia',
                   'denmark','dänemark','estonia','estland','finland','finnland',
                   'france','frankreich','greece','griechenland','hungary','ungarn',
                   'ireland','irland','italy','italien','latvia','lettland',
                   'lithuania','litauen','luxembourg','luxemburg','malta',
                   'netherlands','niederlande','holland','poland','polen',
                   'portugal','romania','rumänien','slovakia','slowakei',
                   'slovenia','slowenien','spain','spanien','sweden','schweden',
                   'switzerland','schweiz','norway','norwegen','liechtenstein'];
        var uk  = ['uk','united kingdom','england','britain','great britain',
                   'scotland','wales','northern ireland'];
        var far = ['usa','united states','us','canada','kanada',
                   'australia','australien','new zealand','neuseeland'];
        return function (country) {
            var c = (country || '').trim().toLowerCase();
            if (!c) return null;
            if (de.indexOf(c)  !== -1) return 5;
            if (eu.indexOf(c)  !== -1) return 10;
            if (uk.indexOf(c)  !== -1) return 15;
            if (far.indexOf(c) !== -1) return 20;
            return 20;
        };
    }());

    function updatePrice() {
        var base     = 30;
        var hasCable = !!document.querySelector('input[name="usb_cable"]:checked');
        var plugEl   = document.querySelector('input[name="plug_type"]:checked');
        var hasPlug  = plugEl && plugEl.value !== 'None';
        var shipping = SHIPPING(countryEl ? countryEl.value : '');

        if (hasCable) base += 5;
        if (hasPlug)  base += 10;

        if (pbCable) pbCable.style.display = hasCable ? '' : 'none';
        if (pbPlug)  pbPlug.style.display  = hasPlug  ? '' : 'none';

        if (pbShipping) {
            pbShipping.textContent = shipping !== null ? shipping + ' €' : 'TBD';
        }
        if (pbTotal) {
            pbTotal.textContent = shipping !== null
                ? (base + shipping) + ' €'
                : base + ' € + shipping';
        }
    }

    document.querySelectorAll('input[name="usb_cable"], input[name="plug_type"]').forEach(function (el) {
        el.addEventListener('change', updatePrice);
    });
    if (countryEl) countryEl.addEventListener('input', updatePrice);
    // ─────────────────────────────────────────────────────────

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var endpoint = form.getAttribute('action');
        if (!endpoint) {
            statusEl.className = 'form-status error';
            statusEl.textContent = 'Form endpoint not configured yet. Please check back soon.';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending\u2026';
        statusEl.className = 'form-status';
        statusEl.textContent = '';

        try {
            var res = await fetch(endpoint, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'Accept': 'application/json' }
            });

            var data = {};
            var ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                data = await res.json();
            }

            if (!res.ok) {
                var msg = Array.isArray(data.errors)
                    ? data.errors.map(function (err) { return err.message; }).join(' ')
                    : (data.message || 'Submission failed.');
                throw new Error(msg);
            }

            statusEl.className = 'form-status success';
            statusEl.textContent = 'Your pre-order is reserved! I\u2019ll be in touch with payment details once the first batch is confirmed. Thank you!';
            form.reset();
        } catch (err) {
            statusEl.className = 'form-status error';
            statusEl.textContent = 'Something went wrong. Please try again or reach out directly via email.';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reserve My RecLight \u2192';
        }
    });
});
