/**
 * Core embroidery domain types.
 *
 * DESIGN MODEL
 * ------------
 * An `EmbroideryObject` is the EDITABLE source of truth: geometry + parameters.
 * A `StitchSequence` is DERIVED from it by the engine, and is what gets
 * simulated on screen and encoded into a machine file.
 *
 * Never treat rendered SVG/canvas output as the machine file.
 */

/** Supported linear units. Millimeters is the internal canonical unit. */
export type Unit = 'mm' | 'cm' | 'in';

/**
 * Machine / needle commands.
 *
 * Deliberately a string-literal union rather than an enum: the whole engine
 * writes these as literals (`'stitch'`, `'jump'`, ...), and TS string enums
 * are nominal, so a bare literal is not assignable to an enum member type.
 * The union keeps literal ergonomics while still closing the set of valid
 * values under `strict`.
 */
export type StitchCommand =
  /** Normal needle penetration - thread is sewn into the fabric. */
  | 'stitch'
  /** Needle up, move without sewing. */
  | 'jump'
  /** Thread trim (cut). */
  | 'trim'
  /** Stop / color change - machine pauses for operator thread swap. */
  | 'colorChange'
  /** End of design. */
  | 'end'
  /** Lock stitch (tie-in / tie-off) - small back-and-forth securing stitch. */
  | 'lock';

/** The sewn penetrations only - everything a machine actually stitches. */
export const SEW_COMMANDS: readonly StitchCommand[] = ['stitch', 'lock'];

/** 2D point in millimeters. */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned bounding box in millimeters. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A closed polygon ring. The first point is NOT repeated at the end.
 * Winding is normalized by the engine before fill operations.
 */
export type Ring = Point[];

/**
 * A compound shape: outer ring first, followed by hole rings.
 * Holes are resolved with the even-odd rule, so nesting works automatically.
 */
export interface CompoundPath {
  rings: Ring[];
}

/** Object types the editor can create. */
export type ObjectType =
  | 'column' // Input A / Input B satin column
  | 'fill' // Complex Fill
  | 'run' // single run outline
  | 'bean' // triple run / bean stitch
  | 'lettering'
  | 'motif'
  | 'contour'
  | 'spiral';

/** High-level stitch strategy for an object. */
export type StitchType = 'satin' | 'tatami' | 'run' | 'bean' | 'motif' | 'contour' | 'spiral';

/** Underlay strategies. */
export type UnderlayType = 'none' | 'centerRun' | 'edgeRun' | 'zigzag' | 'tatami';

export interface UnderlaySettings {
  type: UnderlayType;
  /** Underlay row spacing in mm (zigzag / tatami underlay). */
  spacing: number;
  /** Offset from the object edge in mm (edge run). */
  offset: number;
  /** Additional underlay rows inset from the edge. */
  inset: number;
}

export interface TieSettings {
  enabled: boolean;
  /** Length of each lock stitch in mm. */
  length: number;
  /** Number of lock stitches to place. */
  count: number;
}

/**
 * 3D foam (puff) settings.
 *
 * Foam is laid on the fabric first, then a satin column sews over it and
 * traps it; the excess is torn away by hand afterwards. That changes what the
 * column has to do compared with sewing flat:
 *
 *  - the satin must be dense enough that no foam shows between rows,
 *  - it must pull wider so the thread still meets the fabric past the raised
 *    edge, and
 *  - the normal underlay would push the foam away instead of pinning it, so it
 *    is replaced by a light tack that holds the foam down for the satin.
 */
export interface FoamSettings {
  enabled: boolean;
  /** Foam sheet thickness in mm. Drives the extra pull compensation. */
  thicknessMm: number;
  /** Sew a light tack over the foam before the satin, to hold it in place. */
  tackUnderlay: boolean;
}

