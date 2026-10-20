/**
 * Carving stamp — a texture pressed into a fill.
 *
 * A motif fill *is* only motifs: the shape reads as a scatter of small
 * designs with fabric showing between them. A carve is the other thing
 * entirely — it starts from a real tatami fill and then removes the stitches
 * that fall inside a repeating stamp, so the shape still reads as a solid
 * fill but with a debossed pattern punched through it. The gaps are the
 * design, which is why it behaves like an effect on a fill rather than a
 * stitch type of its own.
 *
 * What the generator actually does, and why:
 *
 *  1. **Stamps are placed on a staggered grid inside the shape** — the same
 *     brick arrangement a motif fill uses, so alternating rows interlock
 *     instead of lining up into visible columns.
 *  2. **Every fill stitch inside a stamp is dropped.** The base fill is
 *     generated first and untouched otherwise; carving only ever removes, it
 *     never invents stitches. That keeps the fill honest: what you see is the
 *     tatami you asked for with a pattern taken out of it.
 *  3. **The stamp outline can be sewn.** Without it the carved hole is just
 *     bare fabric between rows; with it the edge of every stamp is a crisp
 *     run, which is what makes a subtle carve readable from arm's length.
 *
 * The fill has to be dense enough to survive being carved — remove too much
 * from a loose fill and what is left stops holding together. The generator
 * does not silently re-densify; it carves what it was given, and the preview
 * shows the truth.
 */

import type { CarveSettings, CompoundPath, Point } from './types.js';
import { boundsCenter, boundsOf, rotatePath, rotatePoint, toRadians } from './geometry/index.js';
import { runStitch, type RawStitch } from './stitches/index.js';
import { pointInRing } from './autodigitize/trace.js';
import { LIMITS } from './validation/index.js';

/** Carve off by default: a fill is plain until someone asks for texture. */
export const DEFAULT_CARVE: CarveSettings = {
  enabled: false,
  pattern: 'diamond',
  spacing: 6,
  scale: 3,
  rotation: 0,
  outline: true,
};

/**
 * The smallest gap between stamp centres, in mm.
 *
 * Below this the stamps overlap so heavily that the fill between them stops
 * being a fill — you are left with a torn sheet rather than a carved one.
 */
export const CARVE_MIN_SPACING = 1;

/** Stamp sizes the shape of each built-in pattern, centred on the origin. */

