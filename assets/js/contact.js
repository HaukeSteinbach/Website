document.addEventListener('DOMContentLoaded', function() {
    const contactToggle = document.getElementById('contact-toggle');
    const contactWrapper = document.querySelector('.contact-form-wrapper');

    if (contactToggle && contactWrapper) {
        contactToggle.addEventListener('click', function() {
            contactWrapper.classList.toggle('expanded');
        });
    }

    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', handleFormSubmit);
    }
});

async function handleFormSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const formStatus = document.getElementById('form-status');
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton ? submitButton.textContent : '';
    const formData = new FormData(form);
    const endpoint = form.getAttribute('action');

    if (!formStatus) {
        return;
    }

    setFormStatus(formStatus, '', '');

    if (!endpoint) {
        setFormStatus(
            formStatus,
            'error',
            'Contact form endpoint is not configured yet.'
        );
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: {
                'Accept': 'application/json'
            }
        });

        let result = {};
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            result = await response.json();
        }

        if (!response.ok) {
            const providerError = Array.isArray(result.errors)
                ? result.errors.map(function(error) {
                    return error.message;
                }).join(' ')
                : '';

            throw new Error(providerError || result.message || 'Form submission failed.');
        }

        setFormStatus(
            formStatus,
            'success',
            'Thank you! Your message has been sent successfully. I\'ll get back to you soon.'
        );
        form.reset();

        window.setTimeout(function() {
            formStatus.classList.remove('success');
            formStatus.textContent = '';
        }, 5000);
    } catch (error) {
        setFormStatus(
            formStatus,
            'error',
            error.message || 'Error sending message. Please try again or email directly to mail@haukesteinbach.de.'
        );
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    }
}

function setFormStatus(element, type, message) {
    element.classList.remove('success', 'error');

    if (type) {
        element.classList.add(type);
    }

    element.textContent = message;
}