export type FillPattern =
  | 'tatami'
  | 'motif'
  | 'contour'
  | 'spiral'
  | 'programmedSplit'
  /** Accordion: pleated zigzag bands. */
  | 'accordion'
  /** Florentine: leaf/herringbone weave of tilted rows. */
  | 'florentine'
  /** Liquid: flowing sine-wave rows. */
  | 'liquid'
  /** Maze: one line wandering with square turns. */
  | 'maze'
  /** String: loosely laid long meandering stitches. */
  | 'string'
  /** Laydown: long parallel laid threads. */
  | 'laydown'
  /** Stipple: a jittered dot texture. */
  | 'stipple'
  /** Cross hatch: two perpendicular passes. */
  | 'cross'
  /** Shading: row density fades from open to dense. */
  | 'shading'
  /** Hand stitch: irregular, hand-sewn look. */
  | 'hand'
  /** Tatami with ragged row ends. */
  | 'jagged'
  /** Tatami whose rows bow outward, as if over a dome. */
  | 'warp'
  /** Split blocks whose length adapts to the shape's width. */
  | 'flexiSplit';

/** Built-in stamp patterns a carve can press into a fill. */
export type CarvePattern = 'diamond' | 'circle' | 'star' | 'cross' | 'hexagon';

/**
 * The motif a fill repeats or a carve presses in.
 *
 * Either a built-in named by `id`, or a shape of the design's own under
 * `points`. Carrying both is deliberate: the id names a library entry so it
 * can be renamed or re-drawn and every design following it updates, while the
 * points keep a design correct even once that entry is gone.
 */
export interface MotifChoice {
  /** Built-in or library id. */
  id?: string;
  /** The shape itself, when the design carries one. */
  points?: Point[];
}

/**
 * Carving stamp — a texture pressed into a fill.
 *
 * This is not a motif fill, which *is* only motifs with no base. A carve
 * starts from a real tatami fill and then removes the stitches that fall
 * inside a repeating stamp, so the shape keeps reading as a solid fill but
 * with a debossed pattern punched through it. The gaps are what you see, so
 * the fill has to be dense enough around them to still hold together.
 */
export interface CarveSettings {
  enabled: boolean;
  /** Which built-in stamp to press in. Ignored when `motif` carries one. */
  pattern: CarvePattern;
  /**
   * A stamp shape of the design's own, when the operator picked one from the
   * motif library rather than a built-in.
   *
   * Carrying the shape rather than only its id is what makes a design that
   * uses a library motif survive the library entry being renamed or removed:
   * what was saved is what sews.
   */
  motif?: MotifChoice;
  /** Distance between stamp centres in mm. Smaller packs them tighter. */
  spacing: number;
  /** Stamp size in mm (its own bounding box across). */
  scale: number;
  /** Rotation of each stamp in degrees. */
  rotation: number;
  /** Sew a run outline around every carved stamp so the edge reads crisply. */
  outline: boolean;
}

/**
 * How an appliqué object is built.
 *
 * Appliqué is not a stitch type of its own: it is a sequence of passes around
 * the same outline. The placement run tells the operator where the fabric
 * goes, the machine stops, a wide tack holds the patch down, the machine stops
 * again so the excess can be trimmed, and a dense satin finish covers the raw
 * edge. All of that is real stitch geometry, so it exports like any other
 * object.
 *
 * Optional on `StitchParameters` so designs saved before this existed keep
 * compiling; absent means a normal object.
 */
export interface AppliqueSettings {
  enabled: boolean;
  /**
   * `full` runs the passes around the whole outline. `partial` runs them along
   * one stretch of it, selected by `start` and `length`, leaving the rest of
   * the shape as ordinary fill - the way a fabric roof is appliquéd onto a
   * stitched house.
   */
  mode: 'full' | 'partial';
  /** Sew the placement outline before the machine stops for the fabric. */
  placement: boolean;
  /** How the patch is held down while it is trimmed. */
  tack: 'none' | 'run' | 'zigzag' | 'satin';
  /** Tack width in mm. */
  tackWidth: number;
  /** Distance along the edge between tack penetrations in mm. */
  tackSpacing: number;
  /** How the raw edge is covered after trimming. */
  finish: 'none' | 'run' | 'zigzag' | 'satin';
  /** Finish width in mm. */
  finishWidth: number;
  /** Distance between finish penetrations in mm. */
  finishSpacing: number;
  /** Shift the finish band outward (positive) or inward (negative) in mm. */
  finishOffset: number;
  /** Also sew the object's normal fill under the appliqué patch. */
  fill: boolean;
  /** Partial mode: where the appliqué edge starts, as a fraction of the perimeter. */
  start: number;
  /** Partial mode: how much of the perimeter is appliqué edge, 0..1. */
  length: number;
}

