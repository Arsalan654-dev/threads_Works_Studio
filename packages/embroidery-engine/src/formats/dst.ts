/**
 * Tajima DST encoder and decoder.
 *
 * Verified against the documented format (libembroidery / Tajima spec notes).
 *
 * File layout
 * -----------
 *   bytes 0   .. 511  ASCII header: 125 bytes of data, space padded to 512
 *   bytes 512 ..      3-byte stitch records, repeated
 *   terminator         0x00 0x00 0xF3
 *
 * Header (records separated by CR = 0x0D, every number space padded)
 *   LA:<name 16s>  ST:<count 7d>  CO:<changes 3d>
 *   +X:<5d> -X:<5d> +Y:<5d> -Y:<5d>   extents in 0.1 mm
 *   AX:+<5d> AY:+<5d> MX:+<5d> MY:+<5d>
 *   PD:<6s> 0x1A
 *
 * ST counts the records the file contains, terminator included, not the
 * number of stitches a machine will sew - which is what every other writer
 * reports there too.
 *
 * Stitch record
 *   Relative X and Y are ternary encoded in 0.1 mm units, valid over
 *   [-121, +121] i.e. 12.1 mm. Byte 2 carries the command:
 *     0x03 normal | 0x83 jump | 0xC3 color change | 0xF3 end
 *
 * Units
 * -----
 * Coordinates are millimeters inside the engine and converted to 0.1 mm here,
 * which is the only place machine unit scaling happens.
 */

import type { Bounds, Stitch, StitchCommand } from '../types.js';
import { planMove } from './moves.js';

export const DST_HEADER_SIZE = 512;
export const DST_HEADER_DATA_SIZE = 125;
export const DST_MAX_STEP = 121; // 12.1 mm in 0.1 mm units
export const DST_MM_PER_UNIT = 0.1;

const CMD_NORMAL = 0x03;
const CMD_JUMP = 0x83;
const CMD_STOP = 0xc3;
const CMD_END = 0xf3;

/**
 * The needle pop a DST file uses in place of a cut command: three jumps that
 * end exactly where they started, so the needle lifts and cuts without the
 * design moving by a tenth of a millimetre.
 *
 * It is written in machine space (y up), which is why the design's own
 * (2, 2), (-4, -4), (2, 2) appear here with their y already turned over.
 * The count follows the format's `trim_at` default of three.
 */
const DST_TRIM_POP: ReadonlyArray<readonly [number, number]> = [
  [2, -2],
  [-4, 4],
  [2, -2],
];

export interface DstWriteOptions {
  /** Design name, max 8 characters recommended (16 hard limit). */
  name?: string;
  /** Number of threads in the design. Used for the CO header field. */
  colorCount?: number;
}

export class DstEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DstEncodingError';
  }
}

