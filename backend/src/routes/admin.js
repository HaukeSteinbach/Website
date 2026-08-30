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
import {
  addLegacyInvoice,
  deleteCustomer,
  markLegacyPaid,
  getCustomer,
  listCustomers,
  upsertCustomer
} from '../lib/customers.js';
import { buchungenAus, ordneZu } from '../lib/bank-import.js';
import { SERVICES as CATALOGUE, getService } from '../lib/catalogue.js';
import { buildDocumentPdf } from '../lib/document-pdf.js';
import {
  createDraft,
  deleteDraft,
  documentKey,
  getDocument,
  issueDocument,
  listDocuments,
  markPaid,
  noteEvent,
  setPdfKey,
  updateDraft
} from '../lib/documents.js';
import { kundenAus, rechnungenAus, zuordnen } from '../lib/onlydesk-import.js';
import {
  issueLoginCode,
  verifyLoginCode,
  LOGIN_CODE_TTL_MINUTES
} from '../lib/login-codes.js';
import { fail, ok } from '../lib/http.js';
import {
  sendDeliveryEmail,
  sendRevisionAcknowledgementEmail,
  sendDocumentEmail,
  sendShippedEmail,
  sendLoginCodeEmail,
  studioRecipient
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
import { getDownloadUrl, isStorageConfigured, putObject } from '../lib/storage.js';
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
  secondFactorMethod,
  verifySecondFactor,
  verifyPassword
} from '../middleware/auth.js';

const router = express.Router();

/* Die Adresse steht in der Antwort, damit man sieht, wohin der Code ging —
   aber nur angedeutet, denn diese Antwort bekommt auch, wer nur das Passwort
   erraten hat. */
