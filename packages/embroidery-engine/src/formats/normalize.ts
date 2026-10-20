/**
 * The stitch-sequence normalisation pyembroidery performs before the VP3 and
 * TBF writers run.
 *
 * Why port the *encoder* and not only the byte writer: when pyembroidery
 * writes one of these files it first rewrites the incoming rows - splitting
 * travels that run past the format's range, turning the thread-up state into
 * explicit cut records, opening each block with a colour change or a needle
 * set, and (for TBF) rounding every point to a whole millimetre. Reproducing
 * only the byte layout would not be enough: the rewritten row stream has to
 * match too, because the byte offsets are derived from it.
 *
 * The reference is MIT-licensed pyembroidery (Linus Yang / Taiki E), the
 * library Ink/Stitch builds on. This is a port of its `Transcoder` class -
 * `EmbEncoder.py` - not of any commercial product, and every setting below is
 * one the reference writer itself declares as its default, so both
 * implementations see the same input under the same rules.
 *
 * One behaviour is worth naming because it reads oddly: a move that runs past
 * the limit is split into evenly spaced hops (the distance divided by the
 * number of steps), not into hops of exactly the limit length. The byte-compare
 * harness is the arbiter here, and evenly spaced is what it measures.
 */

import type { Stitch, StitchCommand, ThreadColor } from '../types.js';
import { roundHalfToEven } from './moves.js';

/** Command codes in the numeric space pyembroidery uses internally. */
export const PY_STITCH = 0;
export const PY_JUMP = 1;
export const PY_TRIM = 2;
export const PY_STOP = 3;
export const PY_END = 4;
export const PY_COLOR_CHANGE = 5;
export const PY_NEEDLE_SET = 9;

/** Only the low byte of a row's code names the command; the rest is payload. */
const COMMAND_MASK = 0xff;
const FLAGS_MASK = ~COMMAND_MASK;

/** How many needles a machine can hold; the needle number wraps at this. */
const NEEDLE_LIMIT = 5;

/** Stands in for a thread when the design names fewer than it has blocks. */
const FILLER_THREAD: ThreadColor = { id: 'filler', code: '', name: 'Random', hex: '#000000' };

export interface NormalizeSettings {
  /** Longest travel a jump may cover before it is split. */
  maxJump: number;
  /** Longest single stitch before it is split (and, when sewing, sewn by hops). */
  maxStitch: number;
  /** Reach a post-trim position with a jump of its own; false for both formats. */
  fullJump: boolean;
  /** Round every input point to a whole millimetre before anything else. */
  round: boolean;
  /** Which record opens a block: VP3 a colour change, TBF a needle set. */
  threadChangeCommand: 'colorChange' | 'needleSet';
  /** Cut before each colour change (TBF) rather than letting the machine (VP3). */
  explicitTrim: boolean;
}

export interface NormRow {
  x: number;
  y: number;
  /** Command in the low byte, thread and needle packed above it. */
  code: number;
}

export interface NormalizedPattern {
  rows: NormRow[];
  /** VP3 keeps one thread per block; TBF keeps the whole source palette. */
  threads: ThreadColor[];
}

/**
 * A row the format layer will accept: an engine stitch, plus the plain machine
 * stop these two formats can carry on their own.
 *
 * The engine folds a stop into `colorChange` today, so nothing emits it yet,
 * but both byte streams are defined to carry one and the reference writer is
 * tested against it - accepting it here means the encoders need no rewrite
 * when the dedicated Stop tool lands.
 */
export type FormatStitch = Pick<Stitch, 'x' | 'y'> & {
  command: StitchCommand | 'stop';
};

/** The command an engine stitch row stands for in the reference's numbering. */
export function toPyCommand(command: FormatStitch['command']): number {
  switch (command) {
    case 'jump':
      return PY_JUMP;
    case 'trim':
      return PY_TRIM;
    case 'colorChange':
      return PY_COLOR_CHANGE;
    case 'stop':
      return PY_STOP;
    case 'end':
      return PY_END;
    case 'stitch':
    case 'lock':
    default:
      // A lock stitch is still a needle penetration, so it sews like a stitch.
      return PY_STITCH;
  }
}

/** Pack the thread and needle a change record carries above its command byte. */
export function encodeThreadChange(command: number, thread: number, needle: number): number {
  const t = ((thread & 0xff) + 1) << 8;
  const n = ((needle & 0xff) + 1) << 16;
  return (command & COMMAND_MASK) | n | t;
}