/** Sensible starting point: a 4 mm tack and a 4 mm satin finish. */
export const DEFAULT_APPLIQUE: AppliqueSettings = {
  enabled: true,
  mode: 'full',
  placement: true,
  tack: 'zigzag',
  tackWidth: 4,
  tackSpacing: 1,
  finish: 'satin',
  finishWidth: 4,
  finishSpacing: 0.4,
  finishOffset: 0,
  fill: false,
  start: 0,
  length: 1,
};

/**
 * How a photo-stitch object turns its cell geometry into thread.
 *
 * The geometry is a list of cell squares, all the same thread colour. `satin`
 * fills each cell with a dense serpentine band, `run` lays one short stroke
 * across it, and `cross` lays two crossing strokes. The cells themselves are
 * planned from the image by `planPhotoStitch`; this only decides how each one
 * is sewn.
 */
export type PhotoStyle = 'satin' | 'run' | 'cross';

export interface PhotoSettings {
  enabled: boolean;
  style: PhotoStyle;
  /** Distance between satin rows inside a cell, in mm. */
  spacing: number;
}

/** Fine satin is the Colour Photo Stitch look; run/cross are the fast presets. */
export const DEFAULT_PHOTO: PhotoSettings = {
  enabled: true,
  style: 'satin',
  spacing: 0.4,
};

/** The four traditional redwork line styles. */
export type RedworkStyle = 'single' | 'triple' | 'backstitch' | 'stem';

export interface RedworkSettings {
  enabled: boolean;
  style: RedworkStyle;
  /** Width of a stem-stitch line, mm. Single/triple/backstitch ignore it. */
  widthMm: number;
  /** Distance between penetrations along the line, mm. */
  stitchMm: number;
}

/** Different pull compensation for each side of a satin column, in mm. */
export interface SeparatePullCompensation {
  left: number;
  right: number;
}

/** How a motif is placed: gridded fill, along an outline, one stamp, or across a column. */
export type MotifMode = 'fill' | 'run' | 'single' | 'column';

/**
 * Linear gradient across a motif layout.
 *
 * Size and extra rotation run from their `From` value at the first motif to
 * their `To` value at the last, so a motif fill can open out, close down or
 * lean as it crosses the shape.
 */
export interface MotifGradient {
  /** Scale multiplier at the first motif (1 = the layout's own size). */
  scaleFrom: number;
  scaleTo: number;
  /** Extra rotation in degrees added to each motif, first to last. */
  angleFrom: number;
  angleTo: number;
}

/**
 * Operator-supplied split definition for the programmed split fill.
 *
 * Absent means the built-in 12 mm blocks with a 1.5 mm break and half-block
 * stagger, exactly what every earlier design produced.
 */
export interface CustomSplit {
  /** Block length in mm. */
  segmentLength: number;
  /** Break between blocks in mm. */
  gap: number;
  /** Fraction of a block alternate rows are offset by, 0 to 1. */
  stagger: number;
}

export interface StitchParameters {
  stitchType: StitchType;
  /** Fill or stitch angle in degrees (0 = horizontal). */
  angle: number;
  /** Distance between stitch penetrations in mm. Lower = denser. */
  spacing: number;
  /** Maximum allowed single stitch length in mm (DST limit ~12.1). */
  maxStitchLength: number;
  /** Minimum useful stitch length in mm - shorter is flagged. */
  minStitchLength: number;
  /** Outward compensation applied to row ends in mm. */
  pullCompensation: number;
  /**
   * Pull compensation for each side of a satin column, in mm.
   *
   * Optional and nullable: absent means both sides use `pullCompensation`,
   * which is exactly what every design digitized before this existed means.
   */
  separatePullCompensation?: SeparatePullCompensation | null;
  /**
   * Redwork line automation: sew the object's rings as a one-colour line
   * instead of filling them. Optional, absent means an ordinary object.
   */
  redwork?: RedworkSettings | null;
  fillPattern: FillPattern;
  underlay: UnderlaySettings;
  tieIn: TieSettings;
  tieOff: TieSettings;
  /**
   * 3D foam, when the object is sewn over a foam sheet.
   *
   * Optional so a design saved before this existed still compiles: absent
   * means "flat", exactly as it always behaved.
   */
  foam?: FoamSettings;

