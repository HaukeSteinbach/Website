/**
 * Admin API.
 *
 * Every route here used to answer with the same invented record — "Anna Meyer",
 * SB-2026-000123 — behind a header check anyone could pass. It is now the real
 * thing, over the project store, behind a real password.
 */

import { randomUUID } from 'node:crypto';

import express from 'express';

import { config } from '../lib/config.js';
import { fail, ok } from '../lib/http.js';
import {
  sendDeliveryEmail,
  sendRevisionAcknowledgementEmail,
  sendShippedEmail
} from '../lib/mail.js';
import {
  addEvent,
  createProject,
  getProject,
  listProjects,
  ProjectError,
  SERVICES,
  updateProject
} from '../lib/projects.js';
import {
  addOrderEvent,
  getOrder,
  listOrders,
  updateOrder
} from '../lib/orders.js';
import { getDownloadUrl, isStorageConfigured } from '../lib/storage.js';
import {
  deliveryUpload,
  describeUploadError,
  discardFiles,
  toStoredFiles
} from '../lib/upload.js';
import {
  clearFailedLogins,
  clearSession,
  isAdminConfigured,
  issueSession,
  loginBlocked,
  noteFailedLogin,
  requireAdmin,
  verifyPassword
} from '../middleware/auth.js';

const router = express.Router();

function clientIp(request) {
  const forwarded = request.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : request.ip;
}

function isSecureRequest(request) {
  const proto = request.get('x-forwarded-proto');
  return proto ? proto.split(',')[0].trim() === 'https' : request.secure;
}

/* --------------------------------------------------------------------------
   Session
   -------------------------------------------------------------------------- */

router.post('/auth/login', (request, response) => {
  if (!isAdminConfigured()) {
    return fail(response, 503, 'admin_not_configured',
      'The admin area is not set up on this server yet.');
  }

  const ip = clientIp(request);

  if (loginBlocked(ip)) {
    return fail(response, 429, 'too_many_attempts',
      'Too many failed attempts. Try again in 15 minutes.');
  }

  if (!verifyPassword(request.body?.password || '', config.adminPasswordHash)) {
    noteFailedLogin(ip);
    return fail(response, 401, 'invalid_password', 'That password does not match.');
  }

  clearFailedLogins(ip);
  issueSession(response, isSecureRequest(request));

  return ok(response, { ok: true });
});

router.post('/auth/logout', (_request, response) => {
  clearSession(response);
  return ok(response, { ok: true });
});

router.get('/auth/me', requireAdmin, (_request, response) => ok(response, { ok: true }));

/* --------------------------------------------------------------------------
   Projects
   -------------------------------------------------------------------------- */