/**
 * Latin-1 helpers.
 *
 * The DST header is defined over 8-bit characters, not UTF-8. Node's `Buffer`
 * would do this for us, but the engine also runs in the browser (the client
 * encodes and previews designs without a round trip to the server), where
 * `Buffer` does not exist. These two helpers keep the package isomorphic.
 */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function latin1Text(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/**
 * Encode a signed ternary coordinate pair into 3 bytes.
 *
 * Byte 2's command slot is left clear so the caller can OR the command in.
 * Throws when the value cannot be represented - callers must split the move
 * first, because silently clamping would move the needle to the wrong place.
 */
export function encodeTernary(x: number, y: number): [number, number, number] {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new DstEncodingError(`ternary coordinates must be integers (got ${x}, ${y})`);
  }
  if (x > DST_MAX_STEP || x < -DST_MAX_STEP) {
    throw new DstEncodingError(`x out of range [-121,121]: ${x}`);
  }
  if (y > DST_MAX_STEP || y < -DST_MAX_STEP) {
    throw new DstEncodingError(`y out of range [-121,121]: ${y}`);
  }

  const b0 = 0;
  const b1 = 0;
  const b2 = 0;
  let byte0 = b0;
  let byte1 = b1;
  let byte2 = b2;

  // --- X -------------------------------------------------------------
  if (x >= 41) {
    byte2 |= 0x04;
    x -= 81;
  }
  if (x <= -41) {
    byte2 |= 0x08;
    x += 81;
  }
  if (x >= 14) {
    byte1 |= 0x04;
    x -= 27;
  }
  if (x <= -14) {
    byte1 |= 0x08;
    x += 27;
  }
  if (x >= 5) {
    byte0 |= 0x04;
    x -= 9;
  }
  if (x <= -5) {
    byte0 |= 0x08;
    x += 9;
  }
  if (x >= 2) {
    byte1 |= 0x01;
    x -= 3;
  }
  if (x <= -2) {
    byte1 |= 0x02;
    x += 3;
  }
  if (x >= 1) {
    byte0 |= 0x01;
    x -= 1;
  }
  if (x <= -1) {
    byte0 |= 0x02;
    x += 1;
  }
  if (x !== 0) throw new DstEncodingError(`x residue not zero: ${x}`);

  // --- Y -------------------------------------------------------------
  if (y >= 41) {
    byte2 |= 0x20;
    y -= 81;
  }
  if (y <= -41) {
    byte2 |= 0x10;
    y += 81;
  }
  if (y >= 14) {
    byte1 |= 0x20;
    y -= 27;
  }
  if (y <= -14) {
    byte1 |= 0x10;
    y += 27;
  }
  if (y >= 5) {
    byte0 |= 0x20;
    y -= 9;
  }
  if (y <= -5) {
    byte0 |= 0x10;
    y += 9;
  }
  if (y >= 2) {
    byte1 |= 0x80;
    y -= 3;
  }
  if (y <= -2) {
    byte1 |= 0x40;
    y += 3;
  }
  if (y >= 1) {
    byte0 |= 0x80;
    y -= 1;
  }
  if (y <= -1) {
    byte0 |= 0x40;
    y += 1;
  }
  if (y !== 0) throw new DstEncodingError(`y residue not zero: ${y}`);

  return [byte0, byte1, byte2];
}

/** Decode a 3-byte record back into a relative move in 0.1 mm units. */
export function decodeTernary(b0: number, b1: number, b2: number): { x: number; y: number } {
  let x = 0;
  let y = 0;

  if (b0 & 0x01) x += 1;
  if (b0 & 0x02) x -= 1;
  if (b0 & 0x04) x += 9;
  if (b0 & 0x08) x -= 9;
  if (b0 & 0x80) y += 1;
  if (b0 & 0x40) y -= 1;
  if (b0 & 0x20) y += 9;
  if (b0 & 0x10) y -= 9;

  if (b1 & 0x01) x += 3;
  if (b1 & 0x02) x -= 3;
  if (b1 & 0x04) x += 27;
  if (b1 & 0x08) x -= 27;
  if (b1 & 0x80) y += 3;
  if (b1 & 0x40) y -= 3;
  if (b1 & 0x20) y += 27;
  if (b1 & 0x10) y -= 27;

  if (b2 & 0x04) x += 81;
  if (b2 & 0x08) x -= 81;
  if (b2 & 0x20) y += 81;
  if (b2 & 0x10) y -= 81;

  return { x, y };
}

/**
 * Split a move that exceeds the representable range into chained hops.
 *
 * DST cannot encode a single move beyond 12.1 mm, so long jumps and travel
 * stitches must be broken up rather than truncated.
 */
export function splitMove(dx: number, dy: number): Array<{ x: number; y: number }> {
  return planMove(dx, dy, DST_MAX_STEP).map((hop) => ({ x: hop.x, y: hop.y }));
}

/**
 * Format one header field, space padded the way Tajima machines and every
 * other writer read it back: right-aligned in its own width, with an explicit
 * sign on the four fields that carry one. Zero padding is accepted by some
 * readers and rejected by others, so the field is written the way the format
 * defines it rather than the way a number would print.
 */
