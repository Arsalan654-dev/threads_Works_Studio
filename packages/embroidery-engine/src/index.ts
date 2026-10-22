/**
 * ThreadWorks embroidery engine - public entry point.
 *
 * Pipeline
 * --------
 *   EmbroideryObject (editable source geometry + parameters)
 *        |
 *        v
 *   generateObjectStitches()   underlay -> top stitch, in object space
 *        |
 *        v
 *   buildSequence()            locks, connectors, jumps, color changes
 *        |
 *        v
 *   validateSequence()         machine-facing checks
 *        |
 *        v
 *   StitchSequence             simulate on screen, encode with writeDst()
 *
 * The editable object is NEVER discarded after generation: regeneration is a
 * pure function of (geometry, parameters), so editing and re-running is cheap
 * and lossless.
 */

import type {
  Bounds,
  CapWrapSettings,
  CompoundPath,
  EmbroideryObject,
  Hoop,
  LetteringSpec,
  MotifChoice,
  Point,
  StitchSequence,
  ThreadColor,
  ValidationResult,
} from './types.js';
import { DEFAULT_LETTERING_SPEC, isSpecialtyStitch } from './types.js';
import { resolveMotif } from './motifs.js';
import { specialtyStitches } from './specialty.js';
import { capWrapProblem, compensateCapStitches } from './capwrap.js';
import {
  layoutText,
  textToStitches,
  type LetteringOptions,
  type TextLayout,
} from './lettering/layout.js';
import {
  boundsOf,
  boundsCenter,
  dedupePoints,
  railsFromStroke,
  translatePath,
} from './geometry/index.js';
import {
  accordionFill,
  beanStitch,
  contourFill,
  crossFill,
  fillStitchLength,
  florentineFill,
  handStitchFill,
  laydownFill,
  liquidFill,
  mazeFill,
  motifColumn,
  motifFill,
  motifRun,
  motifSingle,
  runStitch,
  satinFromOutline,
  satinFromRails,
  shadingFill,
  spiralFill,
  stippleFill,
  stringFill,
  tatamiFill,
  type RawStitch,
} from './stitches/index.js';
import { mergeShortStitches } from './stitches/minlength.js';
import { DEFAULT_UNDERLAY, generateUnderlay, distance } from './underlay/index.js';
import { DEFAULT_FOAM, foamPullCompensation, foamSpacing, foamTack } from './foam.js';
import { DEFAULT_CARVE, carveFill } from './carve.js';
import { appliqueStitches, resolveApplique } from './applique.js';
import { photoSettings, photoStitches } from './photo.js';
import { redworkSettings, redworkStitches } from './redwork.js';
import {
  DEFAULT_CONNECTORS,
  buildSequence,
  resolveEntryExit,
  type ObjectStitchGroup,
  type ConnectorSettings,
} from './sequencing/index.js';
import { LIMITS, validateObject, validateSequence } from './validation/index.js';
import { boundsOfStitches } from './formats/dst.js';
import { computeStats } from './stats.js';

export interface GenerateOptions {
  connectors?: Partial<ConnectorSettings>;
  optimizeColors?: boolean;
  /**
   * Cap-frame settings. Compensation is applied to the generated sequence, so
   * preview, validation and every exporter see the same machine coordinates.
   */
  capWrap?: CapWrapSettings & { centerX?: number };
}

/**
 * Generate the raw stitch list for one object (underlay first, then top
 * stitch) in DESIGN coordinates.
 *
 * Returns an empty array for hidden objects, so callers do not have to
 * special-case them.
 */
