/**
 * Projects — the one record the whole file handoff turns around.
 *
 * Before this, an upload, a delivery and a revision request were three
 * unrelated things: the upload lived in a Map, the delivery in another Map,
 * and the revision went to Formspree and was never stored at all. Nothing
 * survived a deploy and nothing could be looked up afterwards.
 *
 * Now one project carries the customer, their source files, every delivery
 * with its version, and every revision request. It lives as a single JSON
 * object in R2.
 *
 * Why one file rather than one per project: the list view needs every project
 * anyway, this is a handful of records a month, and a single object means a
 * single read. Writes go through updateProject(), which retries against the
 * object's ETag so two requests landing together cannot overwrite each other.
 */

import { randomUUID } from 'node:crypto';

import { getObjectText, putObject, StorageError } from './storage.js';

const INDEX_KEY = 'projects/index.json';
const WRITE_ATTEMPTS = 5;

export const SERVICES = ['mixing', 'mastering', 'production', 'other'];

export class ProjectError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ProjectError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/* ---------------------------------------------------------------------------
   Reading
   --------------------------------------------------------------------------- */

async function readIndex() {
  const stored = await getObjectText(INDEX_KEY);

  if (!stored) {
    return { index: { projects: [] }, etag: null };
  }

  try {
    const parsed = JSON.parse(stored.text);
    return {
      index: { projects: Array.isArray(parsed.projects) ? parsed.projects : [] },
      etag: stored.etag
    };
  } catch (error) {
    /* Refuse rather than start a fresh index: overwriting an unreadable file
       would turn a parse problem into real data loss. */
    throw new StorageError('The project index could not be parsed.', error);
  }
}

