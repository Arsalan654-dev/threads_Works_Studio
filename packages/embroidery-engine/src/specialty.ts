/**
 * Specialty stitch simulations.
 *
 * Standard home and commercial formats (DST, PES, EXP, JEF, VP3, TBF, HUS)
 * carry needle penetrations and colour changes - not sequin drops, bead
 * feeders or chenille loopers. These generators therefore produce the
 * *stitched appearance* of each specialty with ordinary penetrations:
 *
 *  - sequin: a small radial wheel at each sequin position,
 *  - beading: a bead loop threaded along a line or across a fill,
 *  - chenille: a dense tatami base with periodic pile loops,
 *  - schiffli: a lacy repeated flower with connecting thread.
 *
 * That distinction is surfaced to the operator as a validation note. The
 * artwork is genuinely different and can be sewn on a standard machine; it is
 * not a claim that a sequin-specific machine code was written.
 */

import type { CompoundPath, Point, StitchCommand } from './types.js';
import type { SpecialtyStitchType } from './types.js';
import { boundsOf, containsPoint, resample } from './geometry/index.js';
import { tatamiFill, type RawStitch } from './stitches/index.js';

export interface SpecialtyOptions {
  style: SpecialtyStitchType;
  spacing: number;
  angle: number;
  maxStitchLength: number;
  /** True for a run/bean object, which should bead or sequin a line. */
  line?: boolean;
  /** Set for a closed run outline. */
  closed?: boolean;
}

const SEW: StitchCommand = 'stitch';
const JUMP: StitchCommand = 'jump';
const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function circle(center: Point, radius: number, points: number, phase = 0): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points; i += 1) {
    const angle = phase + (i / points) * TAU;
    out.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return out;
}

/** True when the whole disc stays inside the shape, not merely its centre. */
function discInside(path: CompoundPath, center: Point, radius: number): boolean {
  if (!containsPoint(path, center)) return false;
  for (const p of circle(center, radius, 12)) {
    if (!containsPoint(path, p)) return false;
  }
  return true;
}

function gridCenters(path: CompoundPath, pitch: number, angleDegrees = 0): Point[] {
  const box = boundsOf(path.rings);
  const angle = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const radius = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
  const cols = Math.ceil((radius * 2) / pitch) + 2;
  const out: Point[] = [];
  for (let row = -cols; row <= cols; row += 1) {
    for (let col = -cols; col <= cols; col += 1) {
      const localX = col * pitch + (row % 2 === 0 ? 0 : pitch / 2);
      const localY = row * pitch;
      const p = {
        x: cx + localX * cos - localY * sin,
        y: cy + localX * sin + localY * cos,
      };
      if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) {
        out.push(p);
      }
    }
  }
  return out;
}

function appendCircle(
  out: RawStitch[],
  center: Point,
  radius: number,
  points: number,
  phase = 0,
): void {
  const ring = circle(center, radius, points, phase);
  for (const p of ring) out.push({ x: p.x, y: p.y, command: SEW });
  out.push({ x: center.x, y: center.y, command: SEW });
}

function sequinStitches(path: CompoundPath, options: SpecialtyOptions): RawStitch[] {
  const pitch = clamp(options.spacing, 3, 14);
  const radius = Math.min(3.2, pitch * 0.38);
  const out: RawStitch[] = [];
  let previous: Point | null = null;
  for (const center of gridCenters(path, pitch, options.angle)) {
    if (!discInside(path, center, radius)) continue;
    if (previous) {
      out.push({ x: center.x, y: center.y, command: JUMP });
    }
    out.push({ x: center.x, y: center.y, command: SEW });
    appendCircle(out, center, radius, 10, (options.angle * Math.PI) / 180);
    out.push({ x: center.x, y: center.y, command: SEW });
    previous = center;
  }
  return out;
}

function beadAt(out: RawStitch[], center: Point, radius: number, phase: number): void {
  out.push({ x: center.x, y: center.y, command: SEW });
  appendCircle(out, center, radius, 6, phase);
  out.push({ x: center.x, y: center.y, command: SEW });
}