export function generateObjectStitches(obj: EmbroideryObject): RawStitch[] {
  if (obj.hidden) return [];

  // Lettering is generated from its text spec, not from `path` - the laid-out
  // strokes are recomputed each compile so editing the string re-sews the
  // letters instead of leaving stale geometry behind.
  if (obj.type === 'lettering') return generateLettering(obj);

  if (obj.path.rings.length === 0) return [];

  const out: RawStitch[] = [];
  const p = obj.params;
  // Redwork replaces whatever fill the object would normally sew: the rings
  // are the line, and the line style is the whole design. Handled before
  // photo/applique so the mode is predictable.
  const redwork = redworkSettings(p.redwork);
  if (redwork) {
    return redworkStitches(obj.path, redwork, {
      closed: obj.type !== 'run' && obj.type !== 'bean',
      maxStitchLength: p.maxStitchLength,
    });
  }
  const photo = photoSettings(p.photo);
  // A photo object is not a region to fill: its rings are individual cells and
  // every one is a tiny satin/run/cross block. Underlay would be larger than
  // the blocks themselves, so the photo path returns before it.
  if (photo) {
    return photoStitches(obj.path, p.angle, photo);
  }
  const applique = resolveApplique(p);
  // A patch with no fill under it is only the placement/tack/finish passes.
  // Running the ordinary fill as well would sew the fabric area solid before
  // the patch arrived on top of it.
  if (applique && !applique.fill) {
    return appliqueStitches(obj.path, applique, { maxStitchLength: p.maxStitchLength });
  }

  // Specialty decorative stitches own their whole pass. Running the ordinary
  // underlay first would bury the sequin/bead pattern under a dense fill.
  if (isSpecialtyStitch(p.stitchType)) {
    return specialtyStitches(obj.path, {
      style: p.stitchType,
      spacing: p.spacing,
      angle: p.angle,
      maxStitchLength: p.maxStitchLength,
      line: obj.type === 'run' || obj.type === 'bean',
      closed: obj.type !== 'run' && obj.type !== 'bean',
    });
  }

  const foam = p.foam ?? DEFAULT_FOAM;

  // --- underlay ----------------------------------------------------------
  //
  // Foam changes what "under" means. A normal underlay is a dense bed of
  // stitches that would lift and skate the foam sheet before the satin
  // arrived, so over foam it is dropped and (optionally) replaced by a single
  // light tack whose only job is to stop the sheet moving. The satin itself
  // does the trapping.
  if (foam.enabled && p.stitchType === 'satin') {
    if (foam.tackUnderlay) {
      appendAll(
        out,
        foamTack(obj.path, {
          spacing: Math.max(2, p.spacing * 6),
          maxStitchLength: p.maxStitchLength,
        }),
      );
    }
  } else {
    const underlay = generateUnderlay(obj.path, p.underlay ?? DEFAULT_UNDERLAY, p.angle);
    appendAll(out, underlay);
  }

  // --- top stitch --------------------------------------------------------
  const top = generateTopStitch(obj);
  // A machine cannot sew an arbitrarily short stitch - it lands on the
  // previous hole and loops the thread - so the object's own minimum length
  // collapses the sub-minimum points the generator leaves at row ends. It is
  // applied to the top layer only: underlay is coarser by design and its
  // short points are structural.
  const topFiltered = mergeShortStitches(top, p.minStitchLength);
  // The top layer rarely starts where the underlay stopped - a fill's edge
  // run can finish on the opposite side of the shape. That move is travel, not
  // a stitch: sewing it would drag a thread right across the work (and the
  // machine limit check rejects it as too long). Jump there instead, keeping
  // the first top stitch where it belongs.
  if (out.length > 0 && topFiltered.length > 0) {
    const last = out[out.length - 1]!;
    const first = topFiltered[0]!;
    if (distance(last, first) > DEFAULT_CONNECTORS.jumpThreshold) {
      topFiltered.unshift({ x: first.x, y: first.y, command: 'jump' });
    }
  }
  appendAll(out, topFiltered);

  // A patch that also keeps its fill: the fill is sewn first, then the same
  // placement/tack/finish passes follow. The first pass jumps in, because
  // sewing from the last fill stitch to the edge would drag a thread.
  if (applique && applique.fill) {
    const passes = appliqueStitches(obj.path, applique, { maxStitchLength: p.maxStitchLength });
    if (passes.length > 0 && out.length > 0) {
      const first = passes[0]!;
      out.push({ x: first.x, y: first.y, command: 'trim' });
      out.push({ x: first.x, y: first.y, command: 'jump' });
    }
    appendAll(out, passes);
  }

  return out;
}

/**
 * Sew a lettering object as satin columns.
 *
 * Every stroke of every glyph becomes its own satin column, which is how a
 * digitizer would sew a single-stroke font. Underlay and tie-offs are skipped
 * per-stroke deliberately: letters are small, and locking every stroke would
 * add a great many tie-in/tie-off pairs for no structural gain on a shape
 * that is already tiny and densely underlaid by its own satin.
 */
function generateLettering(obj: EmbroideryObject): RawStitch[] {
  const spec = obj.lettering ?? DEFAULT_LETTERING_SPEC;
  if (spec.text.trim() === '') return [];

  const p = obj.params;
  const foam = p.foam ?? DEFAULT_FOAM;
  // Lettering is the usual reason someone reaches for foam - a raised team
  // name on a cap - so the same density and width rules apply here as to a
  // hand-digitized column.
  const spacing = foam.enabled ? foamSpacing(p.spacing) : p.spacing;
  const pullCompensation = foam.enabled
    ? foamPullCompensation(p.pullCompensation, foam.thicknessMm)
    : p.pullCompensation;

  // Lettering is small, dense satin: without a floor it produces a great many
  // sub-minimum stitches at the ends of each stroke, which is exactly where a
  // machine bird-nests. Same rule as the shape pipeline.
  return mergeShortStitches(
    textToStitches(spec.text, letteringOptionsFor(obj, spec), {
      spacing,
      maxStitchLength: p.maxStitchLength,
      pullCompensation,
      splitStrategy: 'divide',
    }),
    p.minStitchLength,
  );
}

