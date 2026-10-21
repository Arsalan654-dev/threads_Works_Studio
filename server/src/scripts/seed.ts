/**
 * Seed the database with the built-in reference data.
 *
 * Safe to run repeatedly: every record is keyed by a fixed `_id`, so a second
 * run updates in place instead of duplicating. `builtin: true` marks them so
 * the API refuses to delete them - a user can edit a copy, but restoring the
 * defaults is always possible by re-running this script.
 *
 * Colour values are generic stock thread colours, not any manufacturer's
 * catalogue: reproducing a brand's chart would be copying someone else's
 * data, and the app does not need it.
 */

import { pathToFileURL } from 'node:url';
import { builtinMotifs, normalizeMotif } from '@threadworks/engine';
import { connectDb, disconnectDb, ensureIndexes, COLLECTIONS, collection } from '../db/mongo.js';

interface SeedDoc {
  _id: string;
  name: string;
  data: unknown;
  builtin: true;
}

/** Hoop sizes in millimeters - common multi-needle and single-needle frames. */
const HOOPS: SeedDoc[] = [
  {
    _id: 'hoop-100x100',
    name: '100 x 100 mm',
    data: { width: 100, height: 100, shape: 'rect', safeMargin: 4 },
    builtin: true,
  },
  {
    _id: 'hoop-126x110',
    name: '126 x 110 mm',
    data: { width: 126, height: 110, shape: 'rect', safeMargin: 4 },
    builtin: true,
  },
  {
    _id: 'hoop-180x130',
    name: '180 x 130 mm',
    data: { width: 180, height: 130, shape: 'rect', safeMargin: 5 },
    builtin: true,
  },
  {
    _id: 'hoop-200x200',
    name: '200 x 200 mm',
    data: { width: 200, height: 200, shape: 'rect', safeMargin: 5 },
    builtin: true,
  },
  {
    _id: 'hoop-300x200',
    name: '300 x 200 mm',
    data: { width: 300, height: 200, shape: 'rect', safeMargin: 6 },
    builtin: true,
  },
  {
    _id: 'hoop-400x200',
    name: '400 x 200 mm',
    data: { width: 400, height: 200, shape: 'rect', safeMargin: 6 },
    builtin: true,
  },
  {
    _id: 'hoop-round-150',
    name: 'Round 150 mm',
    data: { width: 150, height: 150, shape: 'round', safeMargin: 5 },
    builtin: true,
  },
  {
    _id: 'hoop-cap-80x180',
    name: 'Cap frame 80 x 180 mm',
    data: { width: 80, height: 180, shape: 'rect', safeMargin: 5, cap: true },
    builtin: true,
  },
];

/**
 * A small, deliberately generic palette.
 *
 * Rather than shipping a manufacturer's colour chart, this is a basic
 * web-safe-style selection covering the hues people actually digitize with.
 */
const PALETTE_COLORS = [
  ['000000', 'Black'],
  ['FFFFFF', 'White'],
  ['C8102E', 'Red'],
  ['ED1C24', 'Bright Red'],
  ['F26522', 'Orange'],
  ['FFD100', 'Yellow'],
  ['00843D', 'Green'],
  ['007A33', 'Dark Green'],
  ['003DA5', 'Blue'],
  ['00AEEF', 'Sky Blue'],
  ['6F2C91', 'Purple'],
  ['E4007C', 'Magenta'],
  ['7B5B3E', 'Brown'],
  ['8B6F4E', 'Tan'],
  ['999999', 'Grey'],
  ['C0C0C0', 'Silver'],
  ['F7C6C7', 'Pink'],
  ['A7F3D0', 'Mint'],
] as const;

const PALETTE: SeedDoc = {
  _id: 'palette-basic',
  name: 'Basic 18',
  builtin: true,
  data: PALETTE_COLORS.map(([hex, name], i) => ({
    id: `basic-${i}`,
    code: String(i + 1).padStart(4, '0'),
    name,
    hex: `#${hex}`,
    brand: 'ThreadWorks',
  })),
};

/**
 * Default digitizing presets.
 *
 * The values come from ordinary embroidery practice: 0.4 mm tatami is a
 * standard fill density, satin columns want a 0.4 mm satin spacing, and
 * underlay roughly doubles the row spacing of the top stitch.
 */
function params(
  stitchType:
    | 'satin'
    | 'tatami'
    | 'run'
    | 'bean'
    | 'motif'
    | 'contour'
    | 'spiral'
    | 'sequin'
    | 'beading'
    | 'chenille'
    | 'schiffli',
  spacing: number,
  underlayType: 'none' | 'centerRun' | 'edgeRun' | 'zigzag' | 'tatami',
  underlaySpacing: number,
) {
  return {
    stitchType,
    angle: 0,
    spacing,
    maxStitchLength: 12.1,
    minStitchLength: 0.3,
    pullCompensation: stitchType === 'satin' ? 0.4 : 0.2,
    fillPattern:
      stitchType === 'motif'
        ? 'motif'
        : stitchType === 'contour'
          ? 'contour'
          : stitchType === 'spiral'
            ? 'spiral'
            : 'tatami',
    underlay: {
      type: underlayType,
      spacing: underlaySpacing,
      offset: 1,
      inset: 1,
    },
    tieIn: { enabled: true, length: 0.4, count: 3 },
    tieOff: { enabled: true, length: 0.4, count: 3 },
  };
}

