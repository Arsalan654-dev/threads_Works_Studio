/**
 * VP3 encoder and decoder.
 *
 * Verified against pyembroidery's Vp3Writer / Vp3Reader - the MIT-licensed
 * reference Ink/Stitch builds on - by byte-comparing the output of both on
 * identical input. The reference is the specification here: where its layout
 * looks odd, this file reproduces it, because a machine that reads one reads
 * the other.
 *
 * File layout
 * -----------
 *   "%vsm%\0"                       magic, then a UTF-16BE producer string
 *   00 02 00 [u32 end-of-file]      file block, patched at the end
 *   [str16]                         global notes (empty)
 *   [i32 x4]                        right, -top, left, -bottom in 0.01 mm
 *   [i32] stitch count sans end, [u8 x5] constants, [u8] design count
 *     00 03 00 [u32 end-of-design]  design block
 *       centre, extents, notes, "xxPP", producer, [u16] colour block count
 *         00 05 00 [u32 end-of-block]  colour block
 *           start-from-centre, thread, block shift, stitches, [u8] 0
 *
 * Coordinates
 * -----------
 *   The centre, extents, start position and block shift are y-up (0.01 mm),
 *   so they negate y. The stitch deltas deliberately do **not**: they stay in
 *   the design's own y-down millimetres. That asymmetry is the reference's,
 *   and mirroring it is what makes our files byte-identical to it and its
 *   reader able to read ours back unchanged.
 */

import type { ThreadColor } from '../types.js';
import {
  PY_COLOR_CHANGE,
  PY_END,
  PY_JUMP,
  PY_NEEDLE_SET,
  PY_STOP,
  PY_STITCH,
  PY_TRIM,
  commandOf,
  normalizeStitches,
  type FormatStitch,
  type NormRow,
  type NormalizeSettings,
} from './normalize.js';

export const VP3_EXTENSION = '.vp3';
export const VP3_MIME = 'application/octet-stream';

/** The six bytes every VP3 file opens with. */
export const VP3_MAGIC = '%vsm%';

/** Longest travel before the encoder hops, and longest single stitch. */
export const VP3_MAX_JUMP = 3200;
export const VP3_MAX_STITCH = 255;

/** The settings pyembroidery's Vp3Writer declares as its own defaults. */
export const VP3_SETTINGS: NormalizeSettings = {
  maxJump: VP3_MAX_JUMP,
  maxStitch: VP3_MAX_STITCH,
  fullJump: false,
  round: false,
  threadChangeCommand: 'colorChange',
  explicitTrim: false,
};

const PRODUCER = 'Produced by     Software Ltd';

export class Vp3EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Vp3EncodingError';
  }
}