/**
 * The layout options a lettering object compiles with.
 *
 * Shared by the compiler, the canvas preview and hit testing so all three
 * agree on where the letters are. Stitch parameters are deliberately not part
 * of it: they change how the satin is formed, not where the glyphs sit.
 */
function letteringOptionsFor(obj: EmbroideryObject, spec: LetteringSpec): LetteringOptions {
  return {
    height: spec.height,
    spacing: spec.spacing,
    slant: spec.slant,
    rotation: spec.rotation,
    width: spec.width,
    font: spec.font ?? 'studio',
    // `transform.x/y` are the object's position; lettering anchors there.
    origin: { x: obj.transform.x, y: obj.transform.y },
    stretch: spec.stretch ?? 1,
    mirror: spec.mirror ?? null,
    onPath: spec.onPath ?? null,
    monogram: spec.monogram ?? null,
    drop: spec.drop ?? null,
    order: spec.order ?? 'default',
    frameWidth: spec.monogram?.frameWidth ?? spec.width,
  };
}

function letteringLayout(obj: EmbroideryObject): TextLayout | null {
  if (obj.type !== 'lettering') return null;
  const spec = obj.lettering ?? DEFAULT_LETTERING_SPEC;
  if (spec.text.trim() === '') return null;
  return layoutText(spec.text, letteringOptionsFor(obj, spec));
}

/**
 * Bounds of a lettering object's letters in design coordinates.
 *
 * A lettering object carries no path - its geometry is generated from the
 * text spec - so anything that needs a box around the object (hit testing,
 * selection, ordering) has to ask for the laid-out letters instead.
 */
export function letteringBounds(obj: EmbroideryObject): Bounds | null {
  return letteringLayout(obj)?.bounds ?? null;
}

/** Laid-out strokes of a lettering object, for previews and hit tests. */
export function letteringStrokes(obj: EmbroideryObject): {
  strokes: Point[][];
  frame: Point[] | null;
} {
  const layout = letteringLayout(obj);
  return { strokes: layout?.strokes ?? [], frame: layout?.frame ?? null };
}

/**
 * Append every element of `items` to `out`.
 *
 * `out.push(...items)` looks equivalent but is not: the spread passes the
 * items as individual arguments, and Vite/Node cap arguments well below the
 * million stitches a large dense fill produces - the call throws
 * "Maximum call stack size exceeded". A loop has no such ceiling.
 */
function appendAll<T>(out: T[], items: T[]): void {
  for (let i = 0; i < items.length; i++) out.push(items[i]!);
}

/** Generate only the top stitch layer for an object. */
function generateTopStitch(obj: EmbroideryObject): RawStitch[] {
  const p = obj.params;
  const path = obj.path;

  switch (p.stitchType) {
    case 'satin': {
      const foam = p.foam ?? DEFAULT_FOAM;
      // Over foam the column has to be denser and wider than it would be
      // flat: dense enough that no foam shows between rows, wide enough that
      // the thread still meets fabric past the raised edge.
      const spacing = foam.enabled ? foamSpacing(p.spacing) : p.spacing;
      const pullCompensation = foam.enabled
        ? foamPullCompensation(p.pullCompensation, foam.thicknessMm)
        : p.pullCompensation;
      // Separately-compensated sides are widened for foam individually; the
      // uniform value remains the fallback and the value every other stitch
      // type reads.
      const separate = p.separatePullCompensation ?? null;
      const pullLeft = separate
        ? foam.enabled
          ? foamPullCompensation(separate.left, foam.thicknessMm)
          : separate.left
        : pullCompensation;
      const pullRight = separate
        ? foam.enabled
          ? foamPullCompensation(separate.right, foam.thicknessMm)
          : separate.right
        : pullCompensation;

      // A column digitized as two rails (rings[0] and rings[1]) is stitched
      // rail-to-rail; a single-ring shape is treated as a stroked outline
      // whose width is the column width, NOT the row density.
      if (path.rings.length >= 2 && path.rings[0]!.length >= 2 && path.rings[1]!.length >= 2) {
        return satinFromRails(path.rings[0]!, path.rings[1]!, {
          spacing,
          maxStitchLength: p.maxStitchLength,
          pullCompensation,
          pullCompensationLeft: pullLeft,
          pullCompensationRight: pullRight,
          splitStrategy: 'divide',
        });
      }
      // A single ring is the OUTLINE of the column the operator drew, not a
      // centre line: fill it row by row across its own width. Stroking the
      // ring would sew a hairline along the boundary instead of a column.
      return satinFromOutline(path, {
        spacing,
        maxStitchLength: p.maxStitchLength,
        pullCompensation,
        pullCompensationLeft: pullLeft,
        pullCompensationRight: pullRight,
        splitStrategy: 'divide',
      });
    }

    case 'tatami': {
      // `fillPattern` picks HOW the fill is laid: every pattern routes to its
      // own generator, so the field is a real choice rather than a number
      // that travels to the database and back untouched.
      const base = generateFill(obj);
      // A carving stamp presses a repeating pattern into the fill by removing
      // the stitches that fall inside it, so the shape still reads as a solid
      // fill with a debossed texture punched through. Carving only ever
      // subtracts from the fill above — it never invents stitches.
      const carve = p.carve ?? DEFAULT_CARVE;
      if (carve.enabled) return carveFill(base, path, carve, p.angle, p.maxStitchLength);
      return base;
    }

    case 'run':
      return runStitch(outlinePoints(path), {
        spacing: p.spacing,
        maxStitchLength: p.maxStitchLength,
      });

    case 'bean':
      return beanStitch(outlinePoints(path), {
        spacing: p.spacing,
        maxStitchLength: p.maxStitchLength,
      });

    case 'motif':
      return generateMotifStitches(obj);

    case 'contour':
      return contourFill(path, { spacing: p.spacing, angle: p.angle });

    case 'spiral':
      return spiralFill(path, { spacing: p.spacing });

    default:
      return [];
  }
}

