/**
 * Appliqué: the passes that turn a filled shape into a patch.
 *
 * A patch is not one stitch type. It is a small sequence:
 *
 *   1. a placement run, so the operator knows where the fabric goes,
 *   2. a stop, so the fabric can actually be put there,
 *   3. a wide tack that holds the patch while it is trimmed,
 *   4. another stop, for the trimming,
 *   5. a dense satin finish that covers the raw edge.
 *
 * Every one of those is ordinary stitch geometry, so the passes are generated
 * here and then travel through the same sequencing, validation and export as
 * any other object. The stops are `colorChange` records, which every encoder
 * already understands as "machine pauses here".
 *
 * Partial appliqué is the same sequence along one stretch of the outline
 * instead of all of it. The stretch is given as a fraction of the perimeter,
 * because a fraction survives later node edits while a vertex index would not.
 */

import type { AppliqueSettings, CompoundPath, Point, Ring, StitchParameters } from './types.js';
import { DEFAULT_APPLIQUE } from './types.js';
import { pathLength, signedArea } from './geometry/index.js';
import { runStitch, type RawStitch } from './stitches/index.js';

export interface AppliqueLimits {
  minWidth: number;
  maxWidth: number;
  minSpacing: number;
  maxSpacing: number;
  maxOffset: number;
}

/** Bounds the panel and the validator share. */
export const APPLIQUE_LIMITS: AppliqueLimits = {
  minWidth: 0.5,
  maxWidth: 20,
  minSpacing: 0.2,
  maxSpacing: 6,
  maxOffset: 10,
};

/** Settings with every optional field filled in. */
export function appliqueSettings(input: AppliqueSettings | undefined): AppliqueSettings | null {
  if (!input || !input.enabled) return null;
  return { ...DEFAULT_APPLIQUE, ...input };
}

/**
 * What is wrong with these settings, or null when they are usable.
 *
 * Returned as a sentence rather than a boolean so the panel can say what to
 * change; a disabled button with no reason is the worst kind of validation.
 */
export function appliqueProblem(input: AppliqueSettings | undefined): string | null {
  const s = appliqueSettings(input);
  if (!s) return null;

  if (s.mode === 'partial') {
    if (!(s.start >= 0 && s.start <= 1)) return 'Appliqué start must be between 0% and 100%.';
    if (!(s.length > 0 && s.length <= 1)) return 'Appliqué length must be between 1% and 100%.';
  }

  const width = (value: number, label: string): string | null => {
    if (
      !Number.isFinite(value) ||
      value < APPLIQUE_LIMITS.minWidth ||
      value > APPLIQUE_LIMITS.maxWidth
    ) {
      return `${label} must be between ${APPLIQUE_LIMITS.minWidth} and ${APPLIQUE_LIMITS.maxWidth} mm.`;
    }
    return null;
  };
  const spacing = (value: number, label: string): string | null => {
    if (
      !Number.isFinite(value) ||
      value < APPLIQUE_LIMITS.minSpacing ||
      value > APPLIQUE_LIMITS.maxSpacing
    ) {
      return `${label} must be between ${APPLIQUE_LIMITS.minSpacing} and ${APPLIQUE_LIMITS.maxSpacing} mm.`;
    }
    return null;
  };

  if (s.tack !== 'none') {
    const w = width(s.tackWidth, 'Tack width');
    if (w) return w;
    const sp = spacing(s.tackSpacing, 'Tack spacing');
    if (sp) return sp;
  }
  if (s.finish !== 'none') {
    const w = width(s.finishWidth, 'Finish width');
    if (w) return w;
    const sp = spacing(s.finishSpacing, 'Finish spacing');
    if (sp) return sp;
    if (!Number.isFinite(s.finishOffset) || Math.abs(s.finishOffset) > APPLIQUE_LIMITS.maxOffset) {
      return `Finish offset must be within ±${APPLIQUE_LIMITS.maxOffset} mm.`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

function inRing(ring: Ring, p: Point): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x > p.x) inside = !inside;
    }
  }
  return inside;
}

/** How many other rings enclose this one; even means an outer boundary. */
function depthOf(rings: Ring[], index: number): number {
  const ring = rings[index]!;
  const probe = ring[0]!;
  let depth = 0;
  for (let i = 0; i < rings.length; i++) {
    if (i === index) continue;
    if (inRing(rings[i]!, probe)) depth++;
  }
  return depth;
}

/** Wind a ring so an outer boundary is counter-clockwise and a hole clockwise. */
function woundForMaterial(ring: Ring, outer: boolean): Ring {
  const positive = signedArea(ring) > 0;
  return positive === outer ? ring.slice() : ring.slice().reverse();
}

/** Total length of a closed ring, including the closing segment. */
function ringLength(ring: Ring): number {
  return pathLength([...ring, ring[0]!]);
}

