/**
 * Zod schemas for everything crossing the HTTP boundary.
 *
 * The engine's TypeScript types describe what the code expects; these
 * describe what we are willing to *accept* over the network. They are
 * deliberately separate: a type disappears at runtime, so it cannot be used
 * to reject a malformed request, and trusting request bodies as typed is the
 * classic way to end up with `NaN` coordinates in a stitch file.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** A closed ring; the first point is not repeated at the end. */
export const RingSchema = z.array(PointSchema).min(3, 'A ring needs at least 3 points');

export const CompoundPathSchema = z.object({
  rings: z.array(RingSchema).max(64, 'A shape may have at most 64 rings'),
});

export const BoundsSchema = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
});

// ---------------------------------------------------------------------------
// Stitch parameters
// ---------------------------------------------------------------------------

export const StitchTypeSchema = z.enum([
  'satin',
  'tatami',
  'run',
  'bean',
  'motif',
  'contour',
  'spiral',
  'sequin',
  'beading',
  'chenille',
  'schiffli',
]);

export const FillPatternSchema = z.enum([
  'tatami',
  'motif',
  'contour',
  'spiral',
  'programmedSplit',
  'accordion',
  'florentine',
  'liquid',
  'maze',
  'string',
  'laydown',
  'stipple',
  'cross',
  'shading',
  'hand',
  'jagged',
  'warp',
  'flexiSplit',
]);

export const UnderlayTypeSchema = z.enum(['none', 'centerRun', 'edgeRun', 'zigzag', 'tatami']);
export const UnderlaySettingsSchema = z.object({
  type: UnderlayTypeSchema,
  spacing: z.number().finite().min(0.1).max(20),
  offset: z.number().finite().min(0).max(20),
  inset: z.number().finite().min(0).max(20),
});

export const TieSettingsSchema = z.object({
  enabled: z.boolean(),
  length: z.number().finite().min(0.1).max(5),
  count: z.number().int().min(1).max(10),
});

export const FoamSettingsSchema = z.object({
  enabled: z.boolean(),
  thicknessMm: z.number().finite().min(0).max(10),
  tackUnderlay: z.boolean(),
});

/**
 * The motif a fill repeats or a carve presses in.
 *
 * Either a built-in named by `id`, or a shape of the design's own under
 * `points`. Both are carried because they do different jobs: the id names a
 * library entry so renaming or re-drawing it updates every design following
 * it, while the points keep a design correct even once that entry is gone.
 * The engine prefers the points, so a saved design never depends on the
 * library still holding what it used.
 */
export const MotifChoiceSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  points: z.array(PointSchema).min(3).max(400).optional(),
});

/** How a motif is placed: gridded fill, along an outline, one stamp, or across a column. */
export const MotifModeSchema = z.enum(['fill', 'run', 'single', 'column']);

/**
 * Size / rotation gradient across a motif layout: both pairs lerp from the
 * first motif to the last. Optional on the parameters, like the mode.
 */
export const MotifGradientSchema = z.object({
  scaleFrom: z.number().finite().min(0.05).max(20),
  scaleTo: z.number().finite().min(0.05).max(20),
  angleFrom: z.number().finite().min(-360).max(360),
  angleTo: z.number().finite().min(-360).max(360),
});

/**
 * User-defined split for the programmed split fill: block length, break and
 * stagger as a fraction of a block. Bounds mirror what the engine will lay.
 */
export const CustomSplitSchema = z.object({
  segmentLength: z.number().finite().min(0.5).max(50),
  gap: z.number().finite().min(0).max(10),
  stagger: z.number().finite().min(0).max(1),
});

export const CarveSettingsSchema = z.object({
  enabled: z.boolean(),
  pattern: z.enum(['diamond', 'circle', 'star', 'cross', 'hexagon']),
  /** A stamp shape of the design's own, when one was picked from the library. */
  motif: MotifChoiceSchema.optional(),
  spacing: z.number().finite().min(1).max(50),
  scale: z.number().finite().min(0.1).max(50),
  rotation: z.number().finite().min(-360).max(360),
  outline: z.boolean(),
});

/**
 * Appliqué passes.
 *
 * The bounds mirror the engine's `APPLIQUE_LIMITS` on purpose: a width the
 * engine would refuse must be refused at the door, or the project saves and
 * then fails to compile. Optional on the parameters so designs written before
 * appliqué existed still load as ordinary objects.
 */
export const AppliqueSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['full', 'partial']),
  placement: z.boolean(),
  tack: z.enum(['none', 'run', 'zigzag', 'satin']),
  tackWidth: z.number().finite().min(0.5).max(20),
  tackSpacing: z.number().finite().min(0.2).max(6),
  finish: z.enum(['none', 'run', 'zigzag', 'satin']),
  finishWidth: z.number().finite().min(0.5).max(20),
  finishSpacing: z.number().finite().min(0.2).max(6),
  finishOffset: z.number().finite().min(-10).max(10),
  fill: z.boolean(),
  start: z.number().finite().min(0).max(1),
  length: z.number().finite().min(0.001).max(1),
});