export async function listProjects() {
  const { index } = await readIndex();

  return index.projects
    .map(withDerivedState)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(id) {
  const { index } = await readIndex();
  const project = index.projects.find((entry) => entry.id === id);

  return project ? withDerivedState(project) : null;
}

/**
 * Find a project by one of the tokens handed to a customer.
 *
 * Tokens are stored as they were issued rather than hashed, so a delivery link
 * can be shown again or resent from the admin area. The bucket is private and
 * the tokens are 128 bits of randomness, so the trade buys real convenience
 * for little exposure.
 */
export async function findByDeliveryToken(token) {
  if (!token) {
    return null;
  }

  const { index } = await readIndex();

  for (const project of index.projects) {
    const delivery = (project.deliveries || []).find((entry) => entry.token === token);
    if (delivery) {
      return { project: withDerivedState(project), delivery };
    }
  }

  return null;
}

export async function findBySourceToken(token) {
  if (!token) {
    return null;
  }

  const { index } = await readIndex();
  const project = index.projects.find((entry) => entry.sourceToken === token);

  return project ? withDerivedState(project) : null;
}

/* ---------------------------------------------------------------------------
   Writing
   --------------------------------------------------------------------------- */

/**
 * Read, apply `mutate`, write back only if nobody else wrote in between.
 *
 * On a lost race the whole thing runs again against the fresh index, so the
 * mutation must be safe to repeat — it works on the project it is handed, and
 * does not capture values read earlier.
 */
export async function updateProject(id, mutate) {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();
    const position = index.projects.findIndex((entry) => entry.id === id);

    if (position === -1) {
      throw new ProjectError(404, 'not_found', 'Project not found.');
    }

    const project = structuredClone(index.projects[position]);
    const result = await mutate(project);

    project.updatedAt = new Date().toISOString();
    index.projects[position] = project;

    try {
      await writeIndex(index, etag);
      return { project: withDerivedState(project), result };
    } catch (error) {
      if (error.code !== 'precondition_failed' || attempt === WRITE_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new StorageError('The project index is busy. Try again.');
}

export async function createProject(input) {
  const now = new Date().toISOString();

  const project = {
    /* The caller may pass an id it has already used for storage keys, so a
       project can be written after its files rather than before them. */
    id: input.id || randomUUID(),
    reference: null,           /* filled below, once the index is known */
    title: String(input.title || '').trim(),
    service: SERVICES.includes(input.service) ? input.service : 'other',
    client: {
      name: String(input.clientName || '').trim(),
      email: String(input.clientEmail || '').trim().toLowerCase(),
      address: input.address || null
    },
    notes: String(input.notes || '').trim(),
    origin: input.origin === 'client' ? 'client' : 'admin',
    closed: false,
    sourceToken: null,
    sourceFiles: Array.isArray(input.sourceFiles) ? input.sourceFiles : [],
    deliveries: [],
    revisions: [],
    events: [],
    createdAt: now,
    updatedAt: now
  };

  if (input.firstEvent) {
    addEvent(project, input.firstEvent.type, input.firstEvent.detail);
  }

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { index, etag } = await readIndex();

    project.reference = nextReference(index.projects);
    index.projects.push(project);

    try {
      await writeIndex(index, etag);
      return withDerivedState(project);
    } catch (error) {
      if (error.code !== 'precondition_failed' || attempt === WRITE_ATTEMPTS) {
        throw error;
      }

      index.projects.pop();
    }
  }

  throw new StorageError('The project index is busy. Try again.');
}

async function writeIndex(index, etag) {
  await putObject(INDEX_KEY, JSON.stringify(index, null, 2), {
    contentType: 'application/json',
    /* On the very first write there is nothing to match, so demand that the
       object does not exist yet; afterwards demand the exact version read. */
    ifMatch: etag || undefined,
    ifNoneMatch: etag ? undefined : '*'
  });
}

/* ---------------------------------------------------------------------------
   Derived state
   ---------------------------------------------------------------------------
   Status is computed, never stored, so it cannot drift from what actually
   happened. The only thing anyone sets by hand is `closed`.
   --------------------------------------------------------------------------- */

function withDerivedState(project) {
  const deliveries = project.deliveries || [];
  const revisions = project.revisions || [];
  const lastDelivery = deliveries[deliveries.length - 1] || null;

  /* A revision counts as open while no delivery has followed it. */
  const openRevisions = revisions.filter((revision) => {
    if (!lastDelivery) return true;
    return String(revision.requestedAt) > String(lastDelivery.sentAt);
  });

  let status = 'new';
  if (project.closed) status = 'done';
  else if (openRevisions.length) status = 'revision_requested';
  else if (lastDelivery) status = 'delivered';
  else if (deliveries.length === 0 && (project.sourceFiles || []).length) status = 'in_progress';

  return {
    ...project,
    status,
    revisionCount: revisions.length,
    openRevisionCount: openRevisions.length,
    deliveryCount: deliveries.length,
    currentVersion: lastDelivery ? lastDelivery.version : 0,
    lastDeliveryAt: lastDelivery ? lastDelivery.sentAt : null,
    downloaded: Boolean(lastDelivery && lastDelivery.firstDownloadedAt)
  };
}

export function addEvent(project, type, detail) {
  project.events = project.events || [];
  project.events.push({
    type,
    at: new Date().toISOString(),
    detail: detail || null
  });
}

/* ---------------------------------------------------------------------------
   References
   ---------------------------------------------------------------------------
   SB-<year>-<counter>. Counted rather than random: two projects can no longer
   collide, and the number says how many came before it this year. */

function nextReference(projects) {
  const year = new Date().getUTCFullYear();
  const prefix = `SB-${year}-`;

  const highest = projects
    .map((project) => project.reference)
    .filter((reference) => typeof reference === 'string' && reference.startsWith(prefix))
    .map((reference) => Number.parseInt(reference.slice(prefix.length), 10))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);

  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

/** The storage key for a file. Keeps everything for a project under one prefix. */
export function fileKey(projectId, kind, fileId, filename) {
  const safe = String(filename || 'file')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'file';

  return `projects/${projectId}/${kind}/${fileId}-${safe}`;
}