/** The command byte alone - what a writer switches on. */
export function commandOf(code: number): number {
  return code & COMMAND_MASK;
}

/** The needle number a change record carries, or null when it carries none. */
export function needleOf(code: number): number | null {
  const needle = ((code >> 16) & 0xff) - 1;
  return needle === -1 ? null : needle;
}

interface ChangeEntry {
  change: number | null;
  thread: number | null;
  needle: number | null;
  threadRef: ThreadColor;
}

/**
 * Plan one entry per block: which command opens it, which thread it sews and
 * which needle holds it. Port of `build_thread_change_sequence`.
 *
 * Blocks are keyed by a running index that stays 0 until the first stitch, so
 * a colour change *before* any sewing folds into block 0 rather than opening
 * a block of its own - which is why a design can start with a colour change
 * and still export as the single block it is.
 */
function buildChangeSequence(
  rows: readonly NormRow[],
  threads: readonly ThreadColor[],
  changeCommand: number,
): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const ensure = (key: number): ChangeEntry => {
    while (entries.length <= key) {
      entries.push({ change: null, thread: null, needle: null, threadRef: FILLER_THREAD });
    }
    return entries[key]!;
  };
  ensure(0);

  let currentIndex = 0;
  for (const row of rows) {
    const flags = row.code & COMMAND_MASK;
    if (currentIndex === 0 && flags === PY_STITCH) currentIndex = 1;
    if (flags === PY_COLOR_CHANGE || flags === PY_NEEDLE_SET) {
      ensure(currentIndex).change = flags;
      currentIndex += 1;
    }
  }

  let threadIndex = 0;
  let needleIndex = 1;
  for (const entry of entries) {
    if (entry.change === null) entry.change = changeCommand;
    if (entry.thread === null) {
      entry.thread = threadIndex;
      threadIndex += 1;
    }
    if (entry.needle === null) {
      let needle = needleIndex;
      if (needle > NEEDLE_LIMIT) needle = ((needle - 1) % NEEDLE_LIMIT) + 1;
      entry.needle = needle;
      needleIndex += 1;
    }
    entry.threadRef = threads[entry.thread] ?? FILLER_THREAD;
  }
  return entries;
}

/**
 * Emit the intermediate hops that keep a single move inside `maxLength`.
 *
 * The hops are spaced evenly across the move - `distance / steps` - and stop
 * one step short so the caller's own landing completes it. Nothing is emitted
 * when the move is already inside the limit.
 */
function interpolateGap(
  rows: NormRow[],
  needle: { x: number; y: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxLength: number,
  code: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!(Math.abs(dx) > maxLength || Math.abs(dy) > maxLength)) return;

  const stepsX = Math.ceil(Math.abs(dx / (maxLength * 1.0)));
  const stepsY = Math.ceil(Math.abs(dy / (maxLength * 1.0)));
  const steps = stepsX > stepsY ? stepsX : stepsY;
  const stepX = dx / steps;
  const stepY = dy / steps;
  let qx = x0;
  let qy = y0;
  for (let q = 1; q < steps; q++) {
    qx += stepX;
    qy += stepY;
    rows.push({ x: qx, y: qy, code });
    needle.x = qx;
    needle.y = qy;
  }
}

/**
 * Rewrite an incoming stitch sequence into the row stream the VP3 / TBF
 * writers consume, mirroring pyembroidery's transcoder step for step.
 *
 * Coordinates stay in the engine's millimetre, y-down space. The per-format y
 * negation happens inside each writer, exactly where the reference writer
 * performs it, so the numeric rows here are identical to the ones
 * pyembroidery's encoder produces from the same input.
 */