const PRESETS: SeedDoc[] = [
  {
    _id: 'preset-fill-default',
    name: 'Fill - Default',
    data: params('tatami', 0.4, 'edgeRun', 3),
    builtin: true,
  },
  {
    _id: 'preset-fill-dense',
    name: 'Fill - Dense',
    data: params('tatami', 0.3, 'edgeRun', 2.4),
    builtin: true,
  },
  {
    _id: 'preset-fill-light',
    name: 'Fill - Light',
    data: params('tatami', 0.6, 'centerRun', 4),
    builtin: true,
  },
  {
    _id: 'preset-fill-lightfabric',
    name: 'Fill - Light fabric',
    data: params('tatami', 0.45, 'zigzag', 3.6),
    builtin: true,
  },
  {
    _id: 'preset-satin-column',
    name: 'Satin - Column',
    data: params('satin', 0.4, 'centerRun', 3),
    builtin: true,
  },
  {
    _id: 'preset-satin-narrow',
    name: 'Satin - Narrow',
    data: params('satin', 0.35, 'none', 2),
    builtin: true,
  },
  {
    _id: 'preset-run-single',
    name: 'Run - Single',
    data: params('run', 3, 'none', 3),
    builtin: true,
  },
  {
    _id: 'preset-run-bean',
    name: 'Run - Bean / Triple',
    data: params('bean', 3, 'none', 3),
    builtin: true,
  },
  {
    _id: 'preset-contour',
    name: 'Contour',
    data: params('contour', 1.5, 'edgeRun', 4),
    builtin: true,
  },
  { _id: 'preset-spiral', name: 'Spiral', data: params('spiral', 2, 'none', 4), builtin: true },
  { _id: 'preset-motif', name: 'Motif', data: params('motif', 8, 'none', 4), builtin: true },
  {
    _id: 'preset-sequin',
    name: 'Specialty - Sequins (simulated)',
    data: params('sequin', 5, 'none', 4),
    builtin: true,
  },
  {
    _id: 'preset-beading',
    name: 'Specialty - Beading (simulated)',
    data: params('beading', 3, 'none', 4),
    builtin: true,
  },
  {
    _id: 'preset-chenille',
    name: 'Specialty - Chenille pile',
    data: params('chenille', 0.7, 'none', 4),
    builtin: true,
  },
  {
    _id: 'preset-schiffli',
    name: 'Specialty - Schiffli lace',
    data: params('schiffli', 1.5, 'none', 4),
    builtin: true,
  },
];

/**
 * Motif library shapes, generated from the engine's built-ins.
 *
 * They are normalised to a unit box so `scale` in the UI means one thing
 * across the whole picker — a motif drawn by hand and a built-in both measure
 * the same once placed. Generated rather than written out here so the two can
 * never drift apart: a new built-in appears in the seeded library on the next
 * run without this file being touched.
 */
const MOTIFS: SeedDoc[] = builtinMotifs().map((motif) => ({
  _id: `motif-${motif.id}`,
  name: motif.name,
  data: { points: normalizeMotif(motif.points) },
  builtin: true,
}));

async function seed(): Promise<void> {
  const db = await connectDb();
  await ensureIndexes(db);

  const seedInto = async (name: string, docs: SeedDoc[]): Promise<void> => {
    const col = collection<{
      _id: string;
      name: string;
      data: unknown;
      builtin: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>(name);
    const now = new Date();
    let inserted = 0;
    let updated = 0;

    for (const doc of docs) {
      const { _id, ...rest } = doc;
      const result = await col.updateOne(
        { _id },
        { $set: { ...rest, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) inserted++;
      else updated++;
    }
    process.stdout.write(`  ${name}: ${inserted} inserted, ${updated} updated\n`);
  };

  process.stdout.write('Seeding ThreadWorks Studio...\n');
  await seedInto(COLLECTIONS.hoopPresets, HOOPS);
  await seedInto(COLLECTIONS.threadPalettes, [PALETTE]);
  await seedInto(COLLECTIONS.digitizingPresets, PRESETS);
  await seedInto(COLLECTIONS.motifPresets, MOTIFS);
  process.stdout.write('Done.\n');

  await disconnectDb();
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  seed().catch((err: unknown) => {
    process.stderr.write(
      `Seed failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}

export { seed, HOOPS, PALETTE, PRESETS };