function padNumber(value: number, width: number, signed = false): string {
  const digits = String(Math.abs(Math.round(value))).padStart(width, ' ');
  if (!signed) return digits;
  return `${value < 0 ? '-' : '+'}${digits}`;
}

/** Build the 512-byte ASCII header. */
export function buildHeader(params: {
  name: string;
  stitchCount: number;
  colorCount: number;
  bounds: Bounds;
  ax?: number;
  ay?: number;
}): Uint8Array {
  const name = (params.name || 'Untitled')
    .replace(/[^A-Za-z0-9_ -]/g, '')
    .slice(0, 16)
    .padEnd(16, ' ');

  const lines: string[] = [];
  lines.push(`LA:${name}\r`);
  lines.push(`ST:${padNumber(params.stitchCount, 7)}\r`);
  lines.push(`CO:${padNumber(Math.max(0, params.colorCount - 1), 3)}\r`);
  lines.push(`+X:${padNumber(Math.round(params.bounds.maxX * 10), 5)}\r`);
  lines.push(`-X:${padNumber(Math.round(Math.abs(params.bounds.minX) * 10), 5)}\r`);
  lines.push(`+Y:${padNumber(Math.round(params.bounds.maxY * 10), 5)}\r`);
  lines.push(`-Y:${padNumber(Math.round(Math.abs(params.bounds.minY) * 10), 5)}\r`);
  lines.push(`AX:${padNumber(params.ax ?? 0, 5, true)}\r`);
  lines.push(`AY:${padNumber(params.ay ?? 0, 5, true)}\r`);
  lines.push(`MX:${padNumber(0, 5, true)}\r`);
  lines.push(`MY:${padNumber(0, 5, true)}\r`);
  lines.push(`PD:******\r`);
  lines.push('\x1a');

  const headerBytes = latin1Bytes(lines.join(''));
  if (headerBytes.length > DST_HEADER_DATA_SIZE) {
    throw new DstEncodingError(`header too long: ${headerBytes.length} > ${DST_HEADER_DATA_SIZE}`);
  }

  // Space padded, per the spec: the header block is always exactly 512 bytes.
  const out = new Uint8Array(DST_HEADER_SIZE).fill(0x20);
  out.set(headerBytes, 0);
  return out;
}

function commandByteFor(command: StitchCommand): number {
  switch (command) {
    case 'stitch':
      return CMD_NORMAL;
    case 'jump':
      return CMD_JUMP;
    case 'trim':
      // DST has no dedicated trim; a trim is expressed as a jump, and the
      // machine's trim behaviour is configured on the machine itself.
      return CMD_JUMP;
    case 'colorChange':
      return CMD_STOP;
    case 'lock':
      return CMD_NORMAL;
    case 'end':
      return CMD_END;
    default:
      return CMD_NORMAL;
  }
}

export interface DstBoundsResult {
  bounds: Bounds;
}

