/**
 * HUS encoder and decoder (the format Husqvarna Viking machines take).
 *
 * Unlike the other machine formats in this package, there is no reference
 * *writer* to match: pyembroidery ships HUS as read-only. So the writer below
 * is checked the other way round - its files are pushed back through
 * pyembroidery's own HusReader and the stitches it reports are compared with
 * the ones we wrote. The decompression on this page is a literal-only pack
 * for that reader's block decoder, and the decoder itself is a direct port.
 *
 * File layout
 * -----------
 *   A 42-byte header plus two bytes per thread, then three separately
 *   compressed streams of one byte each per stitch: commands, x deltas and
 *   y deltas. There is no fixed record width, so the header's three offsets
 *   are the only way to find anything.
 *
 * Coordinates
 * -----------
 *   Each stitch is one signed byte per axis, so no single hop may exceed
 *   127 mm - anything longer is walked as a chain of jumps, exactly as the
 *   other formats do. y is carried upward in the deltas and comes back down
 *   on the way in, which mirrors the reference reader.
 *
 * Threads
 * -------
 *   A HUS palette slot is a number into the machine's thread library rather
 *   than a colour, so an exported thread is snapped to the nearest thread the
 *   machine owns - see husColors.ts.
 *
 * Compression
 * -----------
 *   The reference decoder reads a block as: a 16-bit big-endian element
 *   count, then two Huffman tables, then one byte per symbol. When both
 *   tables are built to carry a single default symbol, every symbol is the
 *   next raw byte, so a block of stored bytes is both valid and readable.
 *   Blocks hold at most 65535 symbols; a longer stream is chained.
 */

import type { ThreadColor } from '../types.js';
import {
  PY_COLOR_CHANGE,
  PY_END,
  PY_JUMP,
  PY_STOP,
  PY_STITCH,
  PY_TRIM,
  commandOf,
  normalizeStitches,
  type FormatStitch,
  type NormRow,
  type NormalizeSettings,
} from './normalize.js';
import { HUS_THREADS, husThreadColor, nearestHusThreadIndex } from './husColors.js';

export const HUS_EXTENSION = '.hus';
export const HUS_MIME = 'application/x-hus';

/**
 * Longest single hop the format can carry.
 *
 * One byte per axis, read as signed, so a delta may reach 127 - the same
 * limit Tajima and Melco share, and the reason all three split a long move
 * into a chain of jumps.
 */
export const HUS_MAX_STEP = 127;

/** Threads the machine can name; beyond these a colour is snapped to one. */
export const HUS_THREAD_COUNT = HUS_THREADS.length;

/** Byte length of the header, before the palette slots. */
export const HUS_HEADER_LENGTH = 0x2a;

const HUS_COMMAND_STITCH = 0x80;
const HUS_COMMAND_JUMP = 0x81;
const HUS_COMMAND_COLOR_CHANGE = 0x84;
const HUS_COMMAND_TRIM = 0x88;
const HUS_COMMAND_END = 0x90;

/** Longest run one compressed block may hold. */
const HUS_BLOCK_SYMBOLS = 0xffff;
/** Bytes the decoder spends on a block's tables before any payload. */
const HUS_BLOCK_HEADER_BYTES = 6;

/** The settings pyembroidery's own reader is written against. */
export const HUS_SETTINGS: NormalizeSettings = {
  maxJump: HUS_MAX_STEP,
  maxStitch: HUS_MAX_STEP,
  fullJump: false,
  round: false,
  threadChangeCommand: 'colorChange',
  explicitTrim: false,
};

export class HusEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HusEncodingError';
  }
}

export class HusDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HusDecodingError';
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

  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  u32(value: number): void {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }

  i16(value: number): void {
    this.u16(value < 0 ? value + 0x10000 : value);
  }

  raw(values: number[]): void {
    for (const value of values) this.bytes.push(value & 0xff);
  }

  /** Fill in a reserved 32-bit field once its target is known. */
  patch(at: number, value: number): void {
    const v = value >>> 0;
    this.bytes[at] = v & 0xff;
    this.bytes[at + 1] = (v >>> 8) & 0xff;
    this.bytes[at + 2] = (v >>> 16) & 0xff;
    this.bytes[at + 3] = (v >>> 24) & 0xff;
  }
}

/** Python's `int()` on a float: truncate towards zero, never round. */
function pyInt(value: number): number {
  return Math.trunc(value);
}

function signed8(value: number): number {
  return value > 127 ? value - 256 : value;
}

/**
 * Chain stored bytes into blocks the reference decoder accepts.
 *
 * Each block opens with its symbol count, then the two table tags that make
 * every symbol the next raw byte. The count is big-endian because that is how
 * the decoder reads its 16-bit fields.
 */