function regularPolygon(sides: number, radius: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

function starPolygon(points: number, outer: number, inner: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** A plus sign, as a closed 12-point outline. */
function crossPolygon(arm: number, thickness: number): Point[] {
  const t = thickness / 2;
  const a = arm;
  return [
    { x: -t, y: -a },
    { x: t, y: -a },
    { x: t, y: -t },
    { x: a, y: -t },
    { x: a, y: t },
    { x: t, y: t },
    { x: t, y: a },
    { x: -t, y: a },
    { x: -t, y: t },
    { x: -a, y: t },
    { x: -a, y: -t },
    { x: -t, y: -t },
  ];
}

/**
 * Built-in stamp library, each shape sized to a unit radius so `scale` in mm
 * is the stamp's real size. A small closed set rather than a full motif
 * library editor: these are the shapes a carve actually reaches for, and each
 * one is a clean closed polygon the point-in-polygon test handles exactly.
 */
export const CARVE_PATTERNS = {
  diamond: [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ],
  circle: regularPolygon(16, 1),
  star: starPolygon(5, 1, 0.45),
  cross: crossPolygon(1, 0.4),
  hexagon: regularPolygon(6, 1),
} as const satisfies Record<string, Point[]>;

export type CarvePatternId = keyof typeof CARVE_PATTERNS;

/**
 * Resolve a pattern id to its unit shape, falling back to the default when
 * the id is unknown (a document could name a pattern this build lacks).
 */
export function carvePattern(id: CarveSettings['pattern']): Point[] {
  return CARVE_PATTERNS[id] ?? CARVE_PATTERNS[DEFAULT_CARVE.pattern];
}

/** A stamp, placed: its polygon in design space plus the box that holds it. */
interface PlacedStamp {
  polygon: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Place every stamp inside the shape, on a staggered grid along the fill
 * angle.
 *
 * The grid runs in the shape's rotated frame (so stamps follow the fill
 * direction the same way rows do), then each stamp is rotated back into
 * design space to be carved against the fill, which was generated there.
 * Returns stamps already in design space.
 *
 * `angle` is the fill's angle rather than part of the carve settings: the
 * carve is an effect on the fill, so its grid follows the fill's direction
 * while each stamp keeps its own `rotation` on top of that.
 */
function placeStamps(
  path: CompoundPath,
  pattern: Point[],
  options: CarveSettings,
  angle: number,
): PlacedStamp[] {
  const spacing = Math.max(CARVE_MIN_SPACING, options.spacing);
  const scale = Math.max(0.1, options.scale);
  if (pattern.length < 3 || path.rings.length === 0) return [];

  const center = boundsCenter(boundsOf(path.rings));
  const rotated = rotatePath(path, -toRadians(angle), center);
  const box = boundsOf(rotated.rings);
  if (box.maxX - box.minX <= 0 || box.maxY - box.minY <= 0) return [];

  // Normalize the stamp to a unit box so `scale` in mm is the stamp's real
  // size across (matching the control's label), then scale it. The built-in
  // shapes are drawn at radius 1, i.e. extent 2 across, so without this
  // `scale: 3` would produce a 6 mm stamp and the default spacing would let
  // neighbouring stamps tile into one continuous carve instead of leaving
  // fill between them.
  const stampBox = boundsOf([pattern]);
  const sc = boundsCenter(stampBox);
  const norm = Math.max(stampBox.maxX - stampBox.minX, stampBox.maxY - stampBox.minY) || 1;
  const stampLocal = pattern.map((p) => ({
    x: ((p.x - sc.x) / norm) * scale,
    y: ((p.y - sc.y) / norm) * scale,
  }));

  const stampRot = toRadians(options.rotation);
  // Rotate the grid back into design space around the shape centre.
  const backAngle = toRadians(angle);
  const stamps: PlacedStamp[] = [];

  for (let y = box.minY + spacing / 2; y <= box.maxY; y += spacing) {
    for (let x = box.minX + spacing / 2; x <= box.maxX; x += spacing) {
      // Stagger alternate rows for a brick-like arrangement.
      const cx = x + (Math.round((y - box.minY) / spacing) % 2 === 1 ? spacing / 2 : 0);

      // Only stamp where the grid point sits inside the shape.
      if (!pointInRing({ x: cx, y }, rotated.rings[0]!)) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const polygon = stampLocal.map((p) => {
        const r = rotatePoint(p, stampRot, 0, 0);
        const inGrid = { x: r.x + cx, y: r.y + y };
        const design = rotatePoint(inGrid, backAngle, center.x, center.y);
        if (design.x < minX) minX = design.x;
        if (design.y < minY) minY = design.y;
        if (design.x > maxX) maxX = design.x;
        if (design.y > maxY) maxY = design.y;
        return design;
      });

      if (polygon.length >= 3) stamps.push({ polygon, minX, minY, maxX, maxY });
    }
  }

  return stamps;
}

/**
 * Carve the built-in stamp pattern out of an already-generated fill.
 *
 * `base` is the plain fill stitches (design space); every stitch that falls
 * inside a placed stamp is removed. Stamps that would leave nothing are
 * simply no-ops. When `outline` is on, each carved stamp also gets a run
 * around its edge so the texture reads crisply.
 */
export function carveFill(
  base: RawStitch[],
  path: CompoundPath,
  options: CarveSettings = DEFAULT_CARVE,
  angle = 0,
  maxStitchLength = 12.1,
): RawStitch[] {
  if (!options.enabled) return base;

  // A stamp picked from the motif library carries its own shape; a built-in
  // is named by `pattern`. The carried shape wins so a design that uses a
  // library stamp still carves the same way if that entry is later renamed
  // or deleted.
  const pattern = options.motif?.points ? options.motif.points : carvePattern(options.pattern);
  const stamps = placeStamps(path, pattern, options, angle);
  if (stamps.length === 0) return base;

  const out: RawStitch[] = [];
  // How many consecutive fill stitches have just been carved away. A gap in
  // the fill must be crossed by a jump, not by sewing straight over it: the
  // machine cannot teleport, and a stitch drawn across the hole would both
  // fill the texture back in and far exceed the machine's step limit.
  let carvedRun = 0;
  for (const stitch of base) {
    // Jump/travel commands are never carved: they are not thread on fabric,
    // they are the needle moving between places, and dropping one would
    // collapse two separate sewn runs into a single stitched line.
    if (stitch.command !== 'stitch') {
      out.push(stitch);
      carvedRun = 0;
      continue;
    }

    let carved = false;
    for (const s of stamps) {
      if (stitch.x < s.minX || stitch.x > s.maxX || stitch.y < s.minY || stitch.y > s.maxY) {
        continue;
      }
      if (pointInRing(stitch, s.polygon)) {
        carved = true;
        break;
      }
    }

    if (carved) {
      carvedRun++;
      continue;
    }

    // Landing on solid fill again after removing stitches: lift the needle
    // over the hole so the machine travels there instead of sewing across it.
    if (carvedRun > 0) {
      out.push({ x: stitch.x, y: stitch.y, command: 'jump' });
      carvedRun = 0;
    }
    out.push(stitch);
  }

  if (options.outline) {
    // Visit stamps nearest-neighbour starting from where the fill ended, so
    // the machine never makes one long diagonal jump across the whole shape
    // to reach the first stamp, and travel between stamps stays short. Grid
    // order would wrap from the right edge of one row back to the left of the
    // next — a jump across the full width on every row.
    const anchor: Point = out.length > 0 ? out[out.length - 1]! : stamps[0]!.polygon[0]!;
    const remaining = stamps.slice();
    let current = anchor;

    while (remaining.length > 0) {
      let nearest = 0;
      let nearestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i]!.polygon[0]!;
        const d = Math.hypot(p.x - current.x, p.y - current.y);
        if (d < nearestD) {
          nearestD = d;
          nearest = i;
        }
      }
      const [s] = remaining.splice(nearest, 1);
      const first = s!.polygon[0]!;
      if (nearestD > 0.5) out.push({ x: first.x, y: first.y, command: 'jump' });

      const closed = [...s!.polygon, { ...first }];
      const run = runStitch(closed, { spacing: 0.6, maxStitchLength });
      // Drop the tiny closing hop back to the outline's own start when it
      // falls under the machine's useful minimum: it wastes a needle
      // penetration to close a gap too small to see, and the machine's
      // validation flags every one of them.
      if (run.length >= 2) {
        const a = run[run.length - 2]!;
        const b = run[run.length - 1]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < LIMITS.minUsefulStitchLength) run.pop();
      }
      for (const st of run) out.push(st);
      current = first;
    }
  }

  return out;
}
