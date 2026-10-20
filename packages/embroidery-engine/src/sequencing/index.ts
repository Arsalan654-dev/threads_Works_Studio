/**
 * Sequencing: turns per-object stitch groups into one ordered machine sequence.
 *
 * Responsibilities
 * ---------------
 *  - Order objects by colour block, then by their position in the object list
 *  - Insert tie-ins at object entry and tie-offs at object exit
 *  - Plan connectors (travel) between objects
 *  - Decide jump vs trim vs color change
 *  - Assign sequence numbers and color indices
 *
 * Travel decisions are made here and nowhere else, because only this module
 * can see two neighbouring objects at once.
 */

import type { EmbroideryObject, Point, Stitch, StitchCommand, ThreadColor } from '../types.js';
import type { RawStitch } from '../stitches/index.js';
import { boundsCenter, pathBounds } from '../geometry/index.js';
import {
  chooseEntry,
  chooseExit,
  distance,
  tieIn,
  tieOff,
  DEFAULT_LOCK,
} from '../underlay/index.js';

/** Settings that govern how the needle moves between objects. */
export interface ConnectorSettings {
  /** Travel shorter than this is sewn as a normal move rather than a jump. */
  jumpThreshold: number;
  /** Distance above which the machine should trim instead of dragging thread. */
  trimThreshold: number;
  /** Emit an explicit trim before every color change. */
  trimOnChange: boolean;
}

export const DEFAULT_CONNECTORS: ConnectorSettings = {
  jumpThreshold: 4,
  trimThreshold: 30,
  trimOnChange: true,
};

/** One object's worth of generated raw stitches, ready to be sequenced. */
export interface ObjectStitchGroup {
  objectId: string;
  colorIndex: number;
  /** Raw stitches produced by the generator (underlay first, then top stitch). */
  stitches: RawStitch[];
  entry: Point | null;
  exit: Point | null;
  /** Whether lock stitches should wrap this object. */
  lockStart: boolean;
  lockEnd: boolean;
  lockLength: number;
  lockCount: number;
}

export interface SequenceOptions {
  connectors: ConnectorSettings;
  /** When true, objects are regrouped by colour to minimise thread changes. */
  optimizeColors: boolean;
}

/**
 * Build the final ordered stitch sequence.
 *
 * Color changes are counted from actual `colorChange` commands, not from the
 * number of distinct colors - a design that reuses a color still only needs
 * the machine stops it actually performs.
 */
export function buildSequence(
  groups: ObjectStitchGroup[],
  palette: ThreadColor[],
  options: Partial<SequenceOptions> = {},
): { stitches: Stitch[]; colorChanges: number } {
  const opts: SequenceOptions = {
    connectors: { ...DEFAULT_CONNECTORS, ...options.connectors },
    optimizeColors: options.optimizeColors ?? false,
  };

  const ordered = opts.optimizeColors ? sortByColor(groups) : groups;
  const stitches: Stitch[] = [];
  let sequence = 0;
  let colorChanges = 0;
  let cursor: Point | null = null;
  let currentColor = -1;
  let firstOfColor = true;

  const push = (
    x: number,
    y: number,
    command: StitchCommand,
    colorIndex: number,
    objectId: string | null,
  ): void => {
    stitches.push({ x, y, command, colorIndex, objectId, sequence: sequence++ });
  };

  for (const group of ordered) {
    if (group.stitches.length === 0) continue;

    const isNewColor = group.colorIndex !== currentColor;

    // --- color change / trim planning -----------------------------------
    // `cursor` is assigned unconditionally at the end of every group pass, so
    // `currentColor !== -1` already implies it is set. Folding it into the
    // condition lets TypeScript see that instead of trusting the invariant.
    if (currentColor !== -1 && isNewColor && cursor) {
      if (opts.connectors.trimOnChange) {
        push(cursor.x, cursor.y, 'trim', currentColor, null);
      }
      push(cursor.x, cursor.y, 'colorChange', group.colorIndex, null);
      colorChanges++;
      firstOfColor = true;
    }
    if (currentColor === -1) firstOfColor = true;
    currentColor = group.colorIndex;

    // --- entry -----------------------------------------------------------
    const entry = group.entry ?? group.stitches[0]!;
    const exit = group.exit ?? group.stitches[group.stitches.length - 1]!;

    // --- connector from the previous object ------------------------------
    if (cursor) {
      const gap = Math.hypot(entry.x - cursor.x, entry.y - cursor.y);
      if (gap > opts.connectors.trimThreshold) {
        push(entry.x, entry.y, 'trim', group.colorIndex, null);
        push(entry.x, entry.y, 'jump', group.colorIndex, group.objectId);
      } else if (gap > opts.connectors.jumpThreshold) {
        push(entry.x, entry.y, 'jump', group.colorIndex, group.objectId);
      }
      // Otherwise the first real stitch covers the move on its own.
    }

    // --- tie-in ----------------------------------------------------------
    if (group.lockStart) {
      const locks = tieIn(entry, { length: group.lockLength, count: group.lockCount });
      for (const l of locks) push(l.x, l.y, l.command, group.colorIndex, group.objectId);
    }

    // --- body ------------------------------------------------------------
    let previous: RawStitch | null = null;
    for (const raw of group.stitches) {
      if (previous && raw.command === 'stitch') {
        const d = Math.hypot(raw.x - previous.x, raw.y - previous.y);
        if (d > opts.connectors.jumpThreshold && d < 0.001) continue;
      }
      push(raw.x, raw.y, raw.command, group.colorIndex, group.objectId);
      previous = raw;
    }

    // --- tie-off ---------------------------------------------------------
    if (group.lockEnd) {
      const locks = tieOff(exit, { length: group.lockLength, count: group.lockCount });
      for (const l of locks) push(l.x, l.y, l.command, group.colorIndex, group.objectId);
    }

    cursor = { x: exit.x, y: exit.y };
    void firstOfColor;
  }

  return { stitches, colorChanges };
}