function packLiterals(data: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  for (let at = 0; at < data.length; at += HUS_BLOCK_SYMBOLS) {
    const chunk = data.slice(at, at + HUS_BLOCK_SYMBOLS);
    bytes.push((chunk.length >>> 8) & 0xff, chunk.length & 0xff, 0x02, 0xa0, 0x01, 0xfe, ...chunk);
  }
  return Uint8Array.from(bytes);
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
// writer
// --------------------------------------------------------------------------

/**
 * Encode a stitch sequence as a HUS file.
 *
 * The rows are first rewritten by the shared normaliser - HUS hops any move
 * past 127 mm and marks each colour change - and the three offsets in the
 * header are counted off the compressed streams that result.
 */
export function writeHus(
  stitches: readonly FormatStitch[],
  threads: readonly ThreadColor[],
  name = 'Untitled',
): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');
  if (!Array.isArray(threads)) throw new TypeError('threads must be an array');

  const { rows, threads: palette } = normalizeStitches(stitches, threads, HUS_SETTINGS);
  const bounds = boundsOf(rows);

  const commands: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  let xx = 0;
  let yy = 0;
  for (const row of rows) {
    // Each axis is a whole millimetre, so the needle's route is walked in
    // integer steps and no fractional drift builds up along a long run.
    const dx = pyInt(row.x - xx);
    const dy = pyInt(row.y - yy);
    xx += dx;
    yy += dy;

    const flags = commandOf(row.code);
    let cmd: number;
    if (flags === PY_STITCH) cmd = HUS_COMMAND_STITCH;
    else if (flags === PY_JUMP) cmd = HUS_COMMAND_JUMP;
    // HUS has no separate machine stop: the format spells a pause as a
    // colour change, which is what the engine's own colour change means.
    else if (flags === PY_COLOR_CHANGE || flags === PY_STOP) cmd = HUS_COMMAND_COLOR_CHANGE;
    else if (flags === PY_TRIM) cmd = HUS_COMMAND_TRIM;
    else if (flags === PY_END) {
      commands.push(HUS_COMMAND_END);
      xs.push(0);
      ys.push(0);
      break;
    } else continue;

    commands.push(cmd);
    xs.push(dx);
    // The deltas carry y upward, so it is negated on the way out and read
    // back down by the decoder.
    ys.push(-dy);
  }

  const commandBlob = packLiterals(commands);
  const xBlob = packLiterals(xs);
  const yBlob = packLiterals(ys);

  const w = new ByteWriter();
  // The magic a Husqvarna loader looks for; the reference reader reads the
  // field and ignores it, so any value passes there, but a machine checks.
  w.u32(0x00010002);
  w.u32(commands.length);
  w.u32(palette.length);

  // Extents, in whole millimetres, positive before negative.
  w.i16(pyInt(bounds.maxX));
  w.i16(pyInt(bounds.maxY));
  w.i16(pyInt(bounds.minX));
  w.i16(pyInt(bounds.minY));

  const commandOffsetAt = w.length;
  w.u32(0);
  const xOffsetAt = w.length;
  w.u32(0);
  const yOffsetAt = w.length;
  w.u32(0);

  // A short name, null-terminated, in the eight bytes the format allows.
  for (let i = 0; i < 8; i++) {
    w.u8(i < name.length ? name.charCodeAt(i) & 0x7f : 0);
  }
  w.u16(0); // reserved

  // Every palette slot points at a thread the machine can name.
  for (const thread of palette) w.u16(nearestHusThreadIndex(thread.hex));

  w.patch(commandOffsetAt, HUS_HEADER_LENGTH + palette.length * 2);
  w.patch(xOffsetAt, w.length + commandBlob.length);
  w.patch(yOffsetAt, w.length + commandBlob.length + xBlob.length);

  w.raw(Array.from(commandBlob));
  w.raw(Array.from(xBlob));
  w.raw(Array.from(yBlob));

  return Uint8Array.from(w.bytes);
}

// --------------------------------------------------------------------------
// reader
// --------------------------------------------------------------------------

class ByteReader {
  readonly data: Uint8Array;
  pos = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get length(): number {
    return this.data.length;
  }

  need(count: number, what: string): void {
    if (this.pos + count > this.data.length) {
      throw new HusDecodingError(`HUS file ends early: expected ${what} at ${this.pos}`);
    }
  }

  u8(): number {
    this.need(1, 'a byte');
    return this.data[this.pos++]!;
  }

  u16(): number {
    this.need(2, 'a 16-bit field');
    const value = this.data[this.pos]! | (this.data[this.pos + 1]! << 8);
    this.pos += 2;
    return value;
  }

