/**
 * The revision form on a delivery page.
 *
 * The page itself is rendered by the backend under /d/<token>; the endpoint
 * comes from a data attribute so this file needs to know nothing about tokens.
 */
(function () {
  'use strict';

  var form = document.getElementById('revision-form');
  if (!form) return;

  var status = document.getElementById('revision-status');
  var submit = document.getElementById('revision-submit');
  var endpoint = form.dataset.endpoint;

  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text;
    status.className = 'handoff-status is-visible' + (kind ? ' ' + kind : '');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var message = form.querySelector('#revision-message');

    if (!message || message.value.trim().length < 4) {
      setStatus('Please describe the change you would like.', 'error');
      if (message) message.focus();
      return;
    }

    submit.disabled = true;
    setStatus('Sending…');

    fetch(endpoint, { method: 'POST', body: new FormData(form) })
      .then(function (response) {
        return response.json().then(function (payload) {
          return { ok: response.ok, payload: payload };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.payload && result.payload.message
            ? result.payload.message
            : 'The request could not be sent.');
        }

        /* Hide the form rather than reset it: a cleared form invites a second
           request, and there is nothing left to do here. */
        form.hidden = true;
        setStatus('Request sent. You will hear back by email — nothing else to do.', 'success');
      })
      .catch(function (error) {
        submit.disabled = false;
        setStatus(error.message + ' You can also email mail@haukesteinbach.de.', 'error');
      });
  });
})();