/**
 * Photo-stitch cell settings.
 *
 * The cell squares live in the object's path; this only says how each square
 * is sewn. Bounds mirror the engine so a bad density cannot be saved and then
 * fail at compile time.
 */
export const PhotoSettingsSchema = z.object({
  enabled: z.boolean(),
  style: z.enum(['satin', 'run', 'cross']),
  spacing: z.number().finite().min(0.2).max(2),
});

export const StitchParametersSchema = z
  .object({
    stitchType: StitchTypeSchema,
    angle: z.number().finite().min(-360).max(360),
    spacing: z.number().finite().min(0.05).max(10),
    maxStitchLength: z.number().finite().min(0.5).max(12.1),
    minStitchLength: z.number().finite().min(0).max(5),
    pullCompensation: z.number().finite().min(-5).max(5),
    // Optional and nullable: absent means both sides of a satin column use the
    // uniform value above, which is what every earlier design means.
    separatePullCompensation: z
      .object({
        left: z.number().finite().min(-5).max(5),
        right: z.number().finite().min(-5).max(5),
      })
      .nullable()
      .optional(),
    fillPattern: FillPatternSchema,
    underlay: UnderlaySettingsSchema,
    tieIn: TieSettingsSchema,
    tieOff: TieSettingsSchema,
    // Optional so a project saved before 3D foam existed still loads: absent
    // means "flat", which is exactly how it always behaved.
    foam: FoamSettingsSchema.optional(),
    // Optional for the same reason as foam: absent means "plain fill".
    carve: CarveSettingsSchema.optional(),
    // Optional for the same reason again: absent means the built-in the fill
    // pattern picks, which is what every earlier design produced.
    motif: MotifChoiceSchema.optional(),
    // How that motif is laid, and how its size/rotation change across the
    // layout. Absent means a gridded fill at one uniform size - the only
    // behaviour that existed before.
    motifMode: MotifModeSchema.nullable().optional(),
    motifGradient: MotifGradientSchema.nullable().optional(),
    // A user-defined split for the programmed split fill. Absent means the
    // built-in 12 mm / 1.5 mm / half-block numbers.
    customSplit: CustomSplitSchema.nullable().optional(),
    // Optional: absent means an ordinary object. Appliqué is a set of passes
    // around the outline, not a different geometry format.
    applique: AppliqueSettingsSchema.optional(),
    // Optional: absent means the rings are a region to fill. When present the
    // rings are individual photo cells.
    photo: PhotoSettingsSchema.optional(),
    // Optional: absent means an ordinary fill or line. Present with
    // `enabled` sews the rings as a one-colour redwork line instead.
    redwork: z
      .object({
        enabled: z.boolean(),
        style: z.enum(['single', 'triple', 'backstitch', 'stem']),
        widthMm: z.number().finite().min(0.2).max(6),
        stitchMm: z.number().finite().min(0.5).max(8),
      })
      .optional(),
  })
  // A single stitch can never exceed the machine's step limit; accepting a
  // larger value here would only defer the failure to export time.
  .refine((p) => p.maxStitchLength <= 12.1, {
    message: 'maxStitchLength cannot exceed 12.1 mm (DST single-step limit)',
    path: ['maxStitchLength'],
  })
  .refine((p) => p.minStitchLength <= p.maxStitchLength, {
    message: 'minStitchLength must not exceed maxStitchLength',
    path: ['minStitchLength'],
  });

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export const ObjectTypeSchema = z.enum([
  'column',
  'fill',
  'run',
  'bean',
  'lettering',
  'motif',
  'contour',
  'spiral',
]);

/**
 * Placement only - flip, scale and rotate are baked into the path by the
 * editor, so they are never stored and never accepted back.
 */
export const TransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * Lettering specification.
 *
 * Lettering geometry is generated from this spec every time the object
 * compiles, so the text and its layout must survive a save/load round trip
 * exactly: losing them would silently turn saved lettering back into the
 * default "TEXT". The advanced layouts - a path, a monogram, a dropped
 * letter, a sewing order - ride along as optional fields so designs saved
 * before they existed still parse.
 */
export const LetteringPathSchema = z.object({
  points: z.array(PointSchema).min(1).max(10_000),
  upright: z.boolean(),
  offsetMm: z.number().finite().min(-200).max(200),
  align: z.enum(['start', 'center']),
});

export const MonogramSpecSchema = z.object({
  enabled: z.boolean(),
  frame: z.enum(['none', 'circle', 'oval', 'diamond']),
  mirrorSides: z.boolean(),
  frameWidth: z.number().finite().min(0.2).max(10),
});

export const LetteringDropSchema = z.object({
  enabled: z.boolean(),
  index: z.number().int().min(0).max(64),
  scale: z.number().finite().min(0.5).max(5),
});

export const LetteringOrderSchema = z.enum(['default', 'reverse', 'outsideIn', 'insideOut']);