  /**
   * Carving stamp texture pressed into a fill.
   *
   * Optional for the same reason `foam` is: a design saved before this
   * existed must still compile, and absent means "plain fill", which is
   * exactly how it always behaved.
   */
  carve?: CarveSettings;

  /**
   * The shape a motif fill repeats, when the operator chose one from the
   * motif library.
   *
   * Optional: absent means the built-in the fill pattern picks, which is what
   * every design produced before the library existed.
   */
  motif?: MotifChoice;

  /**
   * How the motif is placed: a gridded fill (the default, and what every
   * earlier design means), along the object's outline, one scaled stamp, or
   * across the object's own width as a column.
   */
  motifMode?: MotifMode | null;

  /**
   * Size / rotation gradient across a motif layout. Optional: absent means
   * one uniform size, exactly as every earlier design sewed.
   */
  motifGradient?: MotifGradient | null;

  /**
   * User-defined split for the programmed split fill: block length, break and
   * stagger. Optional: absent means the built-in 12 mm / 1.5 mm / half-block,
   * which is what every earlier design produced.
   */
  customSplit?: CustomSplit | null;

  /**
   * Appliqué passes around this object's outline.
   *
   * Optional for the same reason `foam` is: a design saved before appliqué
   * existed must still compile, and absent means an ordinary object.
   */
  applique?: AppliqueSettings;

  /**
   * Photo-stitch cells.
   *
   * When present the object's rings are cell squares, not a region to fill:
   * each ring is sewn as its own little satin/run/cross block. Optional so
   * every earlier design still compiles as a normal fill.
   */
  photo?: PhotoSettings;
}

/** Entry/exit point as a normalized fraction of the object bounds. */
export interface EntryExit {
  entry: Point | null;
  exit: Point | null;
}

/**
 * Lettering specification.
 *
 * Lettering is generated from its TEXT, not from `path`: the laid-out
 * strokes are derived each time the object compiles, so editing the string
 * or the size re-sews the letters rather than leaving stale geometry behind.
 * `path` stays empty for these objects and is never the source of truth.
 */
export interface LetteringSpec {
  text: string;
  /** Cap height in mm. */
  height: number;
  /** Extra space between characters in mm; negative tightens. */
  spacing: number;
  /** Italic shear in degrees from vertical. */
  slant: number;
  /** Overall rotation in degrees. */
  rotation: number;
  /** Satin stroke width in mm. */
  width: number;
  /**
   * Horizontal width factor: 1 keeps the font's proportions, 0.6 condenses,
   * 1.5 widens. Optional; absent means 1.
   */
  stretch?: number;
  /** Mirrors applied to the finished layout, as the flip buttons do. */
  mirror?: { x: boolean; y: boolean } | null;
  /**
   * Text on a path: the letters follow this polyline instead of a straight
   * line. Optional; absent means ordinary straight lettering.
   */
  onPath?: LetteringPath | null;
  /** Monogram composition. Optional; absent means plain text. */
  monogram?: MonogramSpec | null;
  /** Team-name dropped letter. Optional; absent means uniform letters. */
  drop?: LetteringDrop | null;
  /** Sewing order of the glyphs. Optional; absent means reading order. */
  order?: LetteringOrder;
}

/** How text on a path is aligned against the path's own length. */
export type LetteringPathAlign = 'start' | 'center';

export interface LetteringPath {
  /** Polyline the text follows, in design coordinates. */
  points: Point[];
  /**
   * True keeps every letter upright and only moves it along the path; false
   * rotates each letter to the path's tangent, which is what "on a path"
   * normally means.
   */
  upright: boolean;
  /**
   * Distance off the path in mm. Positive sits above a path that runs left
   * to right, negative below it.
   */
  offsetMm: number;
  align: LetteringPathAlign;
}