export function normalizeStitches(
  stitches: readonly FormatStitch[],
  threads: readonly ThreadColor[],
  settings: NormalizeSettings,
): NormalizedPattern {
  const source: NormRow[] = stitches.map((s) => ({
    x: settings.round ? roundHalfToEven(s.x) : s.x,
    y: settings.round ? roundHalfToEven(s.y) : s.y,
    code: toPyCommand(s.command),
  }));

  const changeCommand =
    settings.threadChangeCommand === 'needleSet' ? PY_NEEDLE_SET : PY_COLOR_CHANGE;
  const sequence = buildChangeSequence(source, threads, changeCommand);

  const rows: NormRow[] = [];
  // The destination palette: VP3 grows it one thread per block, TBF adopts the
  // whole source palette up front because it writes every thread it was given.
  const outThreads: ThreadColor[] =
    settings.threadChangeCommand === 'needleSet' ? [...threads] : [];

  const needle = { x: 0, y: 0 };
  let orderIndex = -1;
  let stateTrimmed = true;
  let highFlags = 0;

  const add = (code: number, x?: number, y?: number): void => {
    rows.push({
      x: x === undefined ? needle.x : x,
      y: y === undefined ? needle.y : y,
      code: code | highFlags,
    });
  };

  const nextChangeSequence = (): void => {
    orderIndex += 1;
    const entry = sequence[Math.min(orderIndex, sequence.length - 1)]!;
    if (settings.threadChangeCommand === 'colorChange') {
      outThreads.push(entry.threadRef);
      // The first block opens with no record at all; later ones announce it.
      if (orderIndex !== 0) {
        rows.push({
          x: needle.x,
          y: needle.y,
          code: encodeThreadChange(PY_COLOR_CHANGE, entry.thread!, entry.needle!),
        });
      }
    } else {
      // The palette already holds every thread, so only the block opens.
      rows.push({
        x: needle.x,
        y: needle.y,
        code: encodeThreadChange(PY_NEEDLE_SET, entry.thread!, entry.needle!),
      });
    }
    stateTrimmed = true;
  };

  const declareNotTrimmed = (): void => {
    if (orderIndex === -1) nextChangeSequence();
    stateTrimmed = false;
  };

  const stitchAt = (x: number, y: number): void => {
    add(PY_STITCH, x, y);
    needle.x = x;
    needle.y = y;
  };

  const jumpAt = (x: number, y: number): void => {
    add(PY_JUMP, x, y);
    needle.x = x;
    needle.y = y;
  };

  const trimHere = (): void => {
    add(PY_TRIM);
    stateTrimmed = true;
  };

  /** Reached a post-trim position: hop there, then land with a stitch. */
  const jumpToWithinStitchrange = (x: number, y: number): void => {
    interpolateGap(rows, needle, needle.x, needle.y, x, y, settings.maxJump, PY_JUMP);
    if (settings.fullJump && (needle.x !== x || needle.y !== y)) jumpAt(x, y);
  };

  /** Plain travel: hop there and leave the needle there. */
  const jumpTo = (x: number, y: number): void => {
    interpolateGap(rows, needle, needle.x, needle.y, x, y, settings.maxJump, PY_JUMP);
    jumpAt(x, y);
  };

  /**
   * Sew towards a target. This is the long-stitch contingency both formats
   * choose: hops carry the needle over anything too long to sew in one stitch,
   * so the fabric is not dragged by a single 40 mm penetration, and the target
   * is still landed with a stitch of its own.
   */
  const needleTo = (x: number, y: number): void => {
    interpolateGap(rows, needle, needle.x, needle.y, x, y, settings.maxStitch, PY_JUMP);
    stitchAt(x, y);
  };

  /** A cut before a colour change - only when the thread is actually down. */
  const tieOffTrimColorChange = (): void => {
    if (!stateTrimmed && settings.explicitTrim) trimHere();
    nextChangeSequence();
    stateTrimmed = true;
  };

  let lastCommand = -1;
  for (const row of source) {
    lastCommand = row.code & COMMAND_MASK;
    highFlags = row.code & FLAGS_MASK;
    const x = row.x;
    const y = row.y;

    if (lastCommand === PY_STITCH) {
      if (stateTrimmed) {
        declareNotTrimmed();
        jumpToWithinStitchrange(x, y);
        stitchAt(x, y);
      } else {
        // State-jumping collapses into this same move, because the engine
        // never emits a stitch break.
        needleTo(x, y);
      }
    } else if (lastCommand === PY_JUMP) {
      jumpTo(x, y);
    } else if (lastCommand === PY_TRIM) {
      // A cut while the thread is already up would be one in the wrong place,
      // so it is dropped rather than doubled.
      if (!stateTrimmed) trimHere();
    } else if (lastCommand === PY_STOP) {
      // A stop is a remark about where the needle stands, so it is recorded
      // wherever the needle already is - even if it is already up.
      add(PY_STOP);
      stateTrimmed = true;
    } else if (lastCommand === PY_COLOR_CHANGE || lastCommand === PY_NEEDLE_SET) {
      tieOffTrimColorChange();
    } else if (lastCommand === PY_END) {
      add(PY_END);
      stateTrimmed = true;
      break;
    }
  }
  if (lastCommand !== PY_END) {
    add(PY_END);
    stateTrimmed = true;
  }

  return { rows, threads: outThreads };
}