/** Compute the bounding box of a stitch list in millimeters. */
export function boundsOfStitches(stitches: Stitch[]): Bounds {
  if (stitches.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of stitches) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Encode a generated stitch sequence as a Tajima DST file.
 *
 * Millimeter coordinates are scaled to 0.1 mm units, moves beyond the
 * representable range are chained, and the file is terminated correctly.
 */
export function writeDst(stitches: Stitch[], options: DstWriteOptions = {}): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');

  const records: Array<[number, number, number]> = [];

  // The header describes the path the needle actually takes, measured on the
  // same rounded 0.1 mm grid the records use. That is why the extents are
  // taken over the *landings* rather than over the points the design names:
  // a long travel reaches its destination through intermediate hops, and one
  // of those can sit further out than any named point does.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const measure = (ux: number, uy: number): void => {
    if (ux < minX) minX = ux;
    if (ux > maxX) maxX = ux;
    if (uy < minY) minY = uy;
    if (uy > maxY) maxY = uy;
  };

  let px = 0; // target of the row being written, in 0.1 mm
  let py = 0;
  let lx = 0; // where the needle has actually landed, in 0.1 mm
  let ly = 0;
  // What the header's ST field counts: one per row the encoded stream holds,
  // terminator included. It is not the number of records - a cut is one row
  // that writes three - and it is not the number of stitches the design was
  // handed either, because a long move becomes several rows of hops.
  let rows = 0;
  // False while the needle is out of the fabric - after a cut or a colour
  // stop - so that the first stitch of a block is travelled to with jumps
  // instead of being sewn towards it.
  let sewing = false;
  let ended = false;

  for (const stitch of stitches) {
    // The design space has y increasing downward, while the Tajima format -
    // like the machine itself - measures y upward. Negating here, once, at
    // the encoder boundary, keeps all the rest of the pipeline in design
    // space and makes the file stitch the right way up. (libembroidery and
    // pyembroidery do the same for exactly the same reason.)
    const ax = Math.round(stitch.x / DST_MM_PER_UNIT);
    const ay = Math.round(-stitch.y / DST_MM_PER_UNIT);

    // A cut and a colour stop are remarks about where the needle already
    // stands rather than destinations: neither can carry the needle
    // anywhere, so both are written where the needle is and leave it there.
    // Travel to the next point belongs to the next row.
    const movesNeedle =
      stitch.command !== 'trim' && stitch.command !== 'colorChange' && stitch.command !== 'end';
    const dx = movesNeedle ? ax - px : 0;
    const dy = movesNeedle ? ay - py : 0;
    const hops = movesNeedle ? splitMove(dx, dy) : [];
    if (movesNeedle) {
      px = ax;
      py = ay;
    }

    if (stitch.command === 'end') {
      records.push([0, 0, CMD_END]);
      rows += 1;
      ended = true;
      sewing = false;
      continue;
    }

    switch (stitch.command) {
      case 'trim': {
        // DST has no cut command of its own. What it does have is this little
        // diamond of jumps - a pop of the needle in place, ending exactly
        // where it started - which a Tajima machine reads as "lift and cut
        // here". A second cut while the thread is already up would be one in
        // the wrong place, so it is dropped rather than doubled.
        if (sewing) {
          rows += 1;
          for (const [ox, oy] of DST_TRIM_POP) {
            const [b0, b1, b2] = encodeTernary(ox, oy);
            records.push([b0, b1, b2 | CMD_JUMP]);
          }
        }
        sewing = false;
        break;
      }
      case 'colorChange': {
        rows += 1;
        const [b0, b1, b2] = encodeTernary(0, 0);
        records.push([b0, b1, b2 | CMD_STOP]);
        sewing = false;
        break;
      }
      default: {
        const cmd = commandByteFor(stitch.command);
        rows += hops.length;

        for (let i = 0; i < hops.length; i++) {
          const hop = hops[i]!;
          const isLast = i === hops.length - 1;
          const [b0, b1, b2] = encodeTernary(hop.x, hop.y);
          // Intermediate hops of a long travel are always jumps; the final hop
          // carries the real command.
          const byte2 = isLast ? b2 | cmd : b2 | CMD_JUMP;
          records.push([b0, b1, byte2]);
          lx += hop.x;
          ly += hop.y;
          measure(lx, ly);
        }
        // A jump moves the needle without taking a stitch, so the fabric is
        // still unpierced until something sews.
        sewing = stitch.command === 'stitch' || stitch.command === 'lock';
        break;
      }
    }
  }

  if (!ended) {
    // Every DST reader stops at the terminator, and most warn about a file
    // that ends without one, so the stream always closes with it - an empty
    // design is a header and that one record, exactly as the reference writes
    // it. Once there are rows to close, the terminator is one of them: it is
    // only the empty case where a file holds a record its header does not
    // count.
    records.push([0, 0, CMD_END]);
    if (rows > 0) rows += 1;
  }

  const colorCount = Math.max(1, options.colorCount ?? 1);

  // A sequence that wrote nothing has an empty box for extents rather than a
  // number a reader could mistake for a real one.
  const bounds: Bounds =
    minX === Infinity
      ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      : {
          minX: minX * DST_MM_PER_UNIT,
          maxX: maxX * DST_MM_PER_UNIT,
          // The header reports the design as it was drawn, so the file's y-up
          // landings go back to y-down on the way out - the same turn the
          // records took on the way in.
          minY: -maxY * DST_MM_PER_UNIT,
          maxY: -minY * DST_MM_PER_UNIT,
        };

  // AX/AY record where the needle finishes, in machine space (y up), which is
  // what Tajima machines and digitizing software expect to find there. It is
  // the landing rather than the last point named: a sequence that ends on a
  // cut or a colour stop ends where the needle stood, not where that row was
  // measured from.
  const header = buildHeader({
    name: options.name ?? 'Untitled',
    stitchCount: rows,
    colorCount,
    bounds,
    ax: lx,
    ay: ly,
  });

  const body = new Uint8Array(records.length * 3);
  let offset = 0;
  for (const [b0, b1, b2] of records) {
    body[offset++] = b0;
    body[offset++] = b1;
    body[offset++] = b2;
  }

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

