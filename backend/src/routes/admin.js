import express from 'express';

import { requireAdmin } from '../middleware/auth.js';
import { ok } from '../lib/http.js';

const router = express.Router();

router.post('/auth/login', (request, response) => {
  ok(response, {
    ok: true,
    admin: {
      id: crypto.randomUUID(),
      email: request.body.email || 'admin@yourdomain.com',
      role: 'admin'
    }
  });
});

router.get('/auth/me', requireAdmin, (_request, response) => {
  ok(response, {
    id: crypto.randomUUID(),
    email: 'admin@yourdomain.com',
    role: 'admin'
  });
});

router.post('/auth/logout', requireAdmin, (_request, response) => {
  ok(response, { ok: true });
});

router.get('/jobs', requireAdmin, (_request, response) => {
  ok(response, {
    items: [
      {
        id: crypto.randomUUID(),
        reference: 'SB-2026-000123',
        clientName: 'Anna Meyer',
        email: 'anna@example.com',
        service: 'mastering',
        status: 'uploaded',
        createdAt: '2026-03-26T10:00:00Z',
        uploadCompletedAt: '2026-03-26T10:15:00Z'
      }
    ],
    page: 1,
    pageSize: 20,
    total: 1
  });
});

router.get('/jobs/:jobId', requireAdmin, (request, response) => {
  ok(response, {
    id: request.params.jobId,
    reference: 'SB-2026-000123',
    status: 'uploaded',
    service: 'mastering',
    client: {
      firstName: 'Anna',
      lastName: 'Meyer',
      email: 'anna@example.com',
      address: {
        street1: 'Example Street 1',
        street2: '',
        postalCode: '20095',
        city: 'Hamburg',
        region: '',
        country: 'DE'
      }
    },
    projectNotes: '2-track EP, reference included.',
    sourceFiles: [
      {
        id: crypto.randomUUID(),
        name: 'mixdown.wav',
        sizeBytes: 812345678,
        uploadedAt: '2026-03-26T10:10:00Z'
      }
    ],
    deliveries: [],
    revisions: [],
    events: [
      {
        type: 'uploaded',
        actorType: 'client',
        actorId: null,
        metadata: {},
        createdAt: '2026-03-26T10:16:00Z'
      }
    ]
  });
});

router.post('/jobs/:jobId/source-download', requireAdmin, (_request, response) => {
  ok(response, {
    ok: true,
    eventsTriggered: ['admin_downloaded', 'in_progress_sent'],
    download: {
      mode: 'signed-url',
      expiresInSeconds: 900,
      urls: [
        {
          fileId: crypto.randomUUID(),
          fileName: 'mixdown.wav',
          url: 'https://storage.example.com/source-download'
        }
      ]
    }
  });
});

router.post('/jobs/:jobId/deliveries', requireAdmin, (_request, response) => {
  ok(response, {
    ok: true,
    delivery: {
      id: crypto.randomUUID(),
      version: 1,
      expiresAt: '2026-04-26T12:00:00Z',
      event: 'delivered'
    },
    clientAccess: {
      deliveryUrl: 'https://app.yourdomain.com/delivery/demo-token'
    }
  }, 201);
});

router.post('/deliveries/:deliveryId/resend', requireAdmin, (_request, response) => {
  ok(response, { ok: true });
});

router.post('/deliveries/:deliveryId/regenerate-link', requireAdmin, (_request, response) => {
  ok(response, {
    ok: true,
    deliveryUrl: 'https://app.yourdomain.com/delivery/regenerated-token',
    expiresAt: '2026-04-26T12:00:00Z'
  });
});

router.post('/jobs/:jobId/expire', requireAdmin, (_request, response) => {
  ok(response, {
    ok: true,
    status: 'expired_deleted',
    event: 'expired_deleted'
  });
});

router.get('/jobs/:jobId/events', requireAdmin, (_request, response) => {
  ok(response, {
    items: [
      {
        type: 'uploaded',
        actorType: 'client',
        actorId: null,
        metadata: {},
        createdAt: '2026-03-26T10:16:00Z'
      },
      {
        type: 'admin_downloaded',
        actorType: 'admin',
        actorId: 'demo-admin',
        metadata: { downloadMode: 'signed-url' },
        createdAt: '2026-03-26T12:00:00Z'
      }
    ]
  });
});

export default router;