function maskEmail(address) {
  const [local, domain] = String(address || '').split('@');

  if (!domain) {
    return '';
  }

  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function recipientAddress() {
  return studioRecipient();
}

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

router.post('/auth/login', async (request, response) => {
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

  const method = secondFactorMethod();

  /* Second step by app: the code is in the request already, because the phone
     produces it without anyone being asked. A wrong one counts against the
     same lockout as a wrong password — otherwise the six digits would be the
     soft spot to hammer at once the password is known. */
  if (method === 'totp') {
    if (!verifySecondFactor(request.body?.code)) {
      noteFailedLogin(ip);
      return fail(response, 401, 'invalid_code',
        'That code is not valid. It changes every 30 seconds — take the current one.');
    }

    clearFailedLogins(ip);
    issueSession(response, isSecureRequest(request));

    return ok(response, { ok: true });
  }

  /* Second step by email: nothing is open yet. The browser gets a challenge
     back and has to return with the code that just went to the studio address.
     The session is issued in /auth/verify, not here. */
  if (method === 'email') {
    const { challenge, code } = issueLoginCode();
    const sent = await sendLoginCodeEmail({ code, ip, minutes: LOGIN_CODE_TTL_MINUTES });

    if (!sent?.sent) {
      /* Saying "check your mail" when nothing was sent would leave the only
         person with a key waiting for a message that never comes. */
      console.error('[admin] login code could not be sent:', sent?.reason);
      return fail(response, 503, 'code_not_sent',
        'The code could not be sent. Check the mail settings on the server.');
    }

    return ok(response, { step: 'code', challenge, sentTo: maskEmail(recipientAddress()) });
  }

  clearFailedLogins(ip);
  issueSession(response, isSecureRequest(request));

  return ok(response, { ok: true });
});

/**
 * Second half of the email login.
 *
 * Kept apart from the password so a correct password alone opens nothing, and
 * so guessing codes runs into both the per-challenge limit (five tries, then
 * the challenge dies) and the per-address lockout.
 */
router.post('/auth/verify', async (request, response) => {
  if (!isAdminConfigured()) {
    return fail(response, 503, 'admin_not_configured',
      'The admin area is not set up on this server yet.');
  }

  const ip = clientIp(request);

  if (loginBlocked(ip)) {
    return fail(response, 429, 'too_many_attempts',
      'Too many failed attempts. Try again in 15 minutes.');
  }

  const verdict = verifyLoginCode(request.body?.challenge, request.body?.code);

  if (verdict === 'expired') {
    noteFailedLogin(ip);
    return fail(response, 401, 'code_expired',
      'That code has expired. Sign in again to get a new one.');
  }

  if (verdict !== 'ok') {
    noteFailedLogin(ip);
    return fail(response, 401, 'invalid_code', 'That code does not match.');
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
   Customers
   --------------------------------------------------------------------------
   The address book, plus everything already known about a person elsewhere.
   Projects and orders are not copied in — they are looked up by email address
   each time, so there is one truth per fact and nothing to keep in step.
   -------------------------------------------------------------------------- */

async function withLinks(customer) {
  const email = String(customer.email || '').toLowerCase();

  if (!email) {
    return { ...customer, projects: [], orders: [] };
  }

  const [projects, orders] = await Promise.all([listProjects(), listOrders()]);

  return {
    ...customer,
    projects: projects
      .filter((p) => String(p.client?.email || '').toLowerCase() === email)
      .map((p) => ({ id: p.id, title: p.title, status: p.status, createdAt: p.createdAt })),
    orders: orders
      .filter((o) => String(o.buyer?.email || '').toLowerCase() === email)
      .map((o) => ({
        id: o.id,
        invoiceNumber: o.invoiceNumber,
        totalCents: o.totalCents,
        status: o.status,
        createdAt: o.createdAt
      }))
  };
}

router.get('/customers', requireAdmin, async (_request, response, next) => {
  try {
    const [customers, projects, orders] = await Promise.all([
      listCustomers(), listProjects(), listOrders()
    ]);

    /* Zaehlen statt je Kunde nachzuschlagen: bei zwanzig Kunden ist das egal,
       bei zweihundert waere das Nachschlagen zweihundert Durchlaeufe. */
    const projektZahl = new Map();
    const bestellZahl = new Map();

    for (const p of projects) {
      const key = String(p.client?.email || '').toLowerCase();
      if (key) projektZahl.set(key, (projektZahl.get(key) || 0) + 1);
    }

    for (const o of orders) {
      const key = String(o.buyer?.email || '').toLowerCase();
      if (key) bestellZahl.set(key, (bestellZahl.get(key) || 0) + 1);
    }

    return ok(response, {
      customers: customers.map((c) => {
        const key = String(c.email || '').toLowerCase();

        return {
          id: c.id,
          name: c.name,
          email: c.email,
          city: c.address?.city || '',
          source: c.source,
          counts: {
            projects: projektZahl.get(key) || 0,
            orders: bestellZahl.get(key) || 0,
            legacyInvoices: c.legacyInvoices.length
          }
        };
      }),
      counts: { total: customers.length }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/customers/:id', requireAdmin, async (request, response, next) => {
  try {
    const customer = await getCustomer(request.params.id);

    if (!customer) {
      return fail(response, 404, 'not_found', 'No such customer.');
    }

    return ok(response, { customer: await withLinks(customer) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/customers/:id', requireAdmin, async (request, response, next) => {
  try {
    const result = await deleteCustomer(request.params.id);

    if (!result.deleted && result.reason === 'no_such_customer') {
      return fail(response, 404, 'not_found', 'No such customer.');
    }

    /* Rechnungen muessen zehn Jahre aufbewahrt werden, § 147 AO. Die Loeschung
       zu verweigern ist hier die richtige Antwort, nicht ein Versehen. */
    if (!result.deleted) {
      return fail(response, 409, 'has_invoices',
        'This customer carries invoices, which have to be kept for ten years. Delete refused.');
    }

    return ok(response, { deleted: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * Take in an Onlydesk export.
 *
 * Without `apply` nothing is written — the answer says what would happen and,
 * more to the point, what could not be matched. That number is the one to look
 * at before touching a customer base.
 */
router.post('/customers/import', requireAdmin, async (request, response, next) => {
  try {
    const auszug = request.body?.export;

    if (!auszug || !Array.isArray(auszug.kunden)) {
      return fail(response, 422, 'bad_export',
        'That does not look like an Onlydesk export — no kunden array in it.');
    }

    const aliase = new Map(Object.entries(request.body?.aliases || {}));
    const kunden = kundenAus(auszug.kunden);
    const rechnungen = rechnungenAus(auszug.rechnungen);
    const { zugeordnet, offen } = zuordnen(kunden, rechnungen, aliase);

    const bericht = {
      customers: kunden.length,
      withoutEmail: kunden.filter((k) => !k.email).length,
      invoices: rechnungen.length,
      matched: zugeordnet.length,
      unmatched: offen.map((r) => ({ number: r.number, name: r.kundenName }))
    };

    if (!request.body?.apply) {
      return ok(response, { dryRun: true, ...bericht });
    }

    let created = 0;
    const idFuer = new Map();

    for (const kunde of kunden) {
      const { customer, created: neu } = await upsertCustomer(kunde);
      idFuer.set(kunde, customer.id);
      if (neu) created += 1;
    }

    let filed = 0;

    for (const { rechnung, kunde } of zugeordnet) {
      const { added } = await addLegacyInvoice(idFuer.get(kunde), rechnung);
      if (added) filed += 1;
    }

    return ok(response, { dryRun: false, ...bericht, created, filed });
  } catch (error) {
    return next(error);
  }
});


/* --------------------------------------------------------------------------
   Kunden anlegen
   -------------------------------------------------------------------------- */

router.post('/customers', requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body?.name || '').trim();

    if (!name) {
      return fail(response, 422, 'name_required', 'A customer needs a name.');
    }

    const { customer, created } = await upsertCustomer({ ...request.body, name, source: 'manual' });

    /* Kein Fehler, wenn es die Person schon gibt: gesucht war ein Kunde mit
       diesen Angaben, und der liegt vor. Ein zweiter Datensatz waere das
       Gegenteil von hilfreich. */
    return ok(response, { customer, created });
  } catch (error) {
    return next(error);
  }
});

/* --------------------------------------------------------------------------
   Angebote und Rechnungen
   -------------------------------------------------------------------------- */

router.get('/catalogue', requireAdmin, (_request, response) =>
  ok(response, { services: CATALOGUE }));

router.get('/documents', requireAdmin, async (request, response, next) => {
  try {
    const alle = await listDocuments();
    const gefiltert = request.query.projectId
      ? alle.filter((d) => d.projectId === request.query.projectId)
      : alle;

    return ok(response, {
      documents: gefiltert.map((d) => ({
        id: d.id,
        kind: d.kind,
        state: d.state,
        number: d.number,
        title: d.title,
        recipientName: d.recipient?.name || '',
        totalCents: d.totalCents,
        issuedAt: d.issuedAt,
        sentAt: d.sentAt,
        createdAt: d.createdAt,
        customerId: d.customerId,
        projectId: d.projectId
      })),
      counts: {
        total: gefiltert.length,
        drafts: gefiltert.filter((d) => d.state === 'draft').length,
        open: gefiltert.filter((d) => d.kind === 'invoice' && d.state === 'issued').length
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/documents/:id', requireAdmin, async (request, response, next) => {
  try {
    const document = await getDocument(request.params.id);

    if (!document) {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    return ok(response, { document });
  } catch (error) {
    return next(error);
  }
});

/**
 * Positionen aus dem Katalog aufbauen.
 *
 * Preis und Text kommen aus dem Katalog, nicht aus dem Browser — sonst
 * bestimmte die Oberflaeche, was eine Leistung kostet. Ueberschreiben ist
 * erlaubt, aber nur ausdruecklich und Feld fuer Feld.
 */
function positionenAus(items) {
  return (items || []).map((item) => {
    const service = getService(item.slug);

    return {
      slug: item.slug || null,
      name: String(item.name || service?.name || '').trim(),
      description: item.description !== undefined
        ? String(item.description).trim()
        : (service?.description || ''),
      quantity: Number(item.quantity) || 1,
      unitCents: item.unitCents !== undefined
        ? Math.round(Number(item.unitCents))
        : (service?.unitCents || 0)
    };
  }).filter((position) => position.name);
}

router.post('/documents', requireAdmin, async (request, response, next) => {
  try {
    let kunde = request.body?.customerId ? await getCustomer(request.body.customerId) : null;

    if (request.body?.customerId && !kunde) {
      return fail(response, 404, 'not_found', 'No such customer.');
    }

    /* Aus einem Projekt heraus geschrieben: der Kunde steht dort schon, also
       wird er nicht noch einmal getippt. Gibt es ihn im Stamm noch nicht,
       entsteht er hier — sonst haette man nach dem dritten Auftrag drei
       Rechnungen und keinen Kunden. */
    if (!kunde && request.body?.projectId) {
      const projekt = await getProject(request.body.projectId);

      if (!projekt) {
        return fail(response, 404, 'not_found', 'No such project.');
      }

      if (projekt.client?.email) {
        const { customer } = await upsertCustomer({
          name: projekt.client.name || projekt.client.email,
          email: projekt.client.email,
          address: projekt.client.address || {},
          source: 'project'
        });

        kunde = customer;
      }
    }

    const { document } = await createDraft({
      kind: request.body?.kind,
      customerId: kunde?.id || null,
      projectId: request.body?.projectId || null,
      recipient: kunde ? empfaengerAus(kunde) : request.body?.recipient || null,
      title: request.body?.title,
      intro: request.body?.intro,
      validUntil: request.body?.validUntil,
      items: positionenAus(request.body?.items)
    });

    return ok(response, { document });
  } catch (error) {
    return next(error);
  }
});

/** Aus einem Kunden die Anschrift machen, die auf dem Beleg steht. */
function empfaengerAus(kunde) {
  return {
    name: kunde.name,
    line1: kunde.address?.line1 || '',
    line2: kunde.address?.line2 || '',
    postalCode: kunde.address?.postalCode || '',
    city: kunde.address?.city || '',
    country: kunde.address?.country || '',
    email: kunde.email || '',
    vatId: kunde.vatId || ''
  };
}

router.patch('/documents/:id', requireAdmin, async (request, response, next) => {
  try {
    const { document, reason } = await updateDraft(request.params.id, (draft) => {
      if (request.body?.title !== undefined) draft.title = String(request.body.title).trim();
      if (request.body?.intro !== undefined) draft.intro = String(request.body.intro).trim();
      if (request.body?.validUntil !== undefined) draft.validUntil = request.body.validUntil || null;
      if (request.body?.customerId !== undefined) draft.customerId = request.body.customerId || null;
      if (request.body?.items !== undefined) draft.items = positionenAus(request.body.items);
    });

    if (!document && reason === 'not_found') {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    if (!document) {
      return fail(response, 409, 'not_a_draft',
        'This one has been issued. An issued document is not edited — cancel it and write a new one.');
    }

    return ok(response, { document });
  } catch (error) {
    return next(error);
  }
});

router.delete('/documents/:id', requireAdmin, async (request, response, next) => {
  try {
    const { deleted, reason } = await deleteDraft(request.params.id);

    if (!deleted && reason === 'not_found') {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    if (!deleted) {
      return fail(response, 409, 'not_a_draft',
        'Issued documents are cancelled, not deleted — they have to stay findable for ten years.');
    }

    return ok(response, { deleted: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * Ausstellen: Nummer vergeben, PDF bauen, ablegen.
 *
 * Ab hier ist der Beleg fest. Das PDF entsteht genau einmal und wird
 * gespeichert, statt bei jedem Abruf neu erzeugt zu werden — was der Kunde in
 * der Hand haelt, muss auch dann noch abrufbar sein, wenn sich am Programm
 * etwas geaendert hat.
 */
router.post('/documents/:id/issue', requireAdmin, async (request, response, next) => {
  try {
    const vorher = await getDocument(request.params.id);

    if (!vorher) {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    const kunde = vorher.customerId ? await getCustomer(vorher.customerId) : null;
    const { document, reason } = await issueDocument(
      request.params.id,
      kunde ? empfaengerAus(kunde) : vorher.recipient
    );

    if (!document && reason === 'no_items') {
      return fail(response, 422, 'no_items', 'A document without a single line cannot be issued.');
    }

    if (!document) {
      return fail(response, 409, 'not_a_draft', 'This one has already been issued.');
    }

    const pdf = await buildDocumentPdf(document);
    const key = documentKey(document);

    await putObject(key, Buffer.from(pdf), { contentType: 'application/pdf' });
    const { document: fertig } = await setPdfKey(document.id, key);

    return ok(response, { document: fertig });
  } catch (error) {
    return next(error);
  }
});

router.get('/documents/:id/pdf', requireAdmin, async (request, response, next) => {
  try {
    const document = await getDocument(request.params.id);

    if (!document) {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    /* Ein Entwurf hat noch kein abgelegtes PDF — den zeigt man als Vorschau,
       frisch gebaut und ohne Nummer. */
    if (!document.pdfKey) {
      const pdf = await buildDocumentPdf(document);

      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', 'inline; filename="Vorschau.pdf"');

      return response.end(Buffer.from(pdf));
    }

    return ok(response, { url: await getDownloadUrl(document.pdfKey) });
  } catch (error) {
    return next(error);
  }
});

router.post('/documents/:id/send', requireAdmin, async (request, response, next) => {
  try {
    const document = await getDocument(request.params.id);

    if (!document) {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    if (document.state === 'draft') {
      return fail(response, 409, 'still_a_draft',
        'Issue it first — a draft has no number, and a document without a number should not leave the house.');
    }

    if (!document.recipient?.email) {
      return fail(response, 422, 'no_email', 'This recipient has no email address.');
    }

    const pdf = await buildDocumentPdf(document);
    const mail = await sendDocumentEmail({ document, pdf, message: request.body?.message });

    if (!mail.sent) {
      return fail(response, 502, 'mail_failed', `The mail did not go out: ${mail.reason || 'unknown'}`);
    }

    const { document: fertig } = await noteEvent(document.id, 'sent', { to: document.recipient.email });

    return ok(response, { document: fertig, sentTo: document.recipient.email });
  } catch (error) {
    return next(error);
  }
});

router.post('/documents/:id/state', requireAdmin, async (request, response, next) => {
  try {
    const erlaubt = ['cancelled', 'accepted', 'declined'];
    const what = String(request.body?.state || '');

    if (!erlaubt.includes(what)) {
      return fail(response, 422, 'bad_state', `Not something a document can become: ${what}`);
    }

    const { document } = await noteEvent(request.params.id, what);

    if (!document) {
      return fail(response, 404, 'not_found', 'No such document.');
    }

    return ok(response, { document });
  } catch (error) {
    return next(error);
  }
});


/* --------------------------------------------------------------------------
   Zahlungen
   --------------------------------------------------------------------------
   Der Kontoauszug kommt als CSV herein, wird zugeordnet und wieder vergessen.
   Gespeichert wird nur, welche Rechnung bezahlt ist — der Auszug selbst
   gehoert in die Buchhaltung, nicht hierher.
   -------------------------------------------------------------------------- */

/** Alles, was auf Geld wartet: eigene Rechnungen und das Onlydesk-Archiv. */
async function offenePosten() {
  const [belege, kunden] = await Promise.all([listDocuments(), listCustomers()]);

  const eigene = belege
    .filter((d) => d.kind === 'invoice' && d.state === 'issued')
    .map((d) => ({
      id: d.id,
      kind: 'document',
      number: d.number,
      totalCents: d.totalCents,
      date: d.issuedAt ? d.issuedAt.slice(0, 10) : '',
      who: d.recipient?.name || ''
    }));

  const alte = kunden.flatMap((kunde) => kunde.legacyInvoices
    .filter((r) => r.status === 'issued')
    .map((r) => ({
      id: kunde.id,
      kind: 'legacy',
      number: r.number,
      totalCents: r.totalCents,
      date: r.date || '',
      who: kunde.name
    })));

  return [...eigene, ...alte];
}

router.post('/payments/preview', requireAdmin, async (request, response, next) => {
  try {
    const csv = String(request.body?.csv || '');

    if (!csv.trim()) {
      return fail(response, 422, 'empty', 'No statement in that file.');
    }

    const gelesen = buchungenAus(csv);

    /* Ohne Betrag und Datum ist nichts zuzuordnen. Lieber hier abbrechen und
       sagen, welche Spalten gefunden wurden, als stumm nichts zu treffen. */
    if (gelesen.spalten.amount === undefined || gelesen.spalten.date === undefined) {
      return fail(response, 422, 'columns_not_found',
        'The date or amount column could not be found. Header was: '
        + gelesen.kopf.join(' | '));
    }

    const { treffer, uebrig, nochOffen } = ordneZu(gelesen.buchungen, await offenePosten());

    return ok(response, {
      rows: gelesen.zeilen,
      incoming: gelesen.buchungen.length,
      columns: Object.keys(gelesen.spalten),
      matches: treffer.map((t) => ({
        invoiceId: t.rechnung.id,
        invoiceKind: t.rechnung.kind,
        number: t.rechnung.number,
        who: t.rechnung.who,
        reason: t.grund,
        certain: t.sicher,
        date: t.buchung.date,
        amountCents: t.buchung.amountCents,
        reference: t.buchung.reference.slice(0, 140),
        counterparty: t.buchung.counterparty
      })),
      unmatched: uebrig.map((u) => ({
        date: u.buchung.date,
        amountCents: u.buchung.amountCents,
        reference: u.buchung.reference.slice(0, 140),
        counterparty: u.buchung.counterparty,
        reason: u.grund,
        candidates: u.kandidaten
      })),
      stillOpen: nochOffen.map((r) => ({ number: r.number, totalCents: r.totalCents, who: r.who }))
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Die bestaetigten Treffer eintragen.
 *
 * Bewusst getrennt vom Erkennen: was als bezahlt gilt, entscheidet ein Mensch,
 * nicht eine Betragsuebereinstimmung.
 */
router.post('/payments/apply', requireAdmin, async (request, response, next) => {
  try {
    const eintraege = Array.isArray(request.body?.matches) ? request.body.matches : [];
    const erledigt = [];
    const gescheitert = [];

    for (const eintrag of eintraege) {
      const zahlung = {
        date: eintrag.date || null,
        amountCents: eintrag.amountCents ?? null,
        reference: eintrag.reference || '',
        source: 'bank'
      };

      if (eintrag.invoiceKind === 'legacy') {
        const { marked, reason } = await markLegacyPaid(eintrag.invoiceId, eintrag.number, zahlung);
        (marked ? erledigt : gescheitert).push({ number: eintrag.number, reason: reason || null });
        continue;
      }

      const { document, reason } = await markPaid(eintrag.invoiceId, zahlung);
      (document ? erledigt : gescheitert).push({ number: eintrag.number, reason: reason || null });
    }

    return ok(response, { paid: erledigt.length, failed: gescheitert });
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