export type MonogramFrame = 'none' | 'circle' | 'oval' | 'diamond';

export interface MonogramSpec {
  enabled: boolean;
  /** Decorative ring sewn around the composed initials. */
  frame: MonogramFrame;
  /** Mirror the two outer initials so they face each other. */
  mirrorSides: boolean;
  /** Frame band width in mm. */
  frameWidth: number;
}

/** A single larger letter that drops below the baseline (team-name look). */
export interface LetteringDrop {
  enabled: boolean;
  /** Which character drops, by index into the text. */
  index: number;
  /** Scale of the dropped letter relative to the rest. */
  scale: number;
}

/**
 * Sewing order of the letters:
 * - `default` reading order, `reverse` last to first;
 * - `outsideIn` starts at both ends, `insideOut` starts at the middle.
 */
export type LetteringOrder = 'default' | 'reverse' | 'outsideIn' | 'insideOut';

/** Default lettering used when an object has no spec of its own. */
export const DEFAULT_LETTERING_SPEC: LetteringSpec = {
  text: 'TEXT',
  height: 20,
  spacing: 0,
  slant: 0,
  rotation: 0,
  width: 1.2,
};

export interface EmbroideryObject {
  id: string;
  name: string;
  type: ObjectType;
  /** Editable source geometry. Never discarded after stitch generation. */
  path: CompoundPath;
  /** 2D affine transform applied to source geometry. */
  transform: Transform;
  /** Index into the project's thread palette. */
  colorIndex: number;
  params: StitchParameters;
  entryExit: EntryExit;
  /**
   * Lettering text, when `type === 'lettering'`. Null for every other type.
   * The engine generates stitches from this spec, not from `path`.
   */
  lettering: LetteringSpec | null;
  order: number;
  locked: boolean;
  hidden: boolean;
  groupId: string | null;
  /** Validation messages produced by the last engine run. */
  warnings: string[];
}

/**
 * An object's placement, and nothing else.
 *
 * Flip, scale and rotate are *baked into `path`* by the editor - a rotation is
 * written into the coordinates the same way auto-hooping writes its own - so
 * the outline, the preview and the machine file are three views of one truth.
 * Storing the flags as well would leave a value nobody reads, and an API that
 * accepts a scale it cannot apply. Only the position is carried here, which the
 * lettering generator uses as its anchor.
 */
export interface Transform {
  /** Translation in mm. */
  x: number;
  y: number;
}

/** A single generated stitch/needle event. */
export interface Stitch {
  x: number;
  y: number;
  command: StitchCommand;
  /** Thread palette index this stitch belongs to. */
  colorIndex: number;
  /** Index of the source object, or null for travel-only records. */
  objectId: string | null;
  /** Position in the final sequence, 0-based. */
  sequence: number;
}

/** Fully generated, ordered stitch sequence for a whole design. */
export interface StitchSequence {
  stitches: Stitch[];
  colorCount: number;
  bounds: Bounds;
  stats: StitchStats;
}

export interface StitchStats {
  totalStitches: number;
  sewStitches: number;
  jumps: number;
  trims: number;
  colorChanges: number;
  locks: number;
  /** Longest single sew stitch in mm. */
  maxStitchLength: number;
  /** Number of sew stitches shorter than the object's minimum. */
  shortStitches: number;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  objectId: string | null;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Complete design document (what gets saved to disk / indexed in MongoDB). */
export interface DesignDocument {
  id: string;
  name: string;
  units: Unit;
  width: number;
  height: number;
  hoopId: string | null;
  objects: EmbroideryObject[];
  threadPalette: ThreadColor[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A thread colour reference. */
export interface ThreadColor {
  id: string;
  code: string;
  name: string;
  /** #RRGGBB */
  hex: string;
  brand?: string;
}

/** Hoop definition in millimeters. */
export interface Hoop {
  id: string;
  name: string;
  width: number;
  height: number;
  shape: 'rect' | 'round' | 'oval';
  /** Safe stitching area inset from the hoop edge in mm. */
  safeMargin: number;
}