export interface DstReadResult {
  name: string;
  headerStitchCount: number;
  headerColorCount: number;
  bounds: Bounds;
  stitches: Stitch[];
}

/** Parse a DST file back into stitches. Used by tests and the import path. */
export function readDst(bytes: Uint8Array): DstReadResult {
  const buf = bytes;

  if (buf.length < DST_HEADER_SIZE) {
    throw new DstEncodingError(`file too short: ${buf.length} bytes (need >= ${DST_HEADER_SIZE})`);
  }

  const header = latin1Text(buf, 0, DST_HEADER_SIZE);
  const pull = (key: string): number => {
    const escaped = key.replace(/[+]/g, '\\+');
    // Fields are space padded, so the digits start after any run of them
    // rather than immediately after the colon.
    const m = header.match(new RegExp(`${escaped}:\\s*(-?[0-9]+)`));
    return m ? parseInt(m[1]!, 10) : 0;
  };

  const nameMatch = header.match(/^LA:(.{1,16})/);
  const name = nameMatch ? nameMatch[1]!.trim() : 'Untitled';

  const bounds: Bounds = {
    maxX: pull('+X') / 10,
    minX: -pull('-X') / 10,
    maxY: pull('+Y') / 10,
    minY: -pull('-Y') / 10,
  };

  const stitches: Stitch[] = [];
  let x = 0;
  let y = 0;
  let seq = 0;
  let pos = DST_HEADER_SIZE;

  while (pos + 3 <= buf.length) {
    const b0 = buf[pos]!;
    const b1 = buf[pos + 1]!;
    const b2 = buf[pos + 2]!;
    pos += 3;

    // Files written before the terminator was corrected ended on an A1 00 00
    // sentinel rather than the format's own end record. Stopping there too
    // keeps those exports readable instead of trailing one phantom stitch.
    if (b0 === 0xa1 && b1 === 0x00 && b2 === 0x00) break;
    if (b2 === CMD_END) break;

    const delta = decodeTernary(b0, b1, b2);
    x += delta.x;
    y += delta.y;

    let command: StitchCommand = 'stitch';
    if (b2 & 0x40) command = 'colorChange';
    else if (b2 & 0x80) command = 'jump';

    stitches.push({
      x: x * DST_MM_PER_UNIT,
      // Mirror of the writer's negation: the file holds y-up machine
      // coordinates, and the design space is y-down, so flip back on the way
      // in. Doing it in both directions keeps read(write(s)) == s.
      y: -y * DST_MM_PER_UNIT,
      command,
      colorIndex: 0,
      objectId: null,
      sequence: seq++,
    });
  }

  return {
    name,
    headerStitchCount: pull('ST'),
    headerColorCount: pull('CO') + 1,
    bounds,
    stitches,
  };
}

/** File extension for this format. */
export const DST_EXTENSION = '.dst';

/** MIME type used for local download. */
export const DST_MIME = 'application/octet-stream';