/**
 * Motif placement for an object: a gridded fill, a line of motifs along the
 * path, one scaled stamp, or motifs laid across a column.
 *
 * Reached from the motif stitch type and from the motif fill pattern alike,
 * so "run" and "column" cannot mean two different things depending on which
 * menu set them.
 */
function generateMotifStitches(obj: EmbroideryObject): RawStitch[] {
  const p = obj.params;
  const path = obj.path;
  const grid = motifGridSpacing(p.spacing);
  const { motif, motifScale } = motifFor(grid, p.motif);
  const mode = p.motifMode ?? 'fill';
  const gradient = p.motifGradient ?? null;

  if (mode === 'single') {
    // One stamp, scaled to the box the operator drew: the stamp tool.
    const box = boundsOf(path.rings);
    if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return [];
    return motifSingle(motif, box, { rotation: p.angle });
  }

  if (mode === 'run') {
    const line = outlinePoints(path);
    if (line.length < 2) return [];
    return motifRun(motif, line, {
      spacing: grid,
      motifScale,
      angle: p.angle,
      closed: obj.type !== 'run' && obj.type !== 'bean',
      gradient,
    });
  }

  if (mode === 'column') {
    // Two rings are the two rails, exactly as a satin column reads them; a
    // single ring is a centre line whose width the object's own density sets.
    if (path.rings.length >= 2 && path.rings[0]!.length >= 2 && path.rings[1]!.length >= 2) {
      return motifColumn(motif, path.rings[0]!, path.rings[1]!, {
        spacing: grid,
        angle: p.angle,
        gradient,
      });
    }
    const outer = path.rings[0];
    if (!outer || outer.length < 2) return [];
    const stroke = [...outer, { ...outer[0]! }];
    const rails = railsFromStroke(stroke, Math.max(1, p.spacing * 2));
    return motifColumn(motif, rails.left, rails.right, {
      spacing: grid,
      angle: p.angle,
      gradient,
    });
  }

  return motifFill(path, motif, { spacing: grid, motifScale, angle: p.angle, gradient });
}

/**
 * Route a fill object to the generator its `fillPattern` names.
 *
 * One function so carve, underlay and validation all see a single generated
 * pass regardless of which texture was chosen.
 */
function generateFill(obj: EmbroideryObject): RawStitch[] {
  const path = obj.path;
  const p = obj.params;
  const stitchLength = fillStitchLength(p.stitchLength);
  // The plain tatami settings the textured tatami family builds on: same
  // density, pull and travel rules, different texture on top.
  const common = {
    angle: p.angle,
    spacing: p.spacing,
    stitchLength,
    pullCompensation: p.pullCompensation,
    jumpThreshold: DEFAULT_CONNECTORS.jumpThreshold,
    serpentine: true,
    offsetPattern: true,
    edgeInset: Math.min(0.3, p.spacing * 0.35),
  };

  switch (p.fillPattern) {
    case 'motif':
      // The motif layout (fill / run / single / column) is the same whether
      // it was reached through the stitch type or the fill pattern.
      return generateMotifStitches(obj);
    case 'contour':
      return contourFill(path, { spacing: p.spacing, angle: p.angle, stitchLength });
    case 'spiral':
      return spiralFill(path, { spacing: p.spacing, stitchLength });
    case 'programmedSplit': {
      // A user-defined split replaces the built-in 12 mm / 1.5 mm / half-block
      // numbers without leaving the pattern; absent means the built-in, which
      // is exactly what every earlier design produced.
      const custom = p.customSplit ?? null;
      const split = custom
        ? { segmentLength: custom.segmentLength, gap: custom.gap, stagger: custom.stagger }
        : { segmentLength: 12, gap: 1.5 };
      return tatamiFill(path, { ...common, split });
    }
    case 'flexiSplit':
      // The same brick idea with adaptive block lengths, so the breaks
      // follow narrow necks instead of ruling straight across them.
      return tatamiFill(path, {
        ...common,
        split: { segmentLength: 10, gap: 1.2 },
        adaptiveSplit: true,
      });
    case 'jagged':
      return tatamiFill(path, { ...common, jagged: Math.max(0.4, p.spacing * 1.4) });
    case 'warp':
      return tatamiFill(path, { ...common, warp: Math.max(0.5, p.spacing * 2) });
    case 'accordion':
      return accordionFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'florentine':
      return florentineFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'liquid':
      return liquidFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'maze':
      return mazeFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'string':
      return stringFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'laydown':
      return laydownFill(path, {
        angle: p.angle,
        spacing: p.spacing,
        maxStitchLength: p.maxStitchLength,
      });
    case 'stipple':
      return stippleFill(path, { spacing: p.spacing });
    case 'cross':
      return crossFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'shading':
      return shadingFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'hand':
      return handStitchFill(path, { angle: p.angle, spacing: p.spacing, stitchLength });
    case 'tatami':
    default:
      return tatamiFill(path, common);
  }
}