router.get('/projects', requireAdmin, async (_request, response, next) => {
  try {
    const projects = await listProjects();

    return ok(response, {
      projects: projects.map(toListEntry),
      counts: {
        total: projects.length,
        open: projects.filter((p) => p.status !== 'done').length,
        awaitingRevision: projects.filter((p) => p.status === 'revision_requested').length
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/projects/:id', requireAdmin, async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);

    if (!project) {
      return fail(response, 404, 'not_found', 'Project not found.');
    }

    return ok(response, { project: toDetail(project) });
  } catch (error) {
    return next(error);
  }
});

/** Start a project without a customer upload — the common case for a one-off delivery. */
router.post('/projects', requireAdmin, async (request, response, next) => {
  try {
    const clientEmail = String(request.body?.clientEmail || '').trim();

    if (!isValidEmail(clientEmail)) {
      return fail(response, 422, 'validation_error', 'A valid client email address is required.');
    }

    const project = await createProject({
      title: request.body?.title,
      service: request.body?.service,
      clientName: request.body?.clientName,
      clientEmail,
      notes: request.body?.notes,
      origin: 'admin'
    });

    await updateProject(project.id, (draft) => {
      addEvent(draft, 'project_created', { by: 'admin' });
    });

    return ok(response, { project: toDetail(project) }, 201);
  } catch (error) {
    return next(error);
  }
});

router.post('/projects/:id/close', requireAdmin, async (request, response, next) => {
  try {
    const closed = request.body?.closed !== false;
    const { project } = await updateProject(request.params.id, (draft) => {
      draft.closed = closed;
      addEvent(draft, closed ? 'project_closed' : 'project_reopened');
    });

    return ok(response, { project: toDetail(project) });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Deliveries
   -------------------------------------------------------------------------- */

/**
 * Upload the finished files and send the customer their link, in one request.
 *
 * This is the whole of "send files" now: pick the project, drop the files,
 * write a note, send. There is no separate step that has to be remembered
 * afterwards, because forgetting it was how a delivery used to sit on the
 * server with nobody told about it.
 */
router.post('/projects/:id/deliveries', requireAdmin, (request, response, next) => {
  if (!isStorageConfigured()) {
    return fail(response, 503, 'storage_not_configured', 'Object storage is not set up on this server.');
  }

  const upload = deliveryUpload(() => request.params.id).array('files');

  upload(request, response, async (uploadError) => {
    if (uploadError) {
      const described = describeUploadError(uploadError);
      return fail(response, described.status, described.code, described.message);
    }

    const files = Array.isArray(request.files) ? request.files : [];

    try {
      if (!files.length) {
        return fail(response, 422, 'validation_error', 'Add at least one file to send.');
      }

      const project = await getProject(request.params.id);

      if (!project) {
        await discardFiles(files);
        return fail(response, 404, 'not_found', 'Project not found.');
      }

      const token = randomToken();
      const expiresAt = new Date(Date.now() + config.sourceDownloadLinkTtlHours * 3600 * 1000).toISOString();
      const note = String(request.body?.note || '').trim();

      const { project: updated, result } = await updateProject(project.id, (draft) => {
        const version = (draft.deliveries || []).length + 1;
        const delivery = {
          id: randomToken(),
          version,
          note,
          token,
          files: toStoredFiles(files),
          sentAt: new Date().toISOString(),
          expiresAt,
          firstDownloadedAt: null,
          downloadCount: 0
        };

        draft.deliveries = draft.deliveries || [];
        draft.deliveries.push(delivery);
        addEvent(draft, 'delivered', { version, files: delivery.files.length });

        return delivery;
      });

      const pageUrl = deliveryUrl(token);
      const mail = await sendDeliveryEmail({ project: updated, delivery: result, pageUrl });

      return ok(response, {
        project: toDetail(updated),
        delivery: { version: result.version, pageUrl, expiresAt },
        notification: mail
      }, 201);
    } catch (error) {
      await discardFiles(files);
      return next(error);
    }
  });
});

/** Send the same delivery link again, unchanged. */
router.post('/projects/:id/deliveries/:deliveryId/resend', requireAdmin, async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);

    if (!project) {
      return fail(response, 404, 'not_found', 'Project not found.');
    }

    const delivery = (project.deliveries || []).find((entry) => entry.id === request.params.deliveryId);

    if (!delivery) {
      return fail(response, 404, 'not_found', 'Delivery not found.');
    }

    const mail = await sendDeliveryEmail({
      project,
      delivery,
      pageUrl: deliveryUrl(delivery.token)
    });

    await updateProject(project.id, (draft) => {
      addEvent(draft, 'delivery_resent', { version: delivery.version });
    });

    return ok(response, { notification: mail });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Files and revisions
   -------------------------------------------------------------------------- */

/** A short-lived direct link, so a multi-gigabyte download bypasses this server. */
router.get('/projects/:id/files/:fileId', requireAdmin, async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);

    if (!project) {
      return fail(response, 404, 'not_found', 'Project not found.');
    }

    const file = allFiles(project).find((entry) => entry.id === request.params.fileId);

    if (!file) {
      return fail(response, 404, 'not_found', 'File not found.');
    }

    return ok(response, { url: await getDownloadUrl(file.key, file.name), name: file.name });
  } catch (error) {
    return next(error);
  }
});

/** Acknowledge a revision request, so the customer knows it arrived. */
router.post('/projects/:id/revisions/:revisionId/acknowledge', requireAdmin, async (request, response, next) => {
  try {
    const project = await getProject(request.params.id);

    if (!project) {
      return fail(response, 404, 'not_found', 'Project not found.');
    }

    const revision = (project.revisions || []).find((entry) => entry.id === request.params.revisionId);

    if (!revision) {
      return fail(response, 404, 'not_found', 'Revision not found.');
    }

    const mail = await sendRevisionAcknowledgementEmail({ project, revision });

    await updateProject(project.id, (draft) => {
      const target = (draft.revisions || []).find((entry) => entry.id === request.params.revisionId);
      if (target) target.acknowledgedAt = new Date().toISOString();
      addEvent(draft, 'revision_acknowledged');
    });

    return ok(response, { notification: mail });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Orders
   --------------------------------------------------------------------------
   The shop side. Deliberately separate from projects: a sale and a mixing job
   have nothing to do with each other beyond both being work.
   -------------------------------------------------------------------------- */

router.get('/orders', requireAdmin, async (_request, response, next) => {
  try {
    const orders = await listOrders();

    return ok(response, {
      orders: orders.map(toOrderEntry),
      counts: {
        total: orders.length,
        toShip: orders.filter((order) => order.status === 'paid').length,
        revenueCents: orders
          .filter((order) => order.status !== 'refunded' && order.status !== 'cancelled')
          .reduce((sum, order) => sum + (order.totalCents || 0), 0)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/orders/:id', requireAdmin, async (request, response, next) => {
  try {
    const order = await getOrder(request.params.id);

    if (!order) {
      return fail(response, 404, 'not_found', 'Order not found.');
    }

    return ok(response, { order: { ...toOrderEntry(order), buyer: order.buyer, events: order.events || [] } });
  } catch (error) {
    return next(error);
  }
});

/** The invoice PDF, as a short-lived direct link. */
router.get('/orders/:id/invoice', requireAdmin, async (request, response, next) => {
  try {
    const order = await getOrder(request.params.id);

    if (!order?.invoiceKey) {
      return fail(response, 404, 'not_found', 'No invoice on this order.');
    }

    return ok(response, {
      url: await getDownloadUrl(order.invoiceKey, `Rechnung-${order.invoiceNumber}.pdf`)
    });
  } catch (error) {
    return next(error);
  }
});

/** Mark as posted and tell the buyer. */
router.post('/orders/:id/shipped', requireAdmin, async (request, response, next) => {
  try {
    const note = String(request.body?.note || '').trim();

    const { order } = await updateOrder(request.params.id, (draft) => {
      draft.status = 'shipped';
      draft.shippedAt = new Date().toISOString();
      draft.trackingNote = note || null;
      addOrderEvent(draft, 'shipped', note ? { note } : null);
    });

    const mail = await sendShippedEmail({ order });

    return ok(response, { order: toOrderEntry(order), notification: mail });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Shaping
   -------------------------------------------------------------------------- */

function toOrderEntry(order) {
  return {
    id: order.id,
    invoiceNumber: order.invoiceNumber,
    product: order.product,
    quantity: order.quantity,
    itemCents: order.itemCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status,
    buyerName: order.buyer?.name || '',
    buyerEmail: order.buyer?.email || '',
    city: order.buyer?.city || '',
    country: order.buyer?.country || '',
    shippedAt: order.shippedAt,
    trackingNote: order.trackingNote,
    mailSent: Boolean(order.mailSentAt),
    hasInvoice: Boolean(order.invoiceKey),
    createdAt: order.createdAt
  };
}

function toListEntry(project) {
  return {
    id: project.id,
    reference: project.reference,
    title: project.title,
    service: project.service,
    client: project.client,
    status: project.status,
    currentVersion: project.currentVersion,
    revisionCount: project.revisionCount,
    openRevisionCount: project.openRevisionCount,
    downloaded: project.downloaded,
    sourceFileCount: (project.sourceFiles || []).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastDeliveryAt: project.lastDeliveryAt
  };
}

function toDetail(project) {
  return {
    ...toListEntry(project),
    notes: project.notes,
    origin: project.origin,
    closed: project.closed,
    sourceFiles: project.sourceFiles || [],
    deliveries: (project.deliveries || []).map((delivery) => ({
      id: delivery.id,
      version: delivery.version,
      note: delivery.note,
      files: delivery.files,
      sentAt: delivery.sentAt,
      expiresAt: delivery.expiresAt,
      firstDownloadedAt: delivery.firstDownloadedAt,
      downloadCount: delivery.downloadCount,
      pageUrl: deliveryUrl(delivery.token)
    })),
    revisions: project.revisions || [],
    events: project.events || []
  };
}

function allFiles(project) {
  return [
    ...(project.sourceFiles || []),
    ...(project.deliveries || []).flatMap((delivery) => delivery.files || []),
    ...(project.revisions || []).flatMap((revision) => revision.files || [])
  ];
}

export function deliveryUrl(token) {
  return `${config.appOrigin.replace(/\/$/, '')}/d/${token}`;
}

function randomToken() {
  return randomUUID().replace(/-/g, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

export { ProjectError, SERVICES };
export default router;
