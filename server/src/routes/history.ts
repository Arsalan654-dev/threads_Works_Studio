/**
 * Design history and recent files.
 *
 * Both collections existed in the schema from the start and neither was ever
 * written: a project could be saved a hundred times and still offer no way
 * back, and "recently opened" was a list nobody populated.
 *
 * Two independent sources feed them:
 *
 *  - `designVersions` is written automatically on every save, snapshotting
 *    the design as it was BEFORE that save. Snapshotting the outgoing copy is
 *    what makes the timeline honest: the entry you click is the state that
 *    existed, not a reconstruction of what you just overwrote.
 *
 *  - `recentFiles` is written whenever a project is opened, so the browser
 *    can offer "carry on where you left off" on the next launch.
 *
 * Versions are pruned to a per-project cap. Without a cap a design saved
 * every thirty seconds for a working day would leave two and a half thousand
 * full copies of a document that can already run to megabytes.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS, collection } from '../db/mongo.js';
import { ApiError } from '../http/errors.js';
import { asyncHandler, requireObjectId, validateBody } from '../middleware/validate.js';
import type { DesignDocumentInput } from '../schemas/design.js';
import { wireId } from '../util/id.js';

/**
 * Is `value` a plausible 24-hex Mongo id?
 *
 * `ObjectId.isValid` in this driver build is typed as taking the id plus a
 * length, so the shape is checked directly instead: the route param is
 * attacker-controlled, and feeding a string straight to `new ObjectId(...)`
 * throws a driver error that the error handler would report as a 500 rather
 * than the 400 it obviously is.
 */
function isObjectIdHex(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

/** How many snapshots survive per project before the oldest is dropped. */
export const MAX_VERSIONS_PER_PROJECT = 30;
/** How many entries the recent-files list keeps in total. */
export const MAX_RECENT_FILES = 20;

export interface DesignVersionRecord {
  _id: ObjectId;
  projectId: string;
  /** The project's `version` counter AT the time of this snapshot. */
  projectVersion: number;
  /** Why this snapshot exists - automatic saves dominate, manual is a checkpoint. */
  kind: 'auto' | 'manual' | 'restore';
  /** Compact fields for the list view, so browsing history stays cheap. */
  summary: {
    objectCount: number;
    colorCount: number;
    width: number;
    height: number;
    hoopId: string | null;
  };
  design: DesignDocumentInput;
  createdAt: Date;
}

export interface RecentFileRecord {
  /** The project id doubles as the key: opening the same design twice
   *  updates one row rather than burying the latest open under older ones. */
  _id: string;
  name: string;
  summary: DesignVersionRecord['summary'];
  openedAt: Date;
}

const CreateVersionSchema = z
  .object({
    /** Client-side checkpoints are always `manual`. A checkpoint is by
     *  definition the server's own copy: accepting a design here would let two
     *  people checkpoint the same project with their own interleaved work. */
    kind: z.literal('manual').default('manual'),
  })
  // Strict, so a design smuggled into the body is a 400 rather than a silently
  // ignored field the caller believed was saved.
  .strict();

export function summaryOf(design: DesignDocumentInput): DesignVersionRecord['summary'] {
  const colors = new Set(design.objects.map((o) => o.colorIndex)).size;
  return {
    objectCount: design.objects.length,
    colorCount: colors,
    width: design.width,
    height: design.height,
    hoopId: design.hoopId,
  };
}

/** Wire form of a snapshot: everything, including the design itself. */
function toDto(record: DesignVersionRecord) {
  const { _id, ...rest } = record;
  return { id: wireId(_id), ...rest, createdAt: record.createdAt.toISOString() };
}

/**
 * Record a snapshot of a project's design.
 *
 * Exported because the project-save route calls it too: history only means
 * anything if ordinary saves are covered, and asking the user to press a
 * second button before every edit would mean they never press it.
 */
export async function recordVersion(
  projectId: string,
  projectVersion: number,
  design: DesignDocumentInput,
  kind: DesignVersionRecord['kind'],
): Promise<void> {
  const versions = collection<DesignVersionRecord>(COLLECTIONS.designVersions);

  await versions.insertOne({
    _id: new ObjectId(),
    projectId,
    projectVersion,
    kind,
    summary: summaryOf(design),
    design,
    createdAt: new Date(),
  });

  // Drop the oldest beyond the cap. Sorted by creation, so the survivors are
  // the most recent - a designer who wants the very first version back is
  // better served by an export than by 30 unbounded snapshots.
  const surplus = await versions
    .find({ projectId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(MAX_VERSIONS_PER_PROJECT)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  if (surplus.length > 0) {
    await versions.deleteMany({ _id: { $in: surplus.map((s) => s._id) } });
  }
}

/** Note that a project was just opened, refreshing its place in the list. */
export async function recordRecent(
  projectId: string,
  name: string,
  design: DesignDocumentInput,
): Promise<void> {
  const recents = collection<RecentFileRecord>(COLLECTIONS.recentFiles);

  await recents.updateOne(
    { _id: projectId },
    { $set: { name, summary: summaryOf(design), openedAt: new Date() } },
    { upsert: true },
  );

  // A hard cap, not a rolling one: without it the collection grows forever
  // on a machine nobody restarts.
  const surplus = await recents
    .find({})
    .sort({ openedAt: -1 })
    .skip(MAX_RECENT_FILES)
    .project<{ _id: string }>({ _id: 1 })
    .toArray();

  if (surplus.length > 0) {
    await recents.deleteMany({ _id: { $in: surplus.map((s) => s._id) } });
  }
}

// ---------------------------------------------------------------------------
// Version history routes
// ---------------------------------------------------------------------------

export const versionsRouter: Router = Router({ mergeParams: true });

/** List the snapshots for a project, newest first, without their designs. */
versionsRouter.get(
  '/',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const projectId = new ObjectId(req.params['id']!);
    const versions = collection<DesignVersionRecord>(COLLECTIONS.designVersions);

    const [items, total] = await Promise.all([
      versions
        .find({ projectId: projectId.toHexString() })
        .sort({ createdAt: -1, _id: -1 })
        .project<Omit<DesignVersionRecord, 'design'>>({
          _id: 1,
          projectId: 1,
          projectVersion: 1,
          kind: 1,
          summary: 1,
          createdAt: 1,
        })
        .toArray(),
      versions.countDocuments({ projectId: projectId.toHexString() }),
    ]);

    res.json({
      items: items.map((r) => {
        const { _id, ...rest } = r;
        return { id: wireId(_id), ...rest, createdAt: r.createdAt.toISOString() };
      }),
      total,
    });
  }),
);

/** Read one snapshot in full - this is what restoring loads. */
versionsRouter.get(
  '/:versionId',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const projectId = new ObjectId(req.params['id']!).toHexString();
    const versionId = req.params['versionId'];

    if (!isObjectIdHex(versionId)) throw ApiError.badRequest('INVALID_ID', 'Malformed version id');

    const record = await collection<DesignVersionRecord>(COLLECTIONS.designVersions).findOne({
      _id: new ObjectId(versionId),
      projectId,
    });
    if (!record) throw ApiError.notFound('Version not found');
    res.json(toDto(record));
  }),
);

