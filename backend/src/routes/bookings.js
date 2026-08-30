/**
 * The client's side of a studio booking.
 *
 * Three routes, no sign-in: look at the proposal, say yes, say no. The token
 * in the link is the whole credential.
 *
 * Confirming is a POST behind a form button rather than a link in the mail.
 * Mail clients and security scanners follow links to see where they go, and a
 * scanner that confirms a booking on someone's behalf is worse than useless —
 * it holds a room for a session nobody agreed to.
 */

import express from 'express';

import { answerBooking, findByToken, noteBookingEvent, studioAddress } from '../lib/bookings.js';
import { buildIcs } from '../lib/ics.js';
import { sendBookingConfirmedEmail, sendBookingToStudioEmail } from '../lib/mail.js';
import { ISSUER } from '../lib/invoice-pdf.js';
import {
  renderBookingAnswered,
  renderBookingNotice,
  renderBookingPage
} from '../views/booking-page.js';

const router = express.Router();

function icsFor(booking, { method = 'PUBLISH', status = 'CONFIRMED' } = {}) {
  return buildIcs({
    uid: booking.uid,
    start: booking.start,
    end: booking.end,
    summary: `Studio — ${booking.title}`,
    description: [booking.note, `Booked with ${ISSUER.name}, ${ISSUER.web}`]
      .filter(Boolean).join('\n\n'),
    location: studioAddress(),
    organiser: { name: ISSUER.name, email: ISSUER.email },
    attendee: {
      name: booking.client?.name,
      email: booking.client?.email,
      status: booking.state === 'confirmed' ? 'ACCEPTED' : 'NEEDS-ACTION'
    },
    method,
    status,
    sequence: booking.sequence
  });
}

export { icsFor };

router.get('/b/:token', async (request, response, next) => {
  try {
    const booking = await findByToken(request.params.token);

    if (!booking) {
      return response.status(404).type('html').send(renderBookingNotice({
        title: 'Link not found',
        message: 'This booking link does not exist. Check that you copied the whole address from the email.'
      }));
    }

    if (booking.state === 'cancelled') {
      return response.status(410).type('html').send(renderBookingNotice({
        title: 'Withdrawn',
        message: 'This slot is no longer on offer. You will hear from me with another time.'
      }));
    }

    if (booking.state !== 'proposed') {
      return response.type('html').send(renderBookingAnswered({
        booking, address: studioAddress(), alreadyAnswered: false
      }));
    }

    return response.type('html').send(renderBookingPage({
      booking, address: studioAddress(), token: request.params.token
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * The answer.
 *
 * Both outcomes go through here because both matter: a decline frees the slot
 * and tells the studio to suggest another, which is the whole reason declining
 * is one click rather than an email nobody writes.
 */
async function answer(request, response, next, decision) {
  try {
    const { booking, reason, answered } = await answerBooking(request.params.token, decision);

    if (!booking && reason === 'not_found') {
      return response.status(404).type('html').send(renderBookingNotice({
        title: 'Link not found',
        message: 'This booking link does not exist.'
      }));
    }

    /* Second click, or a forwarded link: show where things stand rather than
       overturning the first answer. */
    if (!answered) {
      return response.type('html').send(renderBookingAnswered({
        booking, address: studioAddress(), alreadyAnswered: true
      }));
    }

    if (booking.state === 'confirmed') {
      const ics = icsFor(booking);

      /* The client's copy, then the studio's — the studio one carries the file
         that goes into the shared calendar, and only now that it is agreed. */
      await sendBookingConfirmedEmail({ booking, address: studioAddress(), ics });
      await sendBookingToStudioEmail({ booking, address: studioAddress(), ics, answer: 'confirmed' });
      await noteBookingEvent(booking.id, 'added_to_calendar');
    } else {
      await sendBookingToStudioEmail({ booking, address: studioAddress(), answer: 'declined' });
    }

    return response.type('html').send(renderBookingAnswered({
      booking, address: studioAddress(), alreadyAnswered: false
    }));
  } catch (error) {
    return next(error);
  }
}

router.post('/b/:token/confirm', (request, response, next) => answer(request, response, next, 'confirm'));
router.post('/b/:token/decline', (request, response, next) => answer(request, response, next, 'decline'));

/** The calendar file, for a client whose mail client swallowed the attachment. */
router.get('/b/:token/calendar.ics', async (request, response, next) => {
  try {
    const booking = await findByToken(request.params.token);

    if (!booking || booking.state === 'cancelled') {
      return response.status(404).type('text').send('No such booking.');
    }

    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="studio-session.ics"');

    return response.send(icsFor(booking, {
      method: booking.state === 'confirmed' ? 'PUBLISH' : 'REQUEST',
      status: booking.state === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'
    }));
  } catch (error) {
    return next(error);
  }
});

export default router;