/** Flatten a compound path into one open polyline (outer boundary). */
function outlinePoints(path: CompoundPath): Point[] {
  const outer = path.rings[0];
  if (!outer || outer.length < 2) return [];
  return [...outer, { ...outer[0]! }];
}

/**
 * The motif to stamp on a grid, and the scale that makes it tile a fill.
 *
 * The shape comes from the design when it carries one and from the built-in
 * library otherwise. Whatever is picked, the scale is worked out from that
 * shape's own measured width rather than a number tied to the star, so a
 * heart, a hexagon and a shape drawn by hand all land the same way: exactly
 * one grid cell across.
 *
 * That matters because a motif wider than its cell overprints its neighbours
 * and hangs outside the shape, and because `motifFill`'s "the whole motif
 * fits inside" test can only pass if the size was derived from the grid it is
 * being placed on.
 */
function motifFor(
  gridSpacing: number,
  choice: MotifChoice | undefined,
): { motif: Point[]; motifScale: number } {
  const motif = resolveMotif(choice);
  // A shape drawn by an operator is measured in mm, so its natural width is
  // the span itself; the built-ins are drawn inside a unit circle.
  const box = boundsOf([motif]);
  const naturalWidth = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6);
  // One grid cell across, never smaller than the 0.1 floor `motifFill` uses
  // so a very large grid cannot collapse the motif to a point.
  const motifScale = Math.max(0.1, gridSpacing / naturalWidth);
  return { motif, motifScale };
}

/** Grid pitch for a motif fill: generous enough that motifs stay distinct. */
function motifGridSpacing(spacing: number): number {
  return Math.max(2, spacing * 8);
}

/**
 * Full pipeline: objects -> validated stitch sequence.
 *
 * This is what the application calls when a design changes. It is a pure
 * function of its inputs, so the same design always reproduces the same
 * stitches - which is what makes save/reopen and undo/redo reliable.
 */