export class Vp3DecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Vp3DecodingError';
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
    const v = value & 0xffff;
    this.bytes.push((v >>> 8) & 0xff, v & 0xff);
  }

  u24(value: number): void {
    const v = value & 0xffffff;
    this.bytes.push((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  u32(value: number): void {
    const v = value >>> 0;
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  raw(values: number[]): void {
    for (const v of values) this.bytes.push(v & 0xff);
  }

  utf8(value: string): void {
    this.raw(utf8Bytes(value));
  }

  /** Length-prefixed UTF-16BE - VP3's header strings. */
  str16(value: string): void {
    const units = utf16Units(value);
    this.u16(units.length * 2);
    for (const unit of units) this.u16(unit);
  }

  /** Length-prefixed UTF-8 - VP3's thread strings. */
  str8(value: string): void {
    const data = utf8Bytes(value);
    this.u16(data.length);
    this.raw(data);
  }

  /** Reserve a 32-bit field to be filled in once its block is closed. */
  placeholder(): number {
    const at = this.length;
    this.u32(0);
    return at;
  }

  /**
   * Fill a reserved field with the byte distance from it to here.
   *
   * The reference writes `current position - field position - 4`, so the
   * number counts the bytes after the field itself and is patched in place
   * once the block it describes is closed.
   */
  patch(at: number): void {
    const v = (this.length - at - 4) >>> 0;
    this.bytes[at] = (v >>> 24) & 0xff;
    this.bytes[at + 1] = (v >>> 16) & 0xff;
    this.bytes[at + 2] = (v >>> 8) & 0xff;
    this.bytes[at + 3] = v & 0xff;
  }
}

function utf8Bytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

/** UTF-16 code units, one per BMP character; surrogates survive as they are. */
function utf16Units(value: string): number[] {
  const units: number[] = [];
  for (let i = 0; i < value.length; i++) units.push(value.charCodeAt(i));
  return units;
}

/** Python's `int()` on a float: truncate towards zero, never round. */
function pyInt(value: number): number {
  return Math.trunc(value);
}

// --------------------------------------------------------------------------
// writer
// --------------------------------------------------------------------------

interface ColorBlock {
  stitches: NormRow[];
  thread: ThreadColor;
}

/** Split the normalised rows at each colour change, reference-style. */
function colorBlocks(rows: NormRow[], threads: ThreadColor[]): ColorBlock[] {
  const blocks: ColorBlock[] = [];
  let lastIndex = 0;
  for (let pos = 0; pos < rows.length; pos++) {
    if (commandOf(rows[pos]!.code) !== PY_COLOR_CHANGE) continue;
    blocks.push({
      stitches: rows.slice(lastIndex, pos),
      thread: threads[blocks.length] ?? filler(),
    });
    lastIndex = pos;
  }
  blocks.push({
    stitches: rows.slice(lastIndex),
    thread: threads[blocks.length] ?? filler(),
  });
  return blocks;
}

function filler(): ThreadColor {
  return { id: 'filler', code: '', name: 'Random', hex: '#000000' };
}

function boundsOf(rows: NormRow[]): { minX: number; minY: number; maxX: number; maxY: number } {
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
  if (rows.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function writeThread(w: ByteWriter, thread: ThreadColor): void {
  w.u8(0x01); // one colour, no transition
  w.u8(0x00);
  w.u24(hexToRgb(thread.hex));
  w.u8(0x00);
  w.u8(0x00);
  w.u8(0x00);
  w.u8(0x05); // no parts
  w.u8(0x28); // Rayon 40-weight
  w.str8(thread.code);
  w.str8(thread.name !== '' ? thread.name : hexToRgbString(thread.hex));
  w.str8(thread.brand ?? '');
}

function hexToRgb(hex: string): number {
  const parsed = Number.parseInt((hex || '#000000').replace('#', ''), 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hexToRgbString(hex: string): string {
  const value = (hex || '#000000').toUpperCase();
  return value.startsWith('#') ? value : `#${value}`;
}

function writeStitchesBlock(
  w: ByteWriter,
  stitches: NormRow[],
  firstX: number,
  firstY: number,
): void {
  w.u8(0x00);
  w.u8(0x01);
  w.u8(0x00);
  const placeholder = w.placeholder();
  w.u8(0x0a);
  w.u8(0xf6);
  w.u8(0x00);

  let lastX = firstX;
  let lastY = firstY;

  for (const stitch of stitches) {
    const flags = commandOf(stitch.code);
    const alt = stitch.code & ~0xff;
    if (flags === PY_END) {
      // The machine does not autotrim, so the design ends with an explicit cut.
      w.u8(0x80);
      w.u8(0x03);
      break;
    }
    if (flags === PY_COLOR_CHANGE) continue;
    if (flags === PY_NEEDLE_SET) continue;
    if (flags === PY_TRIM) {
      w.u8(0x80);
      w.u8(0x03);
      continue;
    }
    if (flags === PY_STOP || flags === PY_JUMP) {
      // VP3 has no jump or stop record: the needle simply moves there without
      // blocking the needlebar, so the position chain is left untouched.
      continue;
    }

    const dx = pyInt(stitch.x - lastX);
    const dy = pyInt(stitch.y - lastY);
    lastX += dx;
    lastY += dy;
    if (flags !== PY_STITCH) continue;

    if (dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127 && alt === 0) {
      w.u8(dx);
      w.u8(dy);
    } else {
      w.u8(0x80);
      w.u8(0x01);
      w.u16(dx);
      w.u16(dy);
      w.u8(0x80);
      w.u8(0x02);
    }
  }
  w.patch(placeholder);
}

function writeColorBlock(
  w: ByteWriter,
  first: boolean,
  centerX: number,
  centerY: number,
  stitches: NormRow[],
  thread: ThreadColor,
): void {
  w.u8(0x00);
  w.u8(0x05);
  w.u8(0x00);
  const placeholder = w.placeholder();

  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;
  if (stitches.length > 0) {
    const head = stitches[0]!;
    const tail = stitches[stitches.length - 1]!;
    firstX = first ? 0 : head.x;
    firstY = first ? 0 : head.y;
    lastX = tail.x;
    lastY = tail.y;
  }

  const startX = firstX - centerX;
  const startY = -(firstY - centerY);
  w.u32(pyInt(startX) * 100);
  w.u32(pyInt(startY) * 100);

  writeThread(w, thread);

  const shiftX = lastX - firstX;
  const shiftY = -(lastY - firstY);
  w.u32(pyInt(shiftX) * 100);
  w.u32(pyInt(shiftY) * 100);

  writeStitchesBlock(w, stitches, firstX, firstY);

  w.u8(0x00);
  w.patch(placeholder);
}

/**
 * Encode a stitch sequence as a VP3 file.
 *
 * The rows are first rewritten by the shared normaliser, because VP3's byte
 * offsets are derived from that rewritten stream: colour changes become block
 * boundaries, an over-long move is hopped, and the cut that ends a block is
 * recorded where the needle stands rather than where the input said.
 */
export function writeVp3(
  stitches: readonly FormatStitch[],
  threads: readonly ThreadColor[],
): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');
  if (!Array.isArray(threads)) throw new TypeError('threads must be an array');

  const { rows, threads: blockThreads } = normalizeStitches(stitches, threads, VP3_SETTINGS);
  const blocks = colorBlocks(rows, blockThreads);
  const bounds = boundsOf(rows);
  const ends = rows.reduce((count, row) => count + (commandOf(row.code) === PY_END ? 1 : 0), 0);

  const w = new ByteWriter();

  w.utf8('%vsm%');
  w.u8(0);
  w.str16(PRODUCER);

  // --- file block ---
  w.u8(0x00);
  w.u8(0x02);
  w.u8(0x00);
  const fileBlock = w.placeholder();
  w.str16('');

  w.u32(pyInt(bounds.maxX * 100));
  w.u32(pyInt(bounds.minY * -100));
  w.u32(pyInt(bounds.minX * 100));
  w.u32(pyInt(bounds.maxY * -100));

  w.u32(rows.length - ends);
  w.u8(0);
  w.u8(blocks.length);
  w.u8(12);
  w.u8(0);
  w.u8(1); // one design

  // --- design block ---
  w.u8(0x00);
  w.u8(0x03);
  w.u8(0x00);
  const designBlock = w.placeholder();

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const centerX = bounds.maxX - halfWidth;
  const centerY = bounds.maxY - halfHeight;

  w.u32(pyInt(centerX) * 100);
  w.u32(pyInt(centerY) * -100);
  w.u8(0);
  w.u8(0);
  w.u8(0);

  w.u32(pyInt(halfWidth) * -100);
  w.u32(pyInt(halfWidth) * 100);
  w.u32(pyInt(halfHeight) * -100);
  w.u32(pyInt(halfHeight) * 100);
  w.u32(pyInt(width) * 100);
  w.u32(pyInt(height) * 100);
  w.str16('');

  w.u8(0x64);
  w.u8(0x64);
  w.u32(4096);
  w.u32(0);
  w.u32(0);
  w.u32(4096);
  w.u8(0x78);
  w.u8(0x78);
  w.u8(0x50);
  w.u8(0x50);
  w.u8(0x01);
  w.u8(0x00);
  w.str16(PRODUCER);

  w.u16(blocks.length);
  let first = true;
  for (const block of blocks) {
    writeColorBlock(w, first, centerX, centerY, block.stitches, block.thread);
    first = false;
  }
  w.patch(designBlock);
  w.patch(fileBlock);

  return Uint8Array.from(w.bytes);
}

// --------------------------------------------------------------------------
// reader
// --------------------------------------------------------------------------

class ByteReader {
  pos = 0;

  constructor(private readonly data: Uint8Array) {}

  get remaining(): number {
    return this.data.length - this.pos;
  }

  need(count: number, what: string): void {
    if (this.pos + count > this.data.length) {
      throw new Vp3DecodingError(`VP3 file ended while reading ${what}`);
    }
  }

  u8(): number {
    this.need(1, 'a byte');
    return this.data[this.pos++]!;
  }

  u16(): number {
    this.need(2, 'a 16-bit value');
    const value = (this.data[this.pos]! << 8) | this.data[this.pos + 1]!;
    this.pos += 2;
    return value;
  }

  u24(): number {
    this.need(3, 'a 24-bit value');
    const value =
      (this.data[this.pos]! << 16) | (this.data[this.pos + 1]! << 8) | this.data[this.pos + 2]!;
    this.pos += 3;
    return value >>> 0;
  }

  u32(): number {
    this.need(4, 'a 32-bit value');
    const value =
      ((this.data[this.pos]! << 24) |
        (this.data[this.pos + 1]! << 16) |
        (this.data[this.pos + 2]! << 8) |
        this.data[this.pos + 3]!) >>>
      0;
    this.pos += 4;
    return value;
  }

  /** Signed 32-bit, the way Python's reader recovers it. */
  i32(): number {
    const value = this.u32();
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  skip(count: number, what: string): void {
    this.need(count, what);
    this.pos += count;
  }

  /** Consume the next `count` bytes as a raw window, without copying. */
  take(count: number, what: string): Uint8Array {
    this.need(count, what);
    const window = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return window;
  }

  str16(): string {
    const byteLength = this.u16();
    this.need(byteLength, 'a UTF-16 string');
    const units: number[] = [];
    for (let i = 0; i + 1 < byteLength; i += 2) {
      units.push((this.data[this.pos + i]! << 8) | this.data[this.pos + i + 1]!);
    }
    this.pos += byteLength;
    return String.fromCharCode(...units);
  }

  str8(): string {
    const byteLength = this.u16();
    this.need(byteLength, 'a UTF-8 string');
    const slice = this.data.subarray(this.pos, this.pos + byteLength);
    this.pos += byteLength;
    return new TextDecoder('utf-8').decode(slice);
  }

  str16Bytes(): number {
    const byteLength = this.u16();
    this.skip(byteLength, 'a UTF-16 string');
    return byteLength;
  }
}

function signed8(value: number): number {
  return value > 127 ? value - 256 : value;
}

function signed16(hi: number, lo: number): number {
  const value = ((hi & 0xff) << 8) | (lo & 0xff);
  return value > 0x7fff ? value - 0x10000 : value;
}

export interface Vp3ReadResult {
  stitches: FormatStitch[];
  threads: ThreadColor[];
}

/**
 * Parse a VP3 file back into stitches.
 *
 * Mirrors pyembroidery's reader: the stitch deltas are accumulated exactly as
 * they are stored (y-down, the same way the writer walks them), while the
 * centre and start position round-trip through the y-up header fields. Jumps
 * do not survive VP3 at all - the writer drops them - so an imported design
 * comes back as stitches, cuts and colour changes.
 */
export function readVp3(bytes: Uint8Array): Vp3ReadResult {
  const r = new ByteReader(bytes);
  const stitches: FormatStitch[] = [];
  const threads: ThreadColor[] = [];
  const position = { x: 0, y: 0 };
  const push = (command: FormatStitch['command']): void => {
    stitches.push({ x: position.x, y: position.y, command });
  };

  r.skip(6, 'the %vsm% magic');
  r.str16Bytes(); // producer
  r.skip(7, 'the file block marker');
  r.str16Bytes(); // notes
  r.skip(32, 'the file block header');
  const centerX = r.i32() / 100;
  const centerY = -(r.i32() / 100);
  r.skip(27, 'the design block header');
  r.str16Bytes(); // notes
  r.skip(24, 'the design block trailer');
  r.str16Bytes(); // producer
  const countColors = r.u16();

  for (let i = 0; i < countColors; i++) {
    readColorBlock(r, threads, position, push, centerX, centerY);
    // The colour change belongs after the block it closes; the final block
    // needs none, because the design just ends.
    if (i + 1 < countColors) push('colorChange');
  }
  push('end');

  return { stitches, threads };
}

function readColorBlock(
  r: ByteReader,
  threads: ThreadColor[],
  position: { x: number; y: number },
  push: (command: FormatStitch['command']) => void,
  centerX: number,
  centerY: number,
): void {
  r.skip(3, 'the colour block marker');
  const distance = r.u32();
  const blockEnd = distance + r.pos;

  const startX = r.i32() / 100;
  const startY = -(r.i32() / 100);
  const absX = startX + centerX;
  const absY = startY + centerY;
  // A block that starts clear of the zero point travels there first. The
  // reference tests *both* axes, so a block sitting on either centre line
  // never moves; keeping that test is what makes this reader agree with it.
  if (absX !== 0 && absY !== 0) {
    position.x = absX;
    position.y = absY;
    push('jump');
  }

  threads.push(readThread(r, threads.length));

  // 15 bytes of block shift and reserved field, then the three-byte marker
  // that opens the stitch run; only what follows is payload.
  r.skip(15, 'the block shift');
  r.skip(3, 'the stitch block marker');
  const stitchBytesLength = blockEnd - r.pos;
  if (stitchBytesLength < 0) {
    throw new Vp3DecodingError('VP3 colour block ends before its stitches');
  }
  const data = r.take(stitchBytesLength, 'stitch bytes');

  let i = 0;
  while (i < data.length - 1) {
    const a = data[i]!;
    const b = data[i + 1]!;
    i += 2;
    if ((a & 0xff) !== 0x80) {
      position.x += signed8(a);
      position.y += signed8(b);
      push('stitch');
      continue;
    }
    if (b === 0x01) {
      const dx = signed16(data[i]!, data[i + 1]!);
      i += 2;
      const dy = signed16(data[i]!, data[i + 1]!);
      i += 2;
      position.x += dx;
      position.y += dy;
      push('stitch');
      // The closing 80 02, whatever it holds.
      i += 2;
    } else if (b === 0x03) {
      push('trim');
    }
  }
}

function readThread(r: ByteReader, index: number): ThreadColor {
  const colors = r.u8();
  r.u8(); // transition
  let rgb = 0;
  for (let m = 0; m < colors; m++) {
    rgb = r.u24();
    r.u8(); // parts
    r.u16(); // colour length
  }
  r.u8(); // thread type
  r.u8(); // weight
  const catalog = r.str8();
  const description = r.str8();
  const brand = r.str8();
  return {
    id: `vp3-${index}`,
    code: catalog,
    name: description,
    hex: `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`,
    brand: brand === '' ? undefined : brand,
  };
}
