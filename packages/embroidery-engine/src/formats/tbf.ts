/**
 * TBF encoder and decoder (the format Babylock, Bernina and some Barudan
 * machines take).
 *
 * Verified against pyembroidery's TbfWriter / TbfReader - the MIT-licensed
 * reference Ink/Stitch builds on - by byte-comparing both writers on identical
 * input. Every constant below is the reference's own default, so the two
 * implementations normalise the same rows and so land on the same bytes.
 *
 * File layout
 * -----------
 *   Fixed-size header (0x600) of tagged ASCII fields, then 3-byte records:
 *     80 stitch   90 jump   81 needle set   40 stop   86 trim   8F end
 *   Positions are deltas, y is negated, and the record stream ends with 0x1A.
 *
 * The header is read by **offset**, not by scanning, which is why the name
 * field is capped at 16 characters: the label at 0x83 and the needle order at
 * 0x10A sit at fixed places, so a longer name pushes everything past the
 * position a reader looks for. pyembroidery's writer lets a long name through
 * and its own reader then mis-reads the file; capping it is the one
 * deliberate deviation, and it is what makes the round-trip work.
 *
 * Coordinates
 * -----------
 *   The stitch deltas carry y upward, so y is negated on the way out and again
 *   on the way back in - mirroring pyembroidery, which is what keeps our files
 *   byte-identical to its and its reader able to read ours.
 */

import type { ThreadColor } from '../types.js';
import {
  PY_END,
  PY_JUMP,
  PY_NEEDLE_SET,
  PY_STOP,
  PY_STITCH,
  PY_TRIM,
  commandOf,
  needleOf,
  normalizeStitches,
  type FormatStitch,
  type NormRow,
  type NormalizeSettings,
} from './normalize.js';
import { roundHalfToEven } from './moves.js';

export const TBF_EXTENSION = '.tbf';
export const TBF_MIME = 'application/octet-stream';

/** Longest hop and longest stitch - the reference's uniform 12.7 mm limit. */
export const TBF_MAX_STEP = 127;

/** Characters the header's `LA:` label field holds. */
export const TBF_NAME_LENGTH = 16;

/** Byte offsets the reader trusts rather than parses. */
export const TBF_NAME_OFFSET = 0x83;
export const TBF_NEEDLE_ORDER_OFFSET = 0x10a;
export const TBF_THREADS_OFFSET = 0x20e;
export const TBF_RECORDS_OFFSET = 0x600;
const NEEDLE_ORDER_BYTES = 0x100;
const THREADS_PAD_TO = 0x376;
const HEADER_END = 0x600;

/** The settings pyembroidery's TbfWriter declares as its own defaults. */
export const TBF_SETTINGS: NormalizeSettings = {
  maxJump: TBF_MAX_STEP,
  maxStitch: TBF_MAX_STEP,
  fullJump: false,
  round: true,
  threadChangeCommand: 'needleSet',
  explicitTrim: true,
};

export class TbfEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TbfEncodingError';
  }
}

export class TbfDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TbfDecodingError';
  }
}

// --------------------------------------------------------------------------
// byte helpers
// --------------------------------------------------------------------------

class ByteWriter {
  readonly bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  utf8(value: string): void {
    for (const byte of new TextEncoder().encode(value)) this.bytes.push(byte);
  }

  /** Fill up to `target` with the spaces the header is padded with. */
  padTo(target: number): void {
    while (this.length < target) this.bytes.push(0x20);
  }

  raw(values: number[]): void {
    for (const value of values) this.bytes.push(value & 0xff);
  }
}

/** Python's `int()` on a float: truncate towards zero, never round. */
function pyInt(value: number): number {
  return Math.trunc(value);
}

/** `%d` on a positive quantity: truncate, then pad left to `width`. */
function num(value: number, width: number): string {
  return String(pyInt(Math.abs(value))).padStart(width, ' ');
}

/** `%-Ns`: pad right to `width`. */
function label(value: string, width: number): string {
  return value.padEnd(width, ' ').slice(0, width);
}