export function compileDesign(
  objects: EmbroideryObject[],
  palette: ThreadColor[],
  hoop: Hoop | null = null,
  options: GenerateOptions = {},
): { sequence: StitchSequence; validation: ValidationResult } {
  const visible = objects
    .filter((o) => !o.hidden)
    .slice()
    .sort((a, b) => a.order - b.order);

  // --- validate parameters before doing expensive work --------------------
  const preIssues = visible.flatMap((o) => validateObject(o).issues);

  // --- generate per object ------------------------------------------------
  const groups: ObjectStitchGroup[] = [];
  let cursor: Point | null = null;

  for (const obj of visible) {
    const raw = generateObjectStitches(obj);
    if (raw.length === 0) continue;

    const { entry, exit } = resolveEntryExit(obj, cursor);

    groups.push({
      objectId: obj.id,
      colorIndex: obj.colorIndex,
      stitches: raw,
      entry,
      exit,
      lockStart: obj.params.tieIn.enabled,
      lockEnd: obj.params.tieOff.enabled,
      lockLength: obj.params.tieIn.length ?? 0.4,
      lockCount: obj.params.tieIn.count ?? 3,
    });

    if (exit) cursor = { ...exit };
  }

  // --- sequence -----------------------------------------------------------
  const built = buildSequence(groups, palette, {
    connectors: { ...DEFAULT_CONNECTORS, ...options.connectors },
    optimizeColors: options.optimizeColors ?? false,
  });

  // --- cap-frame driver compensation --------------------------------------
  // Applied after sequencing so jumps and colour changes move with the
  // stitches, and before statistics/validation so the hoop check measures the
  // coordinates that actually reach the machine.
  let stitches = built.stitches;
  const capWrap = options.capWrap;
  let capIssue: { severity: 'error'; code: string; message: string; objectId: null } | null = null;
  if (capWrap?.enabled) {
    const flatBounds = boundsOfStitches(stitches);
    const width = flatBounds.maxX - flatBounds.minX;
    const centerX =
      capWrap.centerX ?? (hoop ? hoop.width / 2 : (flatBounds.minX + flatBounds.maxX) / 2);
    const problem = capWrapProblem(capWrap, width, {
      minX: flatBounds.minX,
      maxX: flatBounds.maxX,
      centerX,
    });
    if (problem) {
      capIssue = { severity: 'error', code: 'CAP_WRAP_INVALID', message: problem, objectId: null };
    } else if (capWrap.compensate) {
      stitches = compensateCapStitches(stitches, { settings: capWrap, centerX });
    }
  }

  // --- stats --------------------------------------------------------------
  const stats = computeStats(stitches);

  const sequence: StitchSequence = {
    stitches,
    colorCount: new Set(
      stitches.filter((s) => s.command !== 'jump' && s.command !== 'trim').map((s) => s.colorIndex),
    ).size,
    bounds: boundsOfStitches(stitches),
    stats,
  };

  // --- validation ---------------------------------------------------------
  const validation = validateSequence(stitches, visible, hoop);
  validation.issues = [...preIssues, ...(capIssue ? [capIssue] : []), ...validation.issues];
  validation.ok = !validation.issues.some((i) => i.severity === 'error');

  return { sequence, validation };
}

/** Compute production statistics from a generated sequence. */
export { computeStats } from './stats.js';

/**
 * Collapse sub-minimum stitches, which a machine cannot sew without
 * looping the thread. Exposed so the UI can show the effect of a user's
 * minimum-length setting without re-running the whole design.
 */
export { mergeShortStitches } from './stitches/minlength.js';

// ---------------------------------------------------------------------------
// Convenience helpers used by the editor
// ---------------------------------------------------------------------------

/** Bounds of a set of stitches (millimeters). */
export { boundsOfStitches };

