/**
 * Generic CRUD for the small reference collections: thread palettes, hoop
 * presets and digitizing presets.
 *
 * They share a shape (name + payload, list/create/update/delete) so one
 * factory covers all three. Hand-writing three near-identical routers would
 * be three places to forget a validation check.
 */

import { Router, type Request, type RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { ZodTypeAny } from 'zod';
import { COLLECTIONS, collection } from '../db/mongo.js';
import { ApiError } from '../http/errors.js';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { isObjectIdHex, wireId } from '../util/id.js';

/**
 * Resolve a preset id from the wire into whatever the stored document uses.
 *
 * Seeded presets are addressed by their readable key (`hoop-100x100`);
 * user-created ones are ObjectIds. Sending a raw string that looks like
 * ObjectIds would silently find nothing, and sending an object would be an
 * operator-injection vector - so both shapes are handled explicitly and
 * anything else is rejected.
 */
export function resolvePresetId(raw: string): ObjectId | string {
  if (isObjectIdHex(raw)) return new ObjectId(raw);
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw)) return raw;
  throw ApiError.badRequest('INVALID_ID', 'Preset id must be an object id or a simple key');
}

/** Route guard matching `resolvePresetId`. */
export const requirePresetId: RequestHandler = (req: Request, _res, next) => {
  const value = req.params['id'];
  if (!value) {
    next(ApiError.badRequest('INVALID_ID', 'Missing preset id'));
    return;
  }
  try {
    resolvePresetId(value);
    next();
  } catch (err) {
    next(err);
  }
};

export interface PresetRecord<T> {
  /**
   * Seeded presets use readable fixed keys (`hoop-100x100`); user-created
   * ones use ObjectIds. Both are legal, which is why `wireId()` exists.
   */
  _id: ObjectId | string;
  name: string;
  data: T;
  /** Seed data cannot be deleted, only restored - see `scripts/seed.ts`. */
  builtin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PresetRouterOptions {
  collectionName: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
}

function toDto<T>(record: PresetRecord<T>) {
  const { _id, ...rest } = record;
  return { id: wireId(_id), ...rest };
}

export function createPresetRouter(options: PresetRouterOptions): Router {
  const router = Router();

  const list: RequestHandler = asyncHandler(async (_req, res) => {
    const items = await collection<PresetRecord<unknown>>(options.collectionName)
      .find()
      .sort({ builtin: -1, name: 1 })
      .toArray();
    res.json({ items: items.map(toDto), total: items.length });
  });

  const create: RequestHandler = asyncHandler(async (req, res) => {
    const input = (req as unknown as { validated: { name: string; data: unknown } }).validated;
    const now = new Date();
    const record: PresetRecord<unknown> = {
      _id: new ObjectId(),
      name: input.name,
      data: input.data,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    await collection<PresetRecord<unknown>>(options.collectionName).insertOne(record);
    res.status(201).json(toDto(record));
  });

  const read: RequestHandler = asyncHandler(async (req, res) => {
    const record = await collection<PresetRecord<unknown>>(options.collectionName).findOne({
      _id: resolvePresetId(req.params['id']!),
    });
    if (!record) throw ApiError.notFound('Preset not found');
    res.json(toDto(record));
  });

  const update: RequestHandler = asyncHandler(async (req, res) => {
    const input = (req as unknown as { validated: { name?: string; data?: unknown } }).validated;
    const updated = await collection<PresetRecord<unknown>>(
      options.collectionName,
    ).findOneAndUpdate(
      { _id: resolvePresetId(req.params['id']!) },
      {
        $set: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.data !== undefined ? { data: input.data } : {}),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw ApiError.notFound('Preset not found');
    res.json(toDto(updated));
  });

  const remove: RequestHandler = asyncHandler(async (req, res) => {
    const id = resolvePresetId(req.params['id']!);
    const presets = collection<PresetRecord<unknown>>(options.collectionName);

    const record = await presets.findOne({ _id: id });
    if (!record) throw ApiError.notFound('Preset not found');
    if (record.builtin) {
      throw ApiError.conflict('Built-in presets cannot be deleted');
    }

    await presets.deleteOne({ _id: id });
    res.status(204).end();
  });

  router.get('/', list);
  router.post('/', validateBody(options.createSchema), create);
  router.get('/:id', requirePresetId, read);
  router.put('/:id', requirePresetId, validateBody(options.updateSchema), update);
  router.delete('/:id', requirePresetId, remove);

  return router;
}

export const PRESET_COLLECTIONS = {
  palettes: COLLECTIONS.threadPalettes,
  hoops: COLLECTIONS.hoopPresets,
  presets: COLLECTIONS.digitizingPresets,
  motifs: COLLECTIONS.motifPresets,
} as const;