function hexChannel(hex: string, start: number): number {
  const parsed = Number.parseInt((hex || '#000000').replace('#', '').slice(start, start + 2), 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// --------------------------------------------------------------------------
// writer
// --------------------------------------------------------------------------

/**
 * Encode a stitch sequence as a TBF file.
 *
 * The rows are first rewritten by the shared normaliser - TBF rounds every
 * point to a whole millimetre, hops any move past 12.7 mm, cuts before each
 * colour change and opens each block with a needle set - and the byte offsets
 * in the header are counted off that rewritten stream.
 */
export function writeTbf(
  stitches: readonly FormatStitch[],
  threads: readonly ThreadColor[],
  name = 'Untitled',
): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');
  if (!Array.isArray(threads)) throw new TypeError('threads must be an array');

  const { rows, threads: palette } = normalizeStitches(stitches, threads, TBF_SETTINGS);
  const bounds = boundsOf(rows);
  const needleSets = rows.reduce(
    (count, row) => count + (commandOf(row.code) === PY_NEEDLE_SET ? 1 : 0),
    0,
  );

  const w = new ByteWriter();

  w.utf8('3.00');
  w.padTo(0x80);
  w.utf8(`LA:${label(name, TBF_NAME_LENGTH)}\r`);
  w.utf8(`ST:${num(rows.length, 7)}\r`);
  w.utf8(`CO:${num(needleSets, 3)}\r`);

  w.utf8(`+X:${num(bounds.maxX, 5)}\r`);
  w.utf8(`-X:${num(bounds.minX, 5)}\r`);
  w.utf8(`+Y:${num(bounds.maxY, 5)}\r`);
  w.utf8(`-Y:${num(bounds.minY, 5)}\r`);

  const last = rows[rows.length - 1];
  const ax = last ? pyInt(last.x) : 0;
  const ay = last ? -pyInt(last.y) : 0;
  w.utf8(ax >= 0 ? `AX:+${num(ax, 5)}\r` : `AX:-${num(ax, 5)}\r`);
  w.utf8(ay >= 0 ? `AY:+${num(ay, 5)}\r` : `AY:-${num(ay, 5)}\r`);

  // TP and JC are not documented; the reference writes these and files that
  // work carry them, so they are reproduced rather than invented.
  w.utf8(`TP:${label('EG/', 32)}\r`);
  w.utf8('JC:3\r');

  // The order the machine loads needles in, one byte per needle, filled from
  // the needle each block announces.
  w.utf8('DO:');
  const needleOrder: number[] = new Array<number>(NEEDLE_ORDER_BYTES).fill(0);
  let orderIndex = 0;
  for (const row of rows) {
    if (commandOf(row.code) !== PY_NEEDLE_SET) continue;
    if (orderIndex >= needleOrder.length) break;
    needleOrder[orderIndex] = needleOf(row.code) ?? 0;
    orderIndex += 1;
  }
  for (const needle of needleOrder) w.u8(needle);
  w.utf8('\r');

  // The whole palette, used threads or not - a machine operator needs the
  // threads the design was set up with even when one goes unused.
  w.utf8('DA:');
  if (palette.length > 0) {
    for (const thread of palette) {
      w.u8(0x45);
      w.u8(hexChannel(thread.hex, 0));
      w.u8(hexChannel(thread.hex, 2));
      w.u8(hexChannel(thread.hex, 4));
      w.u8(0x20);
    }
  }

  w.padTo(THREADS_PAD_TO);
  w.raw([0x0d, 0x1a]);
  w.padTo(HEADER_END);

  writeRecords(w, rows);

  return Uint8Array.from(w.bytes);
}

function writeRecords(w: ByteWriter, rows: readonly NormRow[]): void {
  let xx = 0;
  let yy = 0;
  for (const row of rows) {
    // Both axes are rounded as the needle walks, so a chain of fractional hops
    // lands where this encoder says it does rather than drifting.
    const dx = pyInt(roundHalfToEven(row.x - xx));
    const dy = pyInt(roundHalfToEven(row.y - yy));
    xx += dx;
    yy += dy;

    const flags = commandOf(row.code);
    let cmd: number;
    if (flags === PY_STITCH) cmd = 0x80;
    else if (flags === PY_JUMP) cmd = 0x90;
    else if (flags === PY_STOP) cmd = 0x40;
    else if (flags === PY_TRIM) cmd = 0x86;
    else if (flags === PY_NEEDLE_SET) cmd = 0x81;
    else if (flags === PY_END) {
      w.raw([0x00, 0x00, 0x8f]);
      w.u8(0x1a);
      return;
    } else continue;

    w.u8(dx);
    w.u8(-dy);
    w.u8(cmd);
  }
  // No end row in the input still gets its terminator.
  w.u8(0x1a);
}

function boundsOf(rows: readonly NormRow[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (rows.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    if (row.x > maxX) maxX = row.x;
    if (row.x < minX) minX = row.x;
    if (row.y > maxY) maxY = row.y;
    if (row.y < minY) minY = row.y;
  }
  return { minX, minY, maxX, maxY };
}

// --------------------------------------------------------------------------
// reader
// --------------------------------------------------------------------------

function signed8(value: number): number {
  return value > 127 ? value - 256 : value;
}

export interface TbfReadResult {
  stitches: FormatStitch[];
  threads: ThreadColor[];
  name: string;
}

/**
 * Parse a TBF file back into stitches.
 *
 * The header is read at the offsets the format fixes, not by searching for
 * tags, because that is how a machine's loader finds them: the label, needle
 * order, palette and record stream each have a place they must occupy.
 *
 * Two reference quirks are kept because a file written by anything else has to
 * survive the same trip: a jump record carrying `(0, 0)` reads back as a cut
 * (it is how the format spells "there is nowhere to go"), and a needle record
 * whose stored needle is 0 reads back as a plain stop.
 */
export function readTbf(bytes: Uint8Array): TbfReadResult {
  if (bytes.length < TBF_RECORDS_OFFSET) {
    throw new TbfDecodingError(
      `TBF file is ${bytes.length} bytes; the header alone is ${TBF_RECORDS_OFFSET}`,
    );
  }

  const name = latin1(bytes.subarray(TBF_NAME_OFFSET, TBF_NAME_OFFSET + 0x10)).trim();
  const needleOrder = bytes.subarray(
    TBF_NEEDLE_ORDER_OFFSET,
    TBF_NEEDLE_ORDER_OFFSET + NEEDLE_ORDER_BYTES,
  );

  const threads: ThreadColor[] = [];
  let at = TBF_THREADS_OFFSET;
  while (at + 5 <= bytes.length && bytes[at] === 0x45) {
    const rgb = ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    at += 5;
    threads.push({
      id: `tbf-${threads.length}`,
      code: '',
      name: '',
      hex: `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`,
    });
  }

  const stitches: FormatStitch[] = [];
  let x = 0;
  let y = 0;
  let needleCount = 0;

  const push = (command: FormatStitch['command']): void => {
    stitches.push({ x, y, command });
  };

  at = TBF_RECORDS_OFFSET;
  for (;;) {
    if (at + 3 > bytes.length) break;
    const dx = bytes[at]!;
    const dy = bytes[at + 1]!;
    const ctrl = bytes[at + 2]!;
    at += 3;

    if (ctrl === 0x80) {
      x += signed8(dx);
      y -= signed8(dy);
      push('stitch');
      continue;
    }
    if (ctrl === 0x81) {
      const stored = needleOrder[needleCount] ?? 0;
      needleCount += 1;
      // A needle with no number is a stop, not a thread change.
      push(stored === 0 ? 'stop' : 'colorChange');
      continue;
    }
    if (ctrl === 0x90) {
      if (dx === 0 && dy === 0) {
        push('trim');
      } else {
        x += signed8(dx);
        y -= signed8(dy);
        push('jump');
      }
      continue;
    }
    if (ctrl === 0x40) {
      push('stop');
      continue;
    }
    if (ctrl === 0x86) {
      push('trim');
      continue;
    }
    break; // 0x8F ends the design; anything unrecognised ends it too.
  }
  push('end');

  return { stitches, threads, name };
}

function latin1(window: Uint8Array): string {
  let out = '';
  for (const byte of window) out += String.fromCharCode(byte);
  return out;
}