/** Point at a distance along a closed ring, wrapping past the end. */
function pointOnRing(ring: Ring, cumulative: number[], distance: number): Point {
  const total = cumulative[cumulative.length - 1]!;
  if (total < 1e-12) return { ...ring[0]! };
  let d = distance % total;
  if (d < 0) d += total;
  let i = 0;
  while (i < ring.length - 1 && cumulative[i + 1]! < d) i++;
  const a = ring[i]!;
  const b = ring[(i + 1) % ring.length]!;
  const span = cumulative[i + 1]! - cumulative[i]!;
  const t = span < 1e-12 ? 0 : (d - cumulative[i]!) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * One stretch of a ring, from `start` to `start + length` as a fraction of the
 * perimeter. The original vertices inside the stretch are kept so corners stay
 * sharp; the two ends are interpolated.
 */
export function ringSection(ring: Ring, start: number, length: number): Ring {
  if (length >= 0.999) return ring.slice();
  if (ring.length < 2) return [];

  const total = ringLength(ring);
  if (total < 1e-9) return [];

  const cumulative: number[] = [0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    cumulative.push(cumulative[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }

  const startD = (((start % 1) + 1) % 1) * total;
  const span = Math.min(1, Math.max(0, length)) * total;

  const picked: { distance: number; point: Point }[] = [
    { distance: 0, point: pointOnRing(ring, cumulative, startD) },
  ];

  for (let i = 0; i < ring.length; i++) {
    let rel = cumulative[i]! - startD;
    while (rel < 0) rel += total;
    while (rel >= total) rel -= total;
    if (rel > 1e-7 && rel < span - 1e-7) {
      picked.push({ distance: rel, point: ring[i]! });
    }
  }

  picked.sort((a, b) => a.distance - b.distance);
  picked.push({ distance: span, point: pointOnRing(ring, cumulative, startD + span) });

  const out: Point[] = [];
  for (const item of picked) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - item.point.x, last.y - item.point.y) < 1e-7) continue;
    out.push({ ...item.point });
  }
  return out;
}

/** A point and the direction of travel there. */
interface Sample {
  point: Point;
  dir: Point;
}

/**
 * Points every `spacing` mm along a polyline, including both ends.
 *
 * The direction is the direction of the segment the sample falls on, so a
 * zigzag across a corner follows the edge it is on rather than cutting the
 * corner's bisector.
 */
function sampleAlong(points: Point[], spacing: number, closed: boolean): Sample[] {
  const clean: Point[] = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) continue;
    clean.push(p);
  }
  if (closed && clean.length > 1) {
    const first = clean[0]!;
    const last = clean[clean.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) clean.push({ ...first });
  }
  if (clean.length < 2) return [];

  const cumulative: number[] = [0];
  for (let i = 0; i < clean.length - 1; i++) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    cumulative.push(cumulative[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total < 1e-9) return [];

  const step = Math.max(0.05, spacing);
  const out: Sample[] = [];
  let segment = 0;

  const at = (distance: number): Sample => {
    while (segment < clean.length - 2 && cumulative[segment + 1]! < distance) segment++;
    const a = clean[segment]!;
    const b = clean[segment + 1]!;
    const span = cumulative[segment + 1]! - cumulative[segment]!;
    const t = span < 1e-12 ? 0 : (distance - cumulative[segment]!) / span;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      point: { x: a.x + dx * t, y: a.y + dy * t },
      dir: { x: dx / len, y: dy / len },
    };
  };

  for (let d = 0; d < total; d += step) out.push(at(d));
  out.push(at(total));
  return out;
}

/**
 * A zigzag band along a path.
 *
 * This is what a satin border is: thread crossing the edge at a fixed width
 * and a fixed distance between penetrations. `sideBias` shifts the whole band
 * outward or inward, which is how the finish can sit more on the patch or more
 * on the garment.
 */
function zigzag(
  points: Point[],
  width: number,
  spacing: number,
  sideBias: number,
  closed: boolean,
): Point[] {
  const samples = sampleAlong(points, spacing, closed);
  const out: Point[] = [];
  const half = Math.abs(width) / 2;
  samples.forEach((sample, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const nx = sample.dir.y;
    const ny = -sample.dir.x;
    out.push({
      x: sample.point.x + nx * (sideBias + side * half),
      y: sample.point.y + ny * (sideBias + side * half),
    });
  });
  return out;
}

/** Shift a polyline sideways by `offset` mm, using averaged vertex normals. */
function shiftPolyline(points: Point[], offset: number, closed: boolean): Point[] {
  if (offset === 0) return points.map((p) => ({ ...p }));
  const n = points.length;
  if (n < 2) return points.map((p) => ({ ...p }));

  const normals: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const usePrev = closed || i > 0;
    const useNext = closed || i < n - 1;
    let nx = 0;
    let ny = 0;
    if (usePrev) {
      const dx = points[i]!.x - prev.x;
      const dy = points[i]!.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      nx += dy / len;
      ny += -dx / len;
    }
    if (useNext) {
      const dx = next.x - points[i]!.x;
      const dy = next.y - points[i]!.y;
      const len = Math.hypot(dx, dy) || 1;
      nx += dy / len;
      ny += -dx / len;
    }
    const len = Math.hypot(nx, ny) || 1;
    normals.push({ x: nx / len, y: ny / len });
  }

  return points.map((p, i) => ({
    x: p.x + normals[i]!.x * offset,
    y: p.y + normals[i]!.y * offset,
  }));
}