  u32(): number {
    this.need(4, 'a 32-bit field');
    const value =
      this.data[this.pos]! |
      (this.data[this.pos + 1]! << 8) |
      (this.data[this.pos + 2]! << 16) |
      (this.data[this.pos + 3]! << 24);
    this.pos += 4;
    return value >>> 0;
  }

  i16(): number {
    const value = this.u16();
    return value > 0x7fff ? value - 0x10000 : value;
  }

  take(count: number, what: string): Uint8Array {
    this.need(count, what);
    const window = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return window;
  }

  skip(count: number, what: string): void {
    this.need(count, what);
    this.pos += count;
  }
}

/**
 * Expand one stored block chain back into bytes.
 *
 * A block opens with its symbol count and then two tables. When the first
 * table carries a single default symbol the second is never consulted, so
 * each symbol is simply the next raw byte - which is what makes a block of
 * stored bytes both valid and readable.
 */
function unpackLiterals(reader: ByteReader, byteLength: number, symbols: number): Uint8Array {
  const out = new Uint8Array(symbols);
  let written = 0;
  let at = reader.pos;
  const end = reader.pos + byteLength;

  while (written < symbols) {
    if (at + HUS_BLOCK_HEADER_BYTES > end) {
      throw new HusDecodingError(
        `HUS block runs out of header after ${written} of ${symbols} stitches`,
      );
    }
    const blockSymbols = (reader.data[at]! << 8) | reader.data[at + 1]!;
    at += HUS_BLOCK_HEADER_BYTES;
    for (let i = 0; i < blockSymbols && written < symbols; i++, written++) {
      if (at >= end) {
        throw new HusDecodingError(`HUS block runs out of payload after ${written} stitches`);
      }
      out[written] = reader.data[at++]!;
    }
  }

  reader.skip(byteLength, 'a compressed stream');
  return out;
}

export interface HusReadResult {
  stitches: FormatStitch[];
  threads: ThreadColor[];
  name: string;
}

/**
 * Parse a HUS file back into stitches.
 *
 * Mirrors pyembroidery's reader: the three streams are read as one byte per
 * axis, y comes back down from the upward-carrying deltas, and a trim record
 * may carry a move ahead of it - which is how the format cuts while stepping
 * to the next block's start.
 */
export function readHus(bytes: Uint8Array): HusReadResult {
  if (bytes.length < HUS_HEADER_LENGTH) {
    throw new HusDecodingError(
      `HUS file is ${bytes.length} bytes; the header is ${HUS_HEADER_LENGTH}`,
    );
  }
  const r = new ByteReader(bytes);

  r.u32(); // magic - the reference reads it and ignores it
  const stitchCount = r.u32();
  const colorCount = r.u32();
  r.skip(8, 'the extents');

  const commandOffset = r.u32();
  const xOffset = r.u32();
  const yOffset = r.u32();
  r.skip(8, 'the name field');
  r.skip(2, 'the reserved field');

  const threads: ThreadColor[] = [];
  for (let i = 0; i < colorCount; i++) threads.push(husThreadColor(r.u16()));

  const nameBytes = bytes.subarray(0x20, 0x28);
  let name = '';
  for (const byte of nameBytes) {
    if (byte === 0) break;
    name += String.fromCharCode(byte);
  }

  if (commandOffset > bytes.length || xOffset > bytes.length || yOffset > bytes.length) {
    throw new HusDecodingError('HUS file points past its own end');
  }

  r.pos = commandOffset;
  const commands = unpackLiterals(r, xOffset - commandOffset, stitchCount);
  r.pos = xOffset;
  const xs = unpackLiterals(r, yOffset - xOffset, stitchCount);
  r.pos = yOffset;
  const ys = unpackLiterals(r, bytes.length - yOffset, stitchCount);

  const stitches: FormatStitch[] = [];
  let x = 0;
  let y = 0;

  const push = (command: FormatStitch['command']): void => {
    stitches.push({ x, y, command });
  };

  for (let i = 0; i < stitchCount; i++) {
    const dx = signed8(xs[i]!);
    const dy = signed8(ys[i]!);
    switch (commands[i]) {
      case HUS_COMMAND_STITCH:
        x += dx;
        y -= dy;
        push('stitch');
        break;
      case HUS_COMMAND_JUMP:
        x += dx;
        y -= dy;
        push('jump');
        break;
      case HUS_COMMAND_COLOR_CHANGE:
        push('colorChange');
        break;
      case HUS_COMMAND_TRIM:
        // A cut may carry a step to the next block's start.
        if (dx !== 0 || dy !== 0) {
          x += dx;
          y -= dy;
          push('jump');
        }
        push('trim');
        break;
      case HUS_COMMAND_END:
      default:
        push('end');
        return { stitches, threads, name };
    }
  }

  return { stitches, threads, name };
}