/** Bounds of source geometry. */
export function boundsOfObjects(objects: EmbroideryObject[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const o of objects) {
    if (o.hidden) continue;
    const b = boundsOf(o.path.rings);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Distance helper re-exported for the UI's connector tools. */
export { distance };

/** Translate an object's source geometry without touching its parameters. */
export function translateObject(obj: EmbroideryObject, dx: number, dy: number): EmbroideryObject {
  return {
    ...obj,
    path: translatePath(obj.path, dx, dy),
    // Lettering has no path to move: its position is where the spec's origin
    // anchors, so a drag has to move the transform as well or the text would
    // stay put while everything else slid away from it.
    ...(obj.type === 'lettering'
      ? { transform: { x: obj.transform.x + dx, y: obj.transform.y + dy } }
      : {}),
  };
}

/** Center point of an object's bounds - used for rotation and snapping. */
export function objectCenter(obj: EmbroideryObject): Point {
  if (obj.type === 'lettering') {
    const box = letteringBounds(obj);
    if (box) return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }
  return boundsCenter(boundsOf(obj.path.rings));
}

/** Clean up duplicate points in an object's geometry. */
export function normalizeObjectPath(obj: EmbroideryObject): EmbroideryObject {
  return {
    ...obj,
    path: { rings: obj.path.rings.map((r) => dedupePoints(r)) },
  };
}

export { validateObject, validateSequence, LIMITS };

/**
 * Where an object's colour starts and stops.
 *
 * Exposed so a test - or the UI - can check the contract directly: a hand-set
 * `entryExit` point must beat the engine's own guess. A "Set entry" button
 * that had no effect on the compiled file would be worse than no button,
 * because the user would trust a start point the machine ignored.
 */
export { optimizeObjectOrder, resolveEntryExit } from './sequencing/index.js';
export type { ObjectOrderOptions } from './sequencing/index.js';
export {
  GifEncoder,
  lzwCompress,
  Raster,
  encodeStitchMovie,
  renderStitchPreview,
  drawText,
  GIF_EXTENSION,
  GIF_MIME,
} from './video/movie.js';
export type {
  GifOptions,
  Rgb,
  StitchMovieOptions,
  StitchMovieResult,
  StitchPreview,
  StitchPreviewOptions,
} from './video/movie.js';
export {
  autoDigitize,
  quantize,
  traceMask,
  signedArea,
  pointInRing,
  interiorPoint,
  rasterizeRings,
  chamferDistances,
  paletteHex,
  BACKGROUND,
} from './autodigitize/index.js';
export type {
  AutoDigitizeOptions,
  AutoDigitizeRegion,
  AutoDigitizeResult,
  RasterImage,
  PixelLoop,
} from './autodigitize/index.js';
export { writeDst, readDst, DstEncodingError, DST_EXTENSION, DST_MIME } from './formats/dst.js';
export type { DstWriteOptions, DstReadResult } from './formats/dst.js';
export {
  writeExp,
  readExp,
  splitExpMove,
  ExpEncodingError,
  EXP_EXTENSION,
  EXP_MIME,
  EXP_MAX_STEP,
  EXP_MM_PER_UNIT,
} from './formats/exp.js';
export type { ExpReadResult } from './formats/exp.js';
export {
  writePes,
  readPes,
  readPec,
  nearestPecColorIndex,
  pecChartColor,
  PEC_CHART_NAMES,
  PesEncodingError,
  PES_EXTENSION,
  PES_MIME,
  PES_SIGNATURE,
  PEC_SIGNATURE,
  PEC_HEADER_SIZE,
  PEC_CHART_SIZE,
  PEC_MAX_STEP,
  PES_MM_PER_UNIT,
} from './formats/pes.js';
export type { PesWriteOptions, PesReadResult } from './formats/pes.js';
export {
  writeJef,
  readJef,
  splitJefMove,
  jefHoopSize,
  JefEncodingError,
  JEF_EXTENSION,
  JEF_MIME,
  JEF_HEADER_BYTES,
  JEF_COLOR_SLOT_BYTES,
  JEF_MAX_STEP,
  JEF_MM_PER_UNIT,
} from './formats/jef.js';
export type { JefWriteOptions, JefReadResult } from './formats/jef.js';
export {
  JEF_THREADS,
  nearestJefIndex,
  jefThreadAt,
  redMeanDistance,
  roundHalfToEven,
} from './formats/jefColors.js';
export type { JefThread } from './formats/jefColors.js';
export { planMove } from './formats/moves.js';
export type { PlannedHop } from './formats/moves.js';
export {
  writeVp3,
  readVp3,
  Vp3EncodingError,
  Vp3DecodingError,
  VP3_EXTENSION,
  VP3_MIME,
} from './formats/vp3.js';
export type { Vp3ReadResult } from './formats/vp3.js';
export {
  writeTbf,
  readTbf,
  TbfEncodingError,
  TbfDecodingError,
  TBF_EXTENSION,
  TBF_MIME,
  TBF_MAX_STEP,
  TBF_NAME_LENGTH,
} from './formats/tbf.js';
export type { TbfReadResult } from './formats/tbf.js';
export {
  writeHus,
  readHus,
  HusEncodingError,
  HusDecodingError,
  HUS_EXTENSION,
  HUS_MIME,
  HUS_MAX_STEP,
  HUS_THREAD_COUNT,
} from './formats/hus.js';
export type { HusReadResult } from './formats/hus.js';
export { HUS_THREADS, nearestHusThreadIndex, husThreadColor } from './formats/husColors.js';
export type { HusThread } from './formats/husColors.js';
export { importMachineFile, detectFormat, ImportError, FORMAT_LABELS } from './formats/import.js';
export type { ImportedDesign, ImportOptions, MachineFormat } from './formats/import.js';

// The editor works with these directly, so they are part of the package
// surface rather than something the client should deep-import from `src/`.
export type {
  AppliqueSettings,
  Bounds,
  CapWrapSettings,
  CompoundPath,
  CarvePattern,
  CarveSettings,
  DesignDocument,
  EmbroideryObject,
  EntryExit,
  FillPattern,
  FontId,
  Hoop,
  LetteringDrop,
  LetteringOrder,
  LetteringPath,
  LetteringPathAlign,
  LetteringSpec,
  MonogramFrame,
  MonogramSpec,
  MotifChoice,
  ObjectType,
  PhotoSettings,
  PhotoStyle,
  Point,
  RedworkSettings,
  RedworkStyle,
  Ring,
  SpecialtyStitchType,
  Stitch,
  StitchCommand,
  StitchParameters,
  StitchSequence,
  StitchStats,
  StitchType,
  ThreadColor,
  Transform,
  UnderlaySettings,
  UnderlayType,
  Unit,
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
} from './types.js';

export type { RawStitch } from './stitches/index.js';

// ---------------------------------------------------------------------------
// Lettering
// ---------------------------------------------------------------------------

export {
  GLYPHS,
  METRICS,
  SUPPORTED_CHARACTERS,
  resolveGlyph,
  type Glyph,
} from './lettering/font.js';

export {
  DEFAULT_LETTERING,
  layoutText,
  measureText,
  textToStitches,
  type GlyphPlacement,
  type LetteringOptions,
  type TextLayout,
} from './lettering/layout.js';

export {
  FONTS,
  FONT_IDS_PUBLIC,
  FONT_LIBRARY,
  fontFor,
  isFontId,
  resolveFontGlyph,
  type FontDefinition,
} from './lettering/fonts.js';

export {
  CLIPART,
  CLIPART_CATEGORIES,
  clipartById,
  placeClipart,
  searchClipart,
  type ClipartEntry,
  type ClipartPlacement,
} from './clipart.js';

export {
  capDepthShade,
  capPreviewPoint,
  capRadius,
  capWrapProblem,
  compensateCapPoint,
  compensateCapStitches,
  type CapPreviewPoint,
  type CapWrapTransform,
} from './capwrap.js';

export {
  MAX_MACHINES,
  machineNumbers,
  machineOf,
  spreadAcrossMachines,
  splitObjectsByMachine,
} from './machines.js';

export { specialtyStitches, type SpecialtyOptions } from './specialty.js';

export { designToSvg, type SvgArtworkOptions } from './artwork/svg.js';
export { colorOf, stitchRuns, type ArtworkSource, type StitchRun } from './artwork/common.js';
export {
  PAPER_MM,
  buildPdf,
  designToPdf,
  pdfBytes,
  pdfLine,
  pdfText,
  type PaperSize,
  type DesignPdfOptions,
  type PdfDocumentOptions,
  type PdfPage,
} from './artwork/pdf.js';
export {
  buildPrintSheet,
  type PrintSheetOptions,
  type PrintSheetSummary,
} from './artwork/print.js';

export { DEFAULT_APPLIQUE, DEFAULT_CAP_WRAP, DEFAULT_LETTERING_SPEC, DEFAULT_PHOTO, SPECIALTY_STITCH_TYPES, isSpecialtyStitch } from './types.js';
export { DEFAULT_REDWORK, REDWORK_LIMITS, redworkSettings, redworkStitches } from './redwork.js';
export type { RedworkOptions } from './redwork.js';

export {
  boundsMidpoint,
  pickHoop,
  rotateObject,
  flipObjectX,
  scaleObject,
  usableField,
  type HoopFit,
  type HoopNeed,
  type PickHoopOptions,
} from './hooping.js';

export {
  MultiHoopError,
  SPLIT_PADDING,
  DEFAULT_REGISTRATION_MARK_SIZE,
  splitIntoHoops,
  type HoopSection,
  type RegistrationMark,
  type SectionCut,
  type SplitOptions,
  type SplitResult,
} from './multihoop.js';

export {
  canBlend,
  normalizeFillAngle,
  planBlend,
  type BlendAdjustment,
  type BlendOptions,
  type BlendPlan,
  type BlendTarget,
} from './blend.js';

export {
  DEFAULT_FOAM,
  FOAM_MAX_SPACING,
  FOAM_PULL_RATIO,
  foamPullCompensation,
  foamSpacing,
  foamTack,
} from './foam.js';

export {
  BUILTIN_MOTIFS,
  DEFAULT_MOTIF,
  MOTIF_COMFORT_SIZE,
  MOTIF_MAX_POINTS,
  MOTIF_MAX_SIZE,
  MOTIF_MIN_SIZE,
  builtinMotifs,
  labelFor,
  motifProblem,
  normalizeMotif,
  resolveMotif,
  ringFromPointsText,
  ringFromSvgPath,
  selfIntersects,
  type BuiltinMotifId,
  type MotifShape,
} from './motifs.js';

export {
  CARVE_PATTERNS,
  DEFAULT_CARVE,
  CARVE_MIN_SPACING,
  carveFill,
  carvePattern,
} from './carve.js';

// --- shaping tools ---------------------------------------------------------
// Boolean outlines and the geometry rewrites behind the Shape commands. Kept
// as a named block so the public surface of the engine reads as a list of
// capabilities rather than one flat dump.
export {
  booleanPath,
  combinePaths,
  explodePath,
  intersectPaths,
  resolveRing,
  segmentIntersections,
  subtractPaths,
  unionPaths,
  weldPaths,
  xorPaths,
} from './geometry/boolean.js';
export type { BooleanOp } from './geometry/boolean.js';

export {
  borderPath,
  centrePath,
  offsetPath,
  offsetRing,
  pathsTouch,
  roundCorners,
} from './geometry/offset.js';
export type { OffsetOptions, RoundOptions } from './geometry/offset.js';

// --- appliqué ---------------------------------------------------------------
export {
  APPLIQUE_LIMITS,
  appliqueProblem,
  appliqueSettings,
  appliqueStitches,
  resolveApplique,
  ringSection,
} from './applique.js';
export type { AppliqueLimits, AppliqueOptions } from './applique.js';

// --- photo stitch -----------------------------------------------------------
export {
  PHOTO_LIMITS,
  photoProblem,
  photoSettings,
  photoStitches,
  planPhotoStitch,
} from './photo.js';
export type { PhotoGroup, PhotoLimits, PhotoPlan, PhotoStitchOptions } from './photo.js';