function runPass(points: Point[], closed: boolean, maxStitchLength: number): RawStitch[] {
  const path = closed ? [...points, points[0]!] : points;
  return runStitch(path, { spacing: 3, maxStitchLength });
}

function stitchPass(
  points: Point[],
  closed: boolean,
  kind: 'run' | 'zigzag' | 'satin',
  width: number,
  spacing: number,
  bias: number,
  maxStitchLength: number,
): RawStitch[] {
  if (kind === 'run') {
    return runPass(shiftPolyline(points, bias, closed), closed, maxStitchLength);
  }
  const band = zigzag(points, width, spacing, bias, closed);
  return band.map((p) => ({ x: p.x, y: p.y, command: 'stitch' }));
}

// ---------------------------------------------------------------------------
// The public generator
// ---------------------------------------------------------------------------

export interface AppliqueOptions {
  maxStitchLength: number;
}

interface Section {
  points: Point[];
  closed: boolean;
}

/** Every stretch of the shape the appliqué passes should follow. */
function sectionsOf(path: CompoundPath, settings: AppliqueSettings): Section[] {
  const rings = path.rings.filter((ring) => ring.length >= 3);
  const sections: Section[] = [];

  rings.forEach((ring, index) => {
    const depth = depthOf(rings, index);
    const outer = depth % 2 === 0;
    const wound = woundForMaterial(ring, outer);

    if (settings.mode === 'partial') {
      // A partial patch has one fabric edge; holes in the outline are not that
      // edge, so they are left to the normal fill.
      if (!outer) return;
      const arc = ringSection(wound, settings.start, settings.length);
      if (arc.length >= 2) sections.push({ points: arc, closed: settings.length >= 0.999 });
      return;
    }

    sections.push({ points: wound, closed: true });
  });

  return sections;
}

/**
 * Generate every appliqué pass for one object.
 *
 * Passes are ordered placement, tack, finish with a stop before each pass that
 * follows another. Sections within a pass are joined by a trim and a jump:
 * sewing from the end of one hole's outline to the start of the next would put
 * a thread across the work, and a long move would trip the machine's stitch
 * length limit.
 */
export function appliqueStitches(
  path: CompoundPath,
  input: AppliqueSettings,
  options: AppliqueOptions,
): RawStitch[] {
  const settings = appliqueSettings(input);
  if (!settings) return [];

  const sections = sectionsOf(path, settings);
  if (sections.length === 0) return [];

  const passes: { stitches: RawStitch[]; stopBefore: boolean }[] = [];

  if (settings.placement) {
    const stitches: RawStitch[] = [];
    for (const section of sections) {
      appendPass(stitches, runPass(section.points, section.closed, options.maxStitchLength));
    }
    passes.push({ stitches, stopBefore: false });
  }

  if (settings.tack !== 'none') {
    const stitches: RawStitch[] = [];
    for (const section of sections) {
      appendPass(
        stitches,
        stitchPass(
          section.points,
          section.closed,
          settings.tack,
          settings.tackWidth,
          settings.tackSpacing,
          0,
          options.maxStitchLength,
        ),
      );
    }
    passes.push({ stitches, stopBefore: true });
  }

  if (settings.finish !== 'none') {
    const stitches: RawStitch[] = [];
    for (const section of sections) {
      appendPass(
        stitches,
        stitchPass(
          section.points,
          section.closed,
          settings.finish,
          settings.finishWidth,
          settings.finishSpacing,
          settings.finishOffset,
          options.maxStitchLength,
        ),
      );
    }
    passes.push({ stitches, stopBefore: true });
  }

  const out: RawStitch[] = [];
  passes.forEach((pass, index) => {
    if (pass.stitches.length === 0) return;
    const first = pass.stitches[0]!;

    if (index > 0) {
      if (pass.stopBefore) {
        const stop = out[out.length - 1];
        out.push({
          x: stop ? stop.x : first.x,
          y: stop ? stop.y : first.y,
          command: 'colorChange',
        });
      }
      out.push({ x: first.x, y: first.y, command: 'trim' });
      out.push({ x: first.x, y: first.y, command: 'jump' });
    }

    appendPass(out, pass.stitches);
  });

  return out;
}

function appendPass(out: RawStitch[], items: RawStitch[]): void {
  for (let i = 0; i < items.length; i++) out.push(items[i]!);
}

/** A full settings object from whatever an older design stored. */
export function resolveApplique(
  params: Pick<StitchParameters, 'applique'>,
): AppliqueSettings | null {
  return appliqueSettings(params.applique);
}
