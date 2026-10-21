/**
 * Project CRUD.
 *
 * A project is the unit the user opens and saves: metadata plus the editable
 * design (objects, palette, hoop). The design lives in MongoDB as a document
 * - there is no parallel file store and no in-memory fallback, so what the
 * UI reports as saved is genuinely durable.
 *
 * Writes use optimistic concurrency: the client supplies the `version` it
 * loaded, and a stale write is rejected instead of silently clobbering a
 * newer save.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, collection } from '../db/mongo.js';
import { ApiError } from '../http/errors.js';
import {
  asyncHandler,
  body,
  query,
  requireObjectId,
  validateBody,
  validateQuery,
} from '../middleware/validate.js';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type DesignDocumentInput,
} from '../schemas/design.js';
import { recordRecent, recordVersion } from './history.js';
import { wireId } from '../util/id.js';
import { z } from 'zod';

export interface ProjectRecord {
  _id: ObjectId;
  name: string;
  design: DesignDocumentInput;
  /** Optimistic concurrency token, incremented on every save. */
  version: number;
  /** Flattened stitch totals from the last compile, for the project list. */
  summary: {
    objectCount: number;
    colorCount: number;
    width: number;
    height: number;
    hoopId: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ListQuerySchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const projectsRouter: Router = Router();

function summaryOf(design: DesignDocumentInput) {
  const colors = new Set(design.objects.map((o) => o.colorIndex)).size;
  return {
    objectCount: design.objects.length,
    colorCount: Math.max(
      colors,
      design.threadPalette.length > 0 ? Math.min(colors || 1, design.threadPalette.length) : colors,
    ),
    width: design.width,
    height: design.height,
    hoopId: design.hoopId,
  };
}

/** Strip the Mongo `_id` so the wire shape matches what the client types. */
function toDto(record: ProjectRecord) {
  const { _id, ...rest } = record;
  return { id: wireId(_id), ...rest };
}

/**
 * Wire shape for a library row.
 *
 * The design is deliberately omitted. The browser fetches it per project when
 * one is opened, so sending every design in the list only made the response
 * grow with the library - exactly the payload a hosted function's body limit
 * cannot absorb. The summary is enough to render the row.
 */
function toListItem(record: ProjectRecord) {
  return {
    id: wireId(record._id),
    name: record.name,
    version: record.version,
    summary: record.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// --- list -------------------------------------------------------------------
projectsRouter.get(
  '/',
  validateQuery(ListQuerySchema),
  asyncHandler(async (req, res) => {
    const { search, limit, offset } = query<typeof ListQuerySchema>(req);

    const filter = search
      ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};

    const [items, total] = await Promise.all([
      collection<ProjectRecord>(COLLECTIONS.projects)
        // The response omits the design; keep it out of the Mongo transfer too.
        .find(filter, { projection: { design: 0 } })
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      collection<ProjectRecord>(COLLECTIONS.projects).countDocuments(filter),
    ]);

    res.json({ items: items.map(toListItem), total, offset, limit });
  }),
);

// --- create -----------------------------------------------------------------
projectsRouter.post(
  '/',
  validateBody(ProjectCreateSchema),
  asyncHandler(async (req, res) => {
    const input = body<typeof ProjectCreateSchema>(req);
    const now = new Date();

    const record: ProjectRecord = {
      _id: new ObjectId(),
      name: input.name,
      design: input.design,
      version: 0,
      summary: summaryOf(input.design),
      createdAt: now,
      updatedAt: now,
    };

    await collection<ProjectRecord>(COLLECTIONS.projects).insertOne(record);
    res.status(201).json(toDto(record));
  }),
);

// --- read -------------------------------------------------------------------
projectsRouter.get(
  '/:id',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const record = await collection<ProjectRecord>(COLLECTIONS.projects).findOne({
      _id: new ObjectId(req.params['id']!),
    });
    if (!record) throw ApiError.notFound('Project not found');

    // Opening a project is what makes it "recent". A failure here must not
    // block the open - the list is a convenience, and refusing to load a
    // design because a convenience list could not be updated would be worse
    // than an out-of-date list.
    try {
      await recordRecent(record._id.toHexString(), record.name, record.design);
    } catch {
      // Deliberately swallowed: the project itself loaded fine.
    }

    res.json(toDto(record));
  }),
);

// --- update -----------------------------------------------------------------
projectsRouter.put(
  '/:id',
  requireObjectId(),
  validateBody(ProjectUpdateSchema),
  asyncHandler(async (req, res) => {
    const input = body<typeof ProjectUpdateSchema>(req);
    const id = new ObjectId(req.params['id']!);
    const projects = collection<ProjectRecord>(COLLECTIONS.projects);

    const current = await projects.findOne({ _id: id });
    if (!current) throw ApiError.notFound('Project not found');

    // Reject a save based on a stale copy rather than overwriting newer work.
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw ApiError.conflict('This project was changed elsewhere. Reload before saving again.', {
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
      });
    }

    const design = input.design ?? current.design;
    const now = new Date();

    // Snapshot the design AS IT IS NOW, before it is replaced: the entry a
    // user clicks in history has to be the state that actually existed, not a
    // reconstruction of what they are about to lose. Skipped when nothing
    // changed, because autosave would otherwise fill the timeline with
    // identical copies and bury the saves that mattered.
    const changed =
      input.design !== undefined && JSON.stringify(input.design) !== JSON.stringify(current.design);
    if (changed) {
      await recordVersion(id.toHexString(), current.version, current.design, 'auto');
    }

    const updated = await projects.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          design,
          summary: summaryOf(design),
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );

    if (!updated) throw ApiError.notFound('Project not found');
    res.json(toDto(updated));
  }),
);

// --- delete -----------------------------------------------------------------
projectsRouter.delete(
  '/:id',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const id = new ObjectId(req.params['id']!);
    const projects = collection<ProjectRecord>(COLLECTIONS.projects);
    const versions = collection(COLLECTIONS.designVersions);

    const result = await projects.deleteOne({ _id: id });
    if (result.deletedCount === 0) throw ApiError.notFound('Project not found');

    // Versions are meaningless once the project is gone.
    await versions.deleteMany({ projectId: id.toHexString() });

    res.status(204).end();
  }),
);

/** Exposed so tests can build a request body without duplicating defaults. */
export const projectSchemas = { create: ProjectCreateSchema, update: ProjectUpdateSchema };