/** Snapshot the project's current stored design as a named checkpoint. */
versionsRouter.post(
  '/',
  requireObjectId(),
  validateBody(CreateVersionSchema),
  asyncHandler(async (req, res) => {
    const id = new ObjectId(req.params['id']!);

    const project = await collection<{
      _id: ObjectId;
      name: string;
      design: DesignDocumentInput;
      version: number;
    }>(COLLECTIONS.projects).findOne({ _id: id });
    if (!project) throw ApiError.notFound('Project not found');

    await recordVersion(id.toHexString(), project.version, project.design, 'manual');

    const created = await collection<DesignVersionRecord>(COLLECTIONS.designVersions)
      .find({ projectId: id.toHexString() })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();

    const first = created[0];
    if (!first) throw ApiError.notFound('Version could not be created');
    res.status(201).json(toDto(first));
  }),
);

/**
 * Restore a snapshot over the project.
 *
 * The restore itself is itself snapshotted first, so pressing Restore on the
 * wrong entry is undoable rather than the last word on the document. That
 * ordering is the whole safety property: nothing here is destructive
 * without leaving a way back.
 */
versionsRouter.post(
  '/:versionId/restore',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const id = new ObjectId(req.params['id']!);
    const versionId = req.params['versionId'];
    if (!isObjectIdHex(versionId)) throw ApiError.badRequest('INVALID_ID', 'Malformed version id');

    const projects = collection<{
      _id: ObjectId;
      name: string;
      design: DesignDocumentInput;
      version: number;
      summary: unknown;
      updatedAt: Date;
    }>(COLLECTIONS.projects);
    const versions = collection<DesignVersionRecord>(COLLECTIONS.designVersions);

    const project = await projects.findOne({ _id: id });
    if (!project) throw ApiError.notFound('Project not found');

    const snapshot = await versions.findOne({
      _id: new ObjectId(versionId),
      projectId: id.toHexString(),
    });
    if (!snapshot) throw ApiError.notFound('Version not found');

    // Checkpoint what is about to be replaced, before replacing it.
    await recordVersion(id.toHexString(), project.version, project.design, 'restore');

    const now = new Date();
    const updated = await projects.findOneAndUpdate(
      { _id: id },
      {
        $set: { design: snapshot.design, summary: summaryOf(snapshot.design), updatedAt: now },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw ApiError.notFound('Project not found');

    const { _id, ...rest } = updated;
    res.json({ id: wireId(_id), ...rest });
  }),
);

/** Forget a single snapshot - how a user clears out a bad checkpoint. */
versionsRouter.delete(
  '/:versionId',
  requireObjectId(),
  asyncHandler(async (req, res) => {
    const projectId = new ObjectId(req.params['id']!).toHexString();
    const versionId = req.params['versionId'];
    if (!isObjectIdHex(versionId)) throw ApiError.badRequest('INVALID_ID', 'Malformed version id');

    const result = await collection(COLLECTIONS.designVersions).deleteOne({
      _id: new ObjectId(versionId),
      projectId,
    });
    if (result.deletedCount === 0) throw ApiError.notFound('Version not found');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// Recent files
// ---------------------------------------------------------------------------

export const recentRouter: Router = Router();

recentRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await collection<RecentFileRecord>(COLLECTIONS.recentFiles)
      .find({})
      .sort({ openedAt: -1 })
      .limit(MAX_RECENT_FILES)
      .toArray();

    res.json({
      items: items.map((r) => ({
        id: r._id,
        name: r.name,
        summary: r.summary,
        openedAt: r.openedAt.toISOString(),
      })),
      total: items.length,
    });
  }),
);

/**
 * Remove one entry, or the whole list when no id is given.
 *
 * Recent files are a convenience, so a user must be able to clear them -
 * a list that cannot be emptied becomes a small permanent record of what
 * someone was working on.
 */
recentRouter.delete(
  '/:projectId?',
  asyncHandler(async (req, res) => {
    const projectId = req.params['projectId'];
    const recents = collection<RecentFileRecord>(COLLECTIONS.recentFiles);

    if (projectId) {
      const result = await recents.deleteOne({ _id: projectId });
      if (result.deletedCount === 0) throw ApiError.notFound('Recent entry not found');
      res.status(204).end();
      return;
    }

    await recents.deleteMany({});
    res.status(204).end();
  }),
);
