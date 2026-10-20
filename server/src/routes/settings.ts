/**
 * Application settings.
 *
 * A single document keyed by `key`, holding preferences the user expects to
 * survive a restart (units, last hoop, autosave interval, recent tool
 * settings). Stored in MongoDB rather than `localStorage` so the browser
 * clearing site data cannot silently wipe them.
 */

import { Router } from 'express';
import { z } from 'zod';
import { COLLECTIONS, collection } from '../db/mongo.js';
import { ApiError } from '../http/errors.js';
import { asyncHandler, body, validateBody } from '../middleware/validate.js';

export interface SettingsRecord {
  _id: string;
  key: 'application';
  value: z.infer<typeof SettingsValueSchema>;
  updatedAt: Date;
}

export const SettingsValueSchema = z.object({
  units: z.enum(['mm', 'cm', 'in']).default('mm'),
  defaultHoopId: z.string().max(64).nullable().default(null),
  defaultStitchType: z
    .enum(['satin', 'tatami', 'run', 'bean', 'motif', 'contour', 'spiral'])
    .default('tatami'),
  autosaveIntervalMs: z.number().int().min(5_000).max(600_000).default(30_000),
  /**
   * How many undo steps the editor keeps.
   *
   * 60 is the default because that is where a large design's history stopped
   * being worth its memory; it is a preference rather than a constant so a
   * careful job on a small design can be walked back much further than a
   * quick one has to be.
   */
  undoDepth: z.number().int().min(5).max(500).default(60),
  showGrid: z.boolean().default(true),
  showRulers: z.boolean().default(true),
  snapToGrid: z.boolean().default(false),
  /** Snap drawing and node drags to nearby object nodes, edges and centres. */
  snapToObjects: z.boolean().default(false),
  gridSize: z.number().finite().min(0.5).max(50).default(5),
  /**
   * Major grid spacing, independent of the minor spacing.
   *
   * The canvas clamps it to at least `gridSize`, so the two can never cross;
   * the bound here stops a nonsense value reaching the renderer at all.
   */
  gridMajorSize: z.number().finite().min(0.5).max(250).default(25),
  previewUnderlay: z.boolean().default(true),
  stitchSimulationSpeed: z.number().finite().min(0.25).max(8).default(1),
});

const SettingsPatchSchema = SettingsValueSchema.partial();

/** Sensible first-run values, also used when the document is missing. */
const DEFAULTS: z.infer<typeof SettingsValueSchema> = SettingsValueSchema.parse({});

export const settingsRouter: Router = Router();

function toDto(record: SettingsRecord) {
  return { ...record.value, updatedAt: record.updatedAt.toISOString() };
}

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const record = await collection<SettingsRecord>(COLLECTIONS.applicationSettings).findOne({
      _id: 'application',
    });
    if (!record) {
      // First run: return the defaults without persisting them, so simply
      // opening the settings panel does not create state.
      res.json({ ...DEFAULTS, updatedAt: null });
      return;
    }
    res.json(toDto(record));
  }),
);

settingsRouter.put(
  '/',
  validateBody(SettingsPatchSchema),
  asyncHandler(async (req, res) => {
    const patch = body<typeof SettingsPatchSchema>(req);
    const settings = collection<SettingsRecord>(COLLECTIONS.applicationSettings);

    const existing = await settings.findOne({ _id: 'application' });
    // Merge over the stored value (not over the defaults) so a partial patch
    // cannot reset fields the user already customized.
    const merged = { ...(existing?.value ?? DEFAULTS), ...patch };
    const parsed = SettingsValueSchema.parse(merged);

    const now = new Date();
    const updated = await settings.findOneAndUpdate(
      { _id: 'application' },
      { $set: { key: 'application', value: parsed, updatedAt: now } },
      { returnDocument: 'after', upsert: true },
    );

    if (!updated) throw ApiError.notFound('Settings could not be saved');
    res.json(toDto(updated));
  }),
);