export const LetteringSpecSchema = z.object({
  text: z.string().max(500),
  height: z.number().finite().min(1).max(300),
  spacing: z.number().finite().min(-20).max(100),
  slant: z.number().finite().min(-60).max(60),
  rotation: z.number().finite().min(-360).max(360),
  width: z.number().finite().min(0.2).max(20),
  font: z.enum(['studio', 'rounded', 'block', 'script', 'serif', 'mono']).optional(),
  stretch: z.number().finite().min(0.25).max(4).optional(),
  mirror: z.object({ x: z.boolean(), y: z.boolean() }).nullable().optional(),
  onPath: LetteringPathSchema.nullable().optional(),
  monogram: MonogramSpecSchema.nullable().optional(),
  drop: LetteringDropSchema.nullable().optional(),
  order: LetteringOrderSchema.optional(),
});

export const EmbroideryObjectSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(120).default(''),
  type: ObjectTypeSchema,
  path: CompoundPathSchema,
  transform: TransformSchema,
  colorIndex: z.number().int().min(0).max(999),
  params: StitchParametersSchema,
  entryExit: z.object({
    entry: PointSchema.nullable(),
    exit: PointSchema.nullable(),
  }),
  order: z.number().int().min(0).max(100_000),
  locked: z.boolean(),
  hidden: z.boolean(),
  groupId: z.string().max(64).nullable(),
  machine: z.number().int().min(1).max(64).default(1),
  warnings: z.array(z.string().max(300)).max(100),
  /**
   * Null for every non-lettering object. Defaulting keeps designs written
   * before the field existed loadable.
   */
  lettering: LetteringSpecSchema.nullable().default(null),
});

// ---------------------------------------------------------------------------
// Threads, hoops, palette
// ---------------------------------------------------------------------------

export const ThreadColorSchema = z.object({
  id: z.string().min(1).max(64),
  code: z.string().max(40).default(''),
  name: z.string().max(80).default(''),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'hex must be #RRGGBB'),
  brand: z.string().max(60).optional(),
});

export const HoopSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  width: z.number().finite().min(20).max(1000),
  height: z.number().finite().min(20).max(1000),
  shape: z.enum(['rect', 'round', 'oval']),
  safeMargin: z.number().finite().min(0).max(50),
  /** Curved cap frame. Optional; absent means a flat frame. */
  cap: z.boolean().optional(),
});

/**
 * Hoop preset payload.
 *
 * Presets all share one wire shape - `{ name, data }` - so a single CRUD
 * factory serves hoops, palettes and digitizing presets. `data` therefore
 * carries only the distinguishing fields: `id` is assigned by the server and
 * `name` lives in the envelope, so neither is repeated inside the payload.
 */
export const HoopSpecSchema = HoopSchema.omit({ id: true, name: true });

export const HoopPresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  data: HoopSpecSchema,
});

export const HoopPresetUpdateSchema = HoopPresetCreateSchema.partial();

/**
 * Motif library payload: one shape a motif fill repeats or a carve presses in.
 *
 * `points` is a closed ring in millimetres, recentered on its own centre and
 * sized so its longest side is 1 when it is stored — the same convention the
 * built-ins use, which is what lets `scale` mean one thing across the whole
 * picker. The limits mirror the engine's, so a shape that cannot be sewn is
 * refused here rather than accepted and then failing on export.
 */
export const MotifShapeSchema = z
  .array(PointSchema)
  .min(3, 'A motif needs at least 3 points')
  .max(400, 'A motif may hold at most 400 points');

export const MotifPresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  data: z.object({
    points: MotifShapeSchema,
    /** Free-text note shown with the shape in the picker. */
    note: z.string().trim().max(200).optional(),
  }),
});

export const MotifPresetUpdateSchema = MotifPresetCreateSchema.partial();

// ---------------------------------------------------------------------------
// Design document
// ---------------------------------------------------------------------------

export const UnitSchema = z.enum(['mm', 'cm', 'in']);

/**
 * The whole editable design.
 *
 * `version` is an optimistic-concurrency token: the client sends the version
 * it loaded, and a mismatch is rejected rather than silently overwriting a
 * newer save.
 */
export const DesignDocumentSchema = z.object({
  units: UnitSchema.default('mm'),
  width: z.number().finite().min(1).max(5000),
  height: z.number().finite().min(1).max(5000),
  hoopId: z.string().max(64).nullable().default(null),
  objects: z.array(EmbroideryObjectSchema).max(5000, 'Too many objects in one design'),
  threadPalette: z.array(ThreadColorSchema).max(1000),
  capWrap: z
    .object({
      enabled: z.boolean(),
      radiusMm: z.number().finite().min(20).max(400),
      compensate: z.boolean(),
    })
    .default({ enabled: false, radiusMm: 90, compensate: true }),
});

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  design: DesignDocumentSchema,
});

export const ProjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  design: DesignDocumentSchema.optional(),
  /** Version the client last loaded; used for conflict detection. */
  expectedVersion: z.number().int().min(0).optional(),
});

export const PaletteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  colors: z.array(ThreadColorSchema).min(1).max(1000),
});

export const HoopPresetSchema = HoopPresetCreateSchema;

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;
export type DesignDocumentInput = z.infer<typeof DesignDocumentSchema>;
export type EmbroideryObjectInput = z.infer<typeof EmbroideryObjectSchema>;
export type ThreadColorInput = z.infer<typeof ThreadColorSchema>;