function beadingStitches(path: CompoundPath, options: SpecialtyOptions): RawStitch[] {
  const pitch = clamp(options.spacing, 1.2, 10);
  const radius = Math.min(1.4, pitch * 0.3);
  const out: RawStitch[] = [];
  const phase = (options.angle * Math.PI) / 180;

  if (options.line && path.rings[0] && path.rings[0].length >= 2) {
    const line = resample(path.rings[0]!, Math.max(0.5, pitch));
    const centers = options.closed && line.length > 1 ? [...line, line[0]!] : line;
    let previous: Point | null = null;
    for (const center of centers) {
      if (previous && distance(previous, center) > 0.8) {
        // Thread between beads: the bead is strung, not a floating dot.
        out.push({ x: center.x, y: center.y, command: SEW });
      }
      beadAt(out, center, radius, phase);
      previous = center;
    }
    return out;
  }

  for (const center of gridCenters(path, pitch, options.angle)) {
    if (!discInside(path, center, radius)) continue;
    beadAt(out, center, radius, phase);
  }
  return out;
}

function chenilleStitches(path: CompoundPath, options: SpecialtyOptions): RawStitch[] {
  const spacing = clamp(options.spacing * 0.8, 0.25, 1.2);
  const base = tatamiFill(path, {
    angle: options.angle,
    spacing,
    pullCompensation: 0,
    jumpThreshold: options.maxStitchLength,
    serpentine: true,
    offsetPattern: true,
    edgeInset: 0,
  });
  const out: RawStitch[] = [];
  for (let i = 0; i < base.length; i += 1) {
    const current = base[i]!;
    out.push(current);
    if (current.command !== SEW || i === 0 || i === base.length - 1 || i % 7 !== 0) continue;
    const next = base[i + 1]!;
    const prev = base[i - 1]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.2) continue;
    // A short loop off the row creates a chenille-like pile when sewn with a
    // loop-tolerant thread path.
    const nx = (-dy / length) * 1.1;
    const ny = (dx / length) * 1.1;
    out.push({ x: current.x + nx, y: current.y + ny, command: SEW });
    out.push({ x: current.x, y: current.y, command: SEW });
  }
  return out;
}

function schiffliMotif(out: RawStitch[], center: Point, radius: number, phase: number): Point {
  out.push({ x: center.x, y: center.y, command: SEW });
  // Eight scalloped petals.
  for (let petal = 0; petal < 8; petal += 1) {
    const a = phase + (petal / 8) * TAU;
    const root = { x: center.x + Math.cos(a) * radius * 0.32, y: center.y + Math.sin(a) * radius * 0.32 };
    const tip = { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
    const sideA = a - 0.24;
    const sideB = a + 0.24;
    out.push({ x: root.x, y: root.y, command: SEW });
    out.push({
      x: center.x + Math.cos(sideA) * radius * 0.72,
      y: center.y + Math.sin(sideA) * radius * 0.72,
      command: SEW,
    });
    out.push({ x: tip.x, y: tip.y, command: SEW });
    out.push({
      x: center.x + Math.cos(sideB) * radius * 0.72,
      y: center.y + Math.sin(sideB) * radius * 0.72,
      command: SEW,
    });
    out.push({ x: center.x, y: center.y, command: SEW });
  }
  // Eyelet in the middle keeps the lace open and reinforces the motif.
  appendCircle(out, center, radius * 0.22, 8, phase);
  return center;
}

function schiffliStitches(path: CompoundPath, options: SpecialtyOptions): RawStitch[] {
  const pitch = clamp(options.spacing * 9, 9, 42);
  const radius = pitch * 0.4;
  const out: RawStitch[] = [];
  let previous: Point | null = null;
  const phase = (options.angle * Math.PI) / 180;
  for (const center of gridCenters(path, pitch, options.angle)) {
    if (!discInside(path, center, radius * 0.92)) continue;
    if (previous) {
      out.push({ x: center.x, y: center.y, command: JUMP });
      // A fine connecting bar turns the isolated flowers into lace.
      if (distance(previous, center) < pitch * 1.8) {
        out.push({ x: center.x, y: center.y, command: SEW });
      }
    }
    schiffliMotif(out, center, radius, phase);
    previous = center;
  }
  return out;
}

/** Generate the selected specialty simulation from an editable path. */
export function specialtyStitches(path: CompoundPath, options: SpecialtyOptions): RawStitch[] {
  if (path.rings.length === 0) return [];
  switch (options.style) {
    case 'sequin':
      return sequinStitches(path, options);
    case 'beading':
      return beadingStitches(path, options);
    case 'chenille':
      return chenilleStitches(path, options);
    case 'schiffli':
      return schiffliStitches(path, options);
    default:
      return [];
  }
}