/**
 * Order objects to minimise thread changes.
 *
 * Colour blocks are chosen greedily from the needle's current position: the
 * nearest colour block goes next, and within a block the nearest object goes
 * next. That keeps the two costs a digitizer actually pays - colour changes and
 * travel - down at the same time, which a plain "sort by colour" cannot do (it
 * happily hops the hoop once per colour).
 *
 * The result is deterministic: distances are compared with a tolerance and ties
 * keep the incoming order.
 */
function sortByColor(groups: ObjectStitchGroup[]): ObjectStitchGroup[] {
  if (groups.length <= 1) return groups.slice();

  const buckets = new Map<number, ObjectStitchGroup[]>();
  const colorOrder: number[] = [];
  for (const g of groups) {
    let list = buckets.get(g.colorIndex);
    if (!list) {
      list = [];
      buckets.set(g.colorIndex, list);
      colorOrder.push(g.colorIndex);
    }
    list.push(g);
  }
  if (colorOrder.length === 1) return groups.slice();

  const out: ObjectStitchGroup[] = [];
  const unused = new Set(colorOrder);
  // The machine starts at the design origin, so the first block is chosen
  // from there rather than from an arbitrary first object.
  let cursor: Point = { x: 0, y: 0 };

  while (unused.size > 0) {
    let bestColor = -1;
    let bestDistance = Infinity;
    for (const color of unused) {
      for (const group of buckets.get(color)!) {
        const target = group.entry ?? group.exit;
        if (!target) {
          if (bestColor === -1) bestColor = color;
          continue;
        }
        const d = distance(cursor, target);
        if (d < bestDistance - 1e-9) {
          bestDistance = d;
          bestColor = color;
        }
      }
    }
    if (bestColor === -1) bestColor = colorOrder.find((c) => unused.has(c))!;

    const remaining = buckets.get(bestColor)!.slice();
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const target = remaining[i]!.entry ?? remaining[i]!.exit;
        if (!target) continue;
        const d = distance(cursor, target);
        if (d < bestD - 1e-9) {
          bestD = d;
          bestIndex = i;
        }
      }
      const [group] = remaining.splice(bestIndex, 1);
      const chosen = group!;
      out.push(chosen);
      cursor = chosen.exit ?? chosen.entry ?? cursor;
    }
    unused.delete(bestColor);
  }

  return out;
}

/**
 * Decide entry and exit points for an object.
 *
 * When the object carries explicit entry/exit settings from the user those
 * win; otherwise the engine picks the boundary point nearest the incoming
 * cursor and the farthest point from it, which keeps travel short and avoids
 * the needle doubling back over its own work.
 */
export function resolveEntryExit(
  object: EmbroideryObject,
  from: Point | null,
): { entry: Point | null; exit: Point | null } {
  const explicitEntry = object.entryExit.entry;
  const explicitExit = object.entryExit.exit;

  const entry = explicitEntry ?? chooseEntry(object.path, from);
  const exit = explicitExit ?? chooseExit(object.path, entry);

  return { entry, exit };
}

export interface ObjectOrderOptions {
  /**
   * Keep colour blocks together: finish the current thread before changing.
   *
   * On, it is automatic colour sort; off, it is pure travel optimisation and
   * the machine may change thread more often.
   */
  respectColors?: boolean;
}

/**
 * Reorder objects into a shorter sewing path.
 *
 * Greedy nearest-neighbour from the design origin, using each object's bounding
 * centre as its travel point. With `respectColors` the next object is chosen
 * from the current thread colour while any remains, which trades a little
 * travel for a colour change the operator never has to make. Ties keep the
 * incoming order, so the result is deterministic and an already-short path is
 * left alone.
 */
export function optimizeObjectOrder(
  objects: EmbroideryObject[],
  options: ObjectOrderOptions = {},
): EmbroideryObject[] {
  const ordered = [...objects].sort((a, b) => a.order - b.order);
  if (ordered.length <= 1) return ordered.map((o) => ({ ...o }));

  const remaining = ordered.map((object, index) => {
    const bounds = pathBounds(object.path);
    const centre = boundsCenter(bounds);
    return {
      object,
      index,
      center: Number.isFinite(centre.x) && Number.isFinite(centre.y) ? centre : { x: 0, y: 0 },
    };
  });

  const result: typeof remaining = [];
  const cursor: Point = { x: 0, y: 0 };
  let currentColor: number | null = null;

  while (remaining.length > 0) {
    let candidates = remaining;
    if (options.respectColors && currentColor !== null) {
      const same = remaining.filter((r) => r.object.colorIndex === currentColor);
      if (same.length > 0) candidates = same;
    }

    let best = candidates[0]!;
    let bestDistance = distance(cursor, best.center);
    for (const candidate of candidates) {
      const d = distance(cursor, candidate.center);
      if (d < bestDistance - 1e-9) {
        bestDistance = d;
        best = candidate;
      }
    }

    result.push(best);
    currentColor = best.object.colorIndex;
    cursor.x = best.center.x;
    cursor.y = best.center.y;
    remaining.splice(remaining.indexOf(best), 1);
  }

  return result.map((entry, order) => ({ ...entry.object, order }));
}

export { DEFAULT_LOCK };
