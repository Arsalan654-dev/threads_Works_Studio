/**
 * Brother PES v1 encoder (with an embedded PEC stitch block), plus a reader
 * that pulls the stitch stream back out.
 *
 * Verified against pyembroidery's PesWriter / PecWriter / PecReader - the
 * battle-tested reference used by Ink/Stitch.
 *
 * Structure
 * ---------
 *   "#PES0001"                  8 bytes
 *   u32 le  PEC block offset    points at the PEC *header* (the "LA:" line)
 *   PES v1 block                CEmbOne / CSewSeg design data: hoop extents,
 *                               affine placement, colour blocks. This is what
 *                               PE-DESIGN and other editors read.
 *   PEC block                  512-byte header + stitch stream + thumbnails.
 *                               This is what the machine actually stitches.
 *
 * Note there is no "#PEC0001" marker inside a PES: that signature only exists
 * in a standalone .pec file. Readers seek to the offset and start parsing the
 * header directly, so writing the extra 8 bytes would shift every field.
 *
 * Coordinates
 * -----------
 * Unlike DST and EXP, PES/PEC does NOT negate y. The Brother convention runs
 * the same way as the engine's y-down design space, so coordinates pass
 * through untouched apart from the millimetre -> 0.1 mm conversion. Confirmed
 * against pyembroidery, whose PecWriter writes dy untouched and whose
 * PecReader stitches it back untouched.
 *
 * Encoding pipeline
 * -----------------
 * pyembroidery never writes the rows it is handed: `write_pes` first runs them
 * through its encoder (EmbEncoder) with this writer's settings - max step 2047
 * units, full jumps, rounding, no explicit trims - and only then feeds the
 * normalised rows to the container, the stitch stream and the thumbnails. All
 * three read the *same* normalised pattern, so `normalizePes` reproduces that
 * pass once and every part of the file is derived from its rows: a trim keeps
 * the needle where it was and the travel to the next block becomes a jump, a
 * colour change is a remark at the needle, and travel longer than 204.7 mm is
 * chained into hops. The segment builder, bounds, thumbnails and `pecEncode`
 * all mirror their pyembroidery counterparts line for line.
 */

import type { Stitch, ThreadColor } from '../types.js';
import { roundHalfToEven } from './moves.js';

export const PES_MM_PER_UNIT = 0.1;
export const PES_SIGNATURE = '#PES0001';
/** Signature of a standalone .pec file (a PES stores no such marker). */
export const PEC_SIGNATURE = '#PEC0001';
export const PEC_HEADER_SIZE = 512;
export const PEC_ICON_WIDTH = 48;
export const PEC_ICON_HEIGHT = 38;
export const PEC_ICON_STRIDE = 6;
/** PEC stores a single move in a signed 12-bit field. */
export const PEC_MAX_STEP = 2047;
/** The stitch block's length field is three bytes wide, and wraps beyond it. */
export const PEC_MAX_BLOCK_BYTES = 0xffffff;

/**
 * Brother PEC thread chart: 64 fixed colours indexed 1..64 (index 0 is the
 * "unknown" placeholder). The machine reads palette entries as indexes into
 * this chart, so the design's colours are matched to their nearest entry, and
 * an imported PES can recover plausible thread names from it.
 * Values mirror pyembroidery's EmbThreadPec chart.
 */
const PEC_THREAD_CHART: ReadonlyArray<readonly [number, number, number, string]> = [
  [0, 0, 0, 'Unknown'], // 0
  [14, 31, 124, 'Prussian Blue'], // 1
  [10, 85, 163, 'Blue'], // 2
  [0, 135, 119, 'Teal Green'], // 3
  [75, 107, 175, 'Cornflower Blue'], // 4
  [237, 23, 31, 'Red'], // 5
  [209, 92, 0, 'Reddish Brown'], // 6
  [145, 54, 151, 'Magenta'], // 7
  [228, 154, 203, 'Light Lilac'], // 8
  [145, 95, 172, 'Lilac'], // 9
  [158, 214, 125, 'Mint Green'], // 10
  [232, 169, 0, 'Deep Gold'], // 11
  [254, 186, 53, 'Orange'], // 12
  [255, 255, 0, 'Yellow'], // 13
  [112, 188, 31, 'Lime Green'], // 14
  [186, 152, 0, 'Brass'], // 15
  [168, 168, 168, 'Silver'], // 16
  [125, 111, 0, 'Russet Brown'], // 17
  [255, 255, 179, 'Cream Brown'], // 18
  [79, 85, 86, 'Pewter'], // 19
  [0, 0, 0, 'Black'], // 20
  [11, 61, 145, 'Ultramarine'], // 21
  [119, 1, 118, 'Royal Purple'], // 22
  [41, 49, 51, 'Dark Gray'], // 23
  [42, 19, 1, 'Dark Brown'], // 24
  [246, 74, 138, 'Deep Rose'], // 25
  [178, 118, 36, 'Light Brown'], // 26
  [252, 187, 197, 'Salmon Pink'], // 27
  [254, 55, 15, 'Vermilion'], // 28
  [240, 240, 240, 'White'], // 29
  [106, 28, 138, 'Violet'], // 30
  [168, 221, 196, 'Seacrest'], // 31
  [37, 132, 187, 'Sky Blue'], // 32
  [254, 179, 67, 'Pumpkin'], // 33
  [255, 243, 107, 'Cream Yellow'], // 34
  [208, 166, 96, 'Khaki'], // 35
  [209, 84, 0, 'Clay Brown'], // 36
  [102, 186, 73, 'Leaf Green'], // 37
  [19, 74, 70, 'Peacock Blue'], // 38
  [135, 135, 135, 'Gray'], // 39
  [216, 204, 198, 'Warm Gray'], // 40
  [67, 86, 7, 'Dark Olive'], // 41
  [253, 217, 222, 'Flesh Pink'], // 42
  [249, 147, 188, 'Pink'], // 43
  [0, 56, 34, 'Deep Green'], // 44
  [178, 175, 212, 'Lavender'], // 45
  [104, 106, 176, 'Wisteria Violet'], // 46
  [239, 227, 185, 'Beige'], // 47
  [247, 56, 102, 'Carmine'], // 48
  [181, 75, 100, 'Amber Red'], // 49
  [19, 43, 26, 'Olive Green'], // 50
  [199, 1, 86, 'Dark Fuchsia'], // 51
  [254, 158, 50, 'Tangerine'], // 52
  [168, 222, 235, 'Light Blue'], // 53
  [0, 103, 62, 'Emerald Green'], // 54
  [78, 41, 144, 'Purple'], // 55
  [47, 126, 32, 'Moss Green'], // 56
  [255, 204, 204, 'Flesh Pink'], // 57
  [255, 217, 17, 'Harvest Gold'], // 58
  [9, 91, 166, 'Electric Blue'], // 59
  [240, 249, 112, 'Lemon Yellow'], // 60
  [227, 243, 91, 'Fresh Green'], // 61
  [255, 153, 0, 'Orange'], // 62
  [255, 240, 141, 'Cream Yellow'], // 63
  [255, 200, 200, 'Applique'], // 64
];

export const PEC_CHART_SIZE = PEC_THREAD_CHART.length;

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
}

/**
 * pyembroidery's colour distance: the weighted "red mean" metric rather than
 * plain RGB distance (see compuphase.com/cmetric.htm), with halves rounded to
 * even the way Python's `round()` does. Matching the reference's metric is what
 * makes its chart indices - the bytes written into the PEC header - agree.
 */
function pecColorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const redMean = roundHalfToEven((r1 + r2) / 2);
  const r = r1 - r2;
  const g = g1 - g2;
  const b = b1 - b2;
  return (((512 + redMean) * r * r) >> 8) + 4 * g * g + (((767 - redMean) * b * b) >> 8);
}

/**
 * The catalogue as plain colours, with index 0 (the "unknown" placeholder)
 * already blanked out: both palette passes search this shape of list.
 */
const RAW_CHART: Array<[number, number, number] | null> = PEC_THREAD_CHART.map((entry, i) =>
  i === 0 ? null : [entry[0], entry[1], entry[2]],
);

/**
 * Nearest entry of a colour list, skipping blanks. Ties go to the later slot,
 * exactly as the reference's `<=` comparison does.
 */
function nearestSlot(
  rgb: [number, number, number] | null,
  entries: Array<[number, number, number] | null>,
): number | null {
  if (!rgb) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const distance = pecColorDistance(rgb[0], rgb[1], rgb[2], entry[0], entry[1], entry[2]);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Nearest Brother chart entry for a #RRGGBB colour (1..64). */
export function nearestPecColorIndex(hex: string): number {
  return nearestSlot(parseHexRgb(hex), RAW_CHART) ?? 1;
}

const PEC_MASK_07 = 0x7f;
const PEC_JUMP_CODE = 0x10;
const PEC_TRIM_CODE = 0x20;
const PEC_FLAG_LONG = 0x80;

export class PesEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesEncodingError';
  }
}

// --- byte helpers ---------------------------------------------------------

function u8(out: number[], value: number): void {
  out.push(value & 0xff);
}

function u16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function u24(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
}

function u32(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
}

function f32(out: number[], value: number): void {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  out.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}

/**
 * UTF-8 encode without `Buffer`, so the engine stays isomorphic (the client
 * encodes in the browser where `Buffer` does not exist).
 */
function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** PES string with a 16-bit length prefix. */
function pesString16(out: number[], text: string): void {
  u16(out, text.length);
  for (const b of utf8Bytes(text)) out.push(b);
}

function signed7(b: number): number {
  return b > 63 ? -128 + b : b;
}

function signed12(code: number): number {
  const b = code & 0xfff;
  return b > 0x7ff ? -0x1000 + b : b;
}

// --- PEC stitch stream ----------------------------------------------------

/**
 * Write one PEC value. Values inside (-64, 63) use the one-byte short form;
 * everything else uses the two-byte form whose high nibble holds the flag
 * (jump / trim) and whose bit 15 marks the record as long.
 */
function pecValue(out: number[], value: number, long: boolean, flag = 0): void {
  if (!long && value > -64 && value < 63) {
    u8(out, value & PEC_MASK_07);
    return;
  }
  let v = value & 0x0fff;
  v |= 0x8000;
  v |= (flag << 8) & 0xff00;
  u8(out, (v >> 8) & 0xff);
  u8(out, v & 0xff);
}

function pecStitch(out: number[], dx: number, dy: number): void {
  pecValue(out, dx, false);
  pecValue(out, dy, false);
}

function pecJump(out: number[], dx: number, dy: number): void {
  pecValue(out, dx, true, PEC_JUMP_CODE);
  pecValue(out, dy, true, PEC_JUMP_CODE);
}

function pecTrimJump(out: number[], dx: number, dy: number): void {
  pecValue(out, dx, true, PEC_TRIM_CODE);
  pecValue(out, dy, true, PEC_TRIM_CODE);
}

/** One machine row in 0.1 mm units, produced by `normalizePes`. */
type PesCommand = 'stitch' | 'jump' | 'trim' | 'colorChange' | 'end';

interface PesRow {
  /** Machine coordinate in 0.1 mm (fractional for chained hop landings). */
  x: number;
  y: number;
  command: PesCommand;
}

/** The normalised pattern plus the colour blocks its rows declare. */
interface NormalizedPes {
  rows: PesRow[];
  /**
   * How many threads the reference's encoder appends: one for the first block,
   * one per colour change. The PEC palette and the segment colour codes are
   * both looked up by this count - a palette longer than the design's colour
   * blocks would be invented data, and the reference does not write it.
   */
  threadCount: number;
}

/** Design extents in 0.1 mm units, measured over the normalised rows. */
interface UnitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Reproduce pyembroidery's encoder (EmbEncoder.transcode_main) with the
 * settings PES writes with: max step 2047 units, full jumps, rounded source
 * coordinates, no explicit trims and no tie-on/tie-off contingencies.
 *
 * What that changes relative to the rows handed in:
 *   - The first stitch after a trim (or at the start) opens its block with a
 *     jump to the target and then sews it, so a thread is never dragged.
 *   - A trim row cuts where the needle already is; it never moves it, so any
 *     travel our sequencer attached to it is dropped here and re-emitted as
 *     the jump that opens the next block.
 *   - A colour change is likewise a remark at the needle, and a second cut
 *     while already trimmed is dropped.
 *   - Travel beyond 204.7 mm is chained into hops before the arrival record.
 *   - An end record closes the stream whether or not the input had one.
 */
function normalizePes(source: Stitch[]): NormalizedPes {
  const rows: PesRow[] = [];
  let needleX = 0;
  let needleY = 0;
  let stateTrimmed = true;
  let orderIndex = -1; // position in the thread change sequence
  let threadCount = 0;
  let ended = false;

  /** Advance the needle to within one record of (x, y) using hops. */
  const gapTo = (x: number, y: number): void => {
    const dx = x - needleX;
    const dy = y - needleY;
    if (Math.abs(dx) <= PEC_MAX_STEP && Math.abs(dy) <= PEC_MAX_STEP) return;
    const steps = Math.max(
      Math.ceil(Math.abs(dx / PEC_MAX_STEP)),
      Math.ceil(Math.abs(dy / PEC_MAX_STEP)),
    );
    const stepX = dx / steps;
    const stepY = dy / steps;
    let qx = needleX;
    let qy = needleY;
    for (let q = 1; q < steps; q++) {
      qx += stepX;
      qy += stepY;
      rows.push({ x: qx, y: qy, command: 'jump' });
      needleX = qx;
      needleY = qy;
    }
  };

  /** First block (order -1) consumes a thread silently; later ones change colour. */
  const declareNotTrimmed = (): void => {
    if (orderIndex === -1) {
      orderIndex = 0;
      threadCount += 1;
    }
    stateTrimmed = false;
  };

  const changeThread = (): void => {
    orderIndex += 1;
    threadCount += 1;
    if (orderIndex !== 0) rows.push({ x: needleX, y: needleY, command: 'colorChange' });
    stateTrimmed = true;
  };

  for (const stitch of source) {
    const x = Math.round(stitch.x / PES_MM_PER_UNIT);
    const y = Math.round(stitch.y / PES_MM_PER_UNIT);

    switch (stitch.command) {
      case 'stitch':
      case 'lock': {
        if (stateTrimmed) {
          declareNotTrimmed();
          gapTo(x, y);
          if (needleX !== x || needleY !== y) {
            rows.push({ x, y, command: 'jump' });
            needleX = x;
            needleY = y;
          }
        } else {
          gapTo(x, y);
        }
        rows.push({ x, y, command: 'stitch' });
        needleX = x;
        needleY = y;
        break;
      }

      case 'jump': {
        gapTo(x, y);
        rows.push({ x, y, command: 'jump' });
        needleX = x;
        needleY = y;
        break;
      }

      case 'trim': {
        if (!stateTrimmed) {
          rows.push({ x: needleX, y: needleY, command: 'trim' });
          stateTrimmed = true;
        }
        break;
      }

      case 'colorChange': {
        changeThread();
        break;
      }

      case 'end': {
        rows.push({ x: needleX, y: needleY, command: 'end' });
        ended = true;
        break;
      }

      default:
        break;
    }
    if (ended) break;
  }

  // The reference always ends the stream with an END record at the needle.
  if (!ended) rows.push({ x: needleX, y: needleY, command: 'end' });

  return { rows, threadCount };
}

/** Extents of the normalised rows: what pyembroidery's `pattern.bounds()` sees. */
function unitBounds(rows: PesRow[]): UnitBounds {
  if (rows.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    if (row.x < minX) minX = row.x;
    if (row.y < minY) minY = row.y;
    if (row.x > maxX) maxX = row.x;
    if (row.y > maxY) maxY = row.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Encode the normalised rows, mirroring pyembroidery's `pec_encode` state
 * machine record for record.
 *
 * The rules that shape the bytes, all inherited from the reference:
 *   - Every delta is measured from where the needle last *landed*, and the
 *     landing moves by the rounded delta - not to the row's own coordinate -
 *     so chained hops accumulate the same way Python's writer does.
 *   - PEC has no standalone trim: a TRIM row writes nothing. The cut reaches
 *     the machine as the flag on the jump that opens the next block, which is
 *     why that jump is a trim-jump once the first record is behind us.
 *   - The first record is a plain jump; every later one is a trim-jump.
 *   - After a jump, the first stitch that moves both axes is preceded by an
 *     in-place stitch, which is how the reference anchors the thread.
 */
function pecEncode(out: number[], rows: PesRow[]): void {
  let colorTwo = true;
  let jumping = true;
  let init = true;
  let xx = 0; // running position in 0.1 mm (design space)
  let yy = 0;

  for (const row of rows) {
    const dx = roundHalfToEven(row.x - xx);
    const dy = roundHalfToEven(row.y - yy);
    xx += dx;
    yy += dy;

    switch (row.command) {
      case 'stitch': {
        if (jumping && dx !== 0 && dy !== 0) pecStitch(out, 0, 0);
        jumping = false;
        pecStitch(out, dx, dy);
        break;
      }

      case 'jump': {
        jumping = true;
        if (init) pecJump(out, dx, dy);
        else pecTrimJump(out, dx, dy);
        break;
      }

      case 'trim': {
        // Nothing to write: the cut travels on the next jump's flag.
        break;
      }

      case 'colorChange': {
        if (jumping) {
          pecStitch(out, 0, 0);
          jumping = false;
        }
        u8(out, 0xfe);
        u8(out, 0xb0);
        u8(out, colorTwo ? 0x02 : 0x01);
        colorTwo = !colorTwo;
        break;
      }

      case 'end': {
        u8(out, 0xff);
        return;
      }

      default:
        break;
    }
    init = false;
  }

  // Unreachable: the normaliser always ends the stream with an end record.
  // Writing it anyway keeps a malformed row list from producing an unterminated
  // block that a machine would read straight into the thumbnails.
  u8(out, 0xff);
}

// --- PEC header / block ---------------------------------------------------

/**
 * 512-byte PEC header: label, icon geometry, and the colour palette. Palette
 * entries index the Brother thread chart and tell the machine which thread to
 * suggest for each colour block.
 */
function pecHeader(out: number[], name: string, palette: number[]): void {
  const start = out.length;
  const colorCount = palette.length;

  const label = (name || 'Untitled').replace(/[^\x20-\x7e]/g, '').slice(0, 8);
  for (const b of utf8Bytes('LA:')) out.push(b);
  for (const b of utf8Bytes(label.padEnd(16, ' '))) out.push(b);
  u8(out, 0x0d);

  for (let i = 0; i < 12; i++) u8(out, 0x20);
  u8(out, 0xff);
  u8(out, 0x00);
  u8(out, PEC_ICON_STRIDE);
  u8(out, PEC_ICON_HEIGHT);

  if (colorCount === 0) {
    // No threads at all (a design with no colour block): the reference writes
    // a fixed filler instead of a count and index list.
    for (const b of [
      0x20, 0x20, 0x20, 0x20, 0x64, 0x20, 0x00, 0x20, 0x00, 0x20, 0x20, 0x20, 0xff,
    ]) {
      u8(out, b);
    }
  } else {
    for (let i = 0; i < 12; i++) u8(out, 0x20);
    u8(out, colorCount - 1);
    for (let i = 0; i < colorCount; i++) u8(out, palette[i]! & 0xff);
  }

  // Pad to exactly 512 bytes: the reader seeks fixed offsets from here.
  while (out.length - start < PEC_HEADER_SIZE) u8(out, 0x20);
  if (out.length - start !== PEC_HEADER_SIZE) {
    throw new PesEncodingError(
      `PEC header overflow: ${out.length - start} > ${PEC_HEADER_SIZE} bytes`,
    );
  }
}

/** Stitch block: a small fixed header followed by the encoded stitches. */
function pecBlock(out: number[], rows: PesRow[], bounds: UnitBounds): void {
  const start = out.length;

  u8(out, 0x00);
  u8(out, 0x00);
  const lengthPos = out.length;
  u24(out, 0); // patched below
  u8(out, 0x31);
  u8(out, 0xff);
  u8(out, 0xf0);

  // int(round(width)) in the reference; extents are whole 0.1 mm units.
  u16(out, roundHalfToEven(bounds.maxX - bounds.minX));
  u16(out, roundHalfToEven(bounds.maxY - bounds.minY));
  u16(out, 0x01e0);
  u16(out, 0x01b0);

  pecEncode(out, rows);

  const length = out.length - start;
  pecWriteBlockLength(out, lengthPos, length);
}

/**
 * Write the stitch block's three-byte length field.
 *
 * The field is three bytes wide and wraps beyond its maximum, which would not
 * fail loudly - the machine would read a design whose stitches begin in the
 * middle of nowhere - so a size that cannot be expressed is refused with a
 * sentence instead of written as a corrupt file. It takes about 2.4 million
 * stitches to get here, which the stitch ceiling stops well before.
 */
export function pecWriteBlockLength(out: number[], lengthPos: number, length: number): void {
  if (length > PEC_MAX_BLOCK_BYTES) {
    throw new PesEncodingError(
      `PEC block is ${length} bytes; the format's length field holds ${PEC_MAX_BLOCK_BYTES}. ` +
        'Split the design or reduce its stitch count.',
    );
  }
  out[lengthPos] = length & 0xff;
  out[lengthPos + 1] = (length >> 8) & 0xff;
  out[lengthPos + 2] = (length >> 16) & 0xff;
}

/**
 * The fixed 6 x 38 hoop icon every thumbnail starts from - the design preview
 * is drawn *over* this frame, and colour blocks each get their own fresh copy.
 * It is real design data rather than an empty bitmap, so it is carried byte for
 * byte from pyembroidery's PecGraphics.blank (MIT, (c) 2018 the Ink/Stitch
 * project), the same way the Janome colour table is reused as data.
 */
const PEC_BLANK: readonly number[] = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x08, 0x00, 0x00, 0x00,
  0x00, 0x10, 0x04, 0x00, 0x00, 0x00, 0x00, 0x20, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
  0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00,
  0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
  0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00,
  0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
  0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00,
  0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
  0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
  0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x04, 0x00, 0x00, 0x00,
  0x00, 0x20, 0x08, 0x00, 0x00, 0x00, 0x00, 0x10, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
];

/**
 * Set one pixel of a thumbnail, mirroring PecGraphics.graphic_mark_bit: Python's
 * truncating integer division for the byte column, its always-positive modulo
 * for the bit, and its negative list indexing (which wraps inside the buffer and
 * only raises once past the far end).
 */
function markBit(graphic: number[], x: number, y: number, stride: number): void {
  let index = y * stride + Math.trunc(x / 8);
  if (index < 0) index += graphic.length;
  if (index < 0 || index >= graphic.length) return; // IndexError, swallowed by draw_scaled
  graphic[index] = graphic[index]! | (1 << (((x % 8) + 8) % 8));
}

/**
 * Draw the rows into a thumbnail, mirroring PecGraphics.draw_scaled: fit the
 * design's extents into the icon with a one-row margin and plot each point.
 */
function drawScaled(bounds: UnitBounds, rows: PesRow[], graphic: number[], buffer: number): void {
  const stride = PEC_ICON_STRIDE;
  const diagramWidth = bounds.maxX - bounds.minX || 1;
  const diagramHeight = bounds.maxY - bounds.minY || 1;
  const graphicWidth = stride * 8;
  const graphicHeight = graphic.length / stride;

  const scale = Math.min(
    (graphicWidth - buffer) / diagramWidth,
    (graphicHeight - buffer) / diagramHeight,
  );
  const translateX = -((bounds.maxX + bounds.minX) / 2) * scale + graphicWidth / 2;
  const translateY = -((bounds.maxY + bounds.minY) / 2) * scale + graphicHeight / 2;

  for (const row of rows) {
    const x = Math.floor(row.x * scale + translateX);
    const y = Math.floor(row.y * scale + translateY);
    markBit(graphic, x, y, stride);
  }
}

/**
 * Thumbnails: the design preview, then one per colour block, each drawn over a
 * fresh copy of the hoop icon exactly as write_pec_graphics does.
 */
function pecGraphics(out: number[], rows: PesRow[], bounds: UnitBounds): void {
  const stitches = rows.filter((row) => row.command === 'stitch');

  const main = PEC_BLANK.slice();
  drawScaled(bounds, stitches, main, 4);
  for (const b of main) u8(out, b);

  // Colour blocks end with their colour change, exactly like get_as_colorblocks.
  let start = 0;
  const writeBlock = (end: number): void => {
    const graphic = PEC_BLANK.slice();
    drawScaled(
      bounds,
      rows.slice(start, end).filter((row) => row.command === 'stitch'),
      graphic,
      5,
    );
    for (const b of graphic) u8(out, b);
  };
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.command === 'colorChange') {
      writeBlock(i + 1);
      start = i + 1;
    }
  }
  if (start !== rows.length) writeBlock(rows.length);
}

// --- PES v1 block ---------------------------------------------------------

interface PesSegment {
  points: Array<[number, number]>;
  colorCode: number;
  flag: number;
}

/**
 * Build CSewSeg sections from the normalised rows, mirroring pyembroidery's
 * `get_as_segments_blocks`: consecutive rows of one command form a block,
 * stitch runs become filled sections, a jump run becomes one travel section
 * from the last needle point to where the jump ended, colour changes advance
 * the thread without producing a section of their own, and cuts and the end
 * record are skipped entirely.
 *
 * `colorCodes` is each colour block's index in the *raw* Brother chart - what
 * the reference looks each thread up against. It is not the list the PEC
 * header writes: that one is built as a de-duplicated palette, so the two can
 * and do disagree once two threads are close enough to claim the same slot.
 */
function buildSegments(
  rows: PesRow[],
  adjustX: number,
  adjustY: number,
  colorCodes: number[],
): { segments: PesSegment[]; colorLog: Array<[number, number]>; sectionCount: number } {
  const runs: PesRow[][] = [];
  let run: PesRow[] = [];
  for (const row of rows) {
    if (run.length === 0 || run[0]!.command === row.command) {
      run.push(row);
    } else {
      runs.push(run);
      run = [row];
    }
  }
  if (run.length > 0) runs.push(run);

  const segments: PesSegment[] = [];
  const colorLog: Array<[number, number]> = [];
  let colorIndex = 0;
  let colorCode = colorCodes[0] ?? 1;
  let stitchedX = 0; // 0.1 mm
  let stitchedY = 0;
  let previousColorCode = -1;
  let section = 0;

  for (const r of runs) {
    const kind = r[0]!.command;

    if (kind === 'colorChange') {
      colorIndex++;
      colorCode = colorCodes[colorIndex] ?? colorCode;
      continue;
    }
    if (kind !== 'stitch' && kind !== 'jump') continue;

    const points: Array<[number, number]> = [];
    let flag: number;

    if (kind === 'jump') {
      points.push([Math.trunc(stitchedX - adjustX), Math.trunc(stitchedY - adjustY)]);
      const last = r[r.length - 1]!;
      points.push([Math.trunc(last.x - adjustX), Math.trunc(last.y - adjustY)]);
      flag = 1;
    } else {
      for (const s of r) {
        stitchedX = s.x;
        stitchedY = s.y;
        points.push([Math.trunc(stitchedX - adjustX), Math.trunc(stitchedY - adjustY)]);
      }
      flag = 0;
    }

    if (previousColorCode !== colorCode) {
      colorLog.push([section, colorCode]);
      previousColorCode = colorCode;
    }

    segments.push({ points, colorCode, flag });
    section++;
  }

  return { segments, colorLog, sectionCount: segments.length };
}

/** CEmbOne header: hoop placement and the affine design transform. */
function sewSegHeader(out: number[], width: number, height: number): number {
  for (let i = 0; i < 8; i++) u16(out, 0);

  const hoopWidth = 1300;
  const hoopHeight = 1800;
  const transX = 350 + hoopWidth / 2 - width / 2;
  const transY = 100 + height + hoopHeight / 2 - height / 2;

  f32(out, 1);
  f32(out, 0);
  f32(out, 0);
  f32(out, 1);
  f32(out, transX);
  f32(out, transY);

  u16(out, 1);
  u16(out, 0);
  u16(out, 0);
  u16(out, Math.trunc(width)); // int(width) in the reference
  u16(out, Math.trunc(height));
  for (let i = 0; i < 8; i++) u8(out, 0);

  const placeholder = out.length;
  u16(out, 0); // patched with the CSewSeg section count
  return placeholder;
}

/** PES v1 design block: header, CEmbOne, CSewSeg sections, colour log. */
function pesBlocks(out: number[], rows: PesRow[], bounds: UnitBounds, colorCodes: number[]): void {
  u16(out, 0x0001); // scale to fit
  u16(out, 0x0001); // 130 x 180 hoop
  u16(out, 0x0001); // one distinct block object
  u16(out, 0xffff);
  u16(out, 0x0000);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  // pyembroidery offsets by the design centre and then adds it back, which
  // cancels out: the block measures from the design's own corner.
  const adjustX = bounds.minX;
  const adjustY = bounds.maxY;

  pesString16(out, 'CEmbOne');
  const sectionsPlaceholder = sewSegHeader(out, width, height);

  u16(out, 0xffff);
  u16(out, 0x0000);

  pesString16(out, 'CSewSeg');
  const { segments, colorLog, sectionCount } = buildSegments(rows, adjustX, adjustY, colorCodes);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) u16(out, 0x8003); // section terminator
    u16(out, seg.flag);
    u16(out, seg.colorCode);
    u16(out, seg.points.length);
    for (const [px, py] of seg.points) {
      u16(out, px);
      u16(out, py);
    }
  }
  u16(out, colorLog.length);
  for (const [section, code] of colorLog) {
    u16(out, section);
    u16(out, code);
  }

  out[sectionsPlaceholder] = sectionCount & 0xff;
  out[sectionsPlaceholder + 1] = (sectionCount >> 8) & 0xff;

  u16(out, 0x0000);
  u16(out, 0x0000);
}

// --- public API -----------------------------------------------------------

export interface PesWriteOptions {
  /** Design name (8 characters useful, stored in the PEC label). */
  name?: string;
  /** Thread palette, in colour-index order: drives the PEC palette. */
  threads?: ThreadColor[];
  /**
   * Expected number of colour blocks. Advisory: the encoder counts the blocks
   * the stitch sequence itself contains, exactly as the reference does, and
   * reads threads by that count.
   */
  colorCount?: number;
}

/** Chart slot a colour block falls back to when its thread is missing. */
function fallbackChartIndex(index: number): number {
  return 1 + (index % (PEC_CHART_SIZE - 1));
}

/**
 * Brother chart code for each colour block, as the container's segment builder
 * looks them up: straight nearest-colour against the whole chart, with no
 * de-duplication.
 */
function blockColorCodes(threads: ThreadColor[], threadCount: number): number[] {
  const codes: number[] = [];
  for (let i = 0; i < threadCount; i++) {
    const thread = threads[i];
    codes.push(thread ? nearestPecColorIndex(thread.hex) : fallbackChartIndex(i));
  }
  return codes;
}

/**
 * PEC header palette, mirroring pyembroidery's `build_unique_palette`: each
 * block's thread claims its nearest *unused* chart slot (so two threads that
 * would both match the swatch at index 20 get one slot each), and then every
 * thread looks itself up in that sparse chart. Blocks without a thread are
 * pinned to a plain slot instead of the reference's random filler, which no
 * reader could reproduce anyway.
 */
function uniquePalette(threads: ThreadColor[], threadCount: number): number[] {
  // pyembroidery keeps two lists: the catalogue, which a claim *empties* so no
  // slot is reused, and a sparse lookup chart holding only the claimed threads,
  // which the second pass measures each block against. Keeping them apart is
  // what stops a second near-black thread from finding the first one's swatch.
  const catalogue = RAW_CHART.map((entry) => entry);
  const lookup = new Array<[number, number, number] | null>(PEC_CHART_SIZE).fill(null);
  const pinned = new Array<number | null>(threadCount).fill(null);
  const claimedColours = new Set<string>();

  for (let i = 0; i < threadCount; i++) {
    const thread = threads[i];
    if (!thread) {
      // No thread for this block: pin it to a plain catalogue colour instead of
      // the reference's random filler, which no reader could reproduce anyway.
      let slot = fallbackChartIndex(i);
      for (let tries = 0; tries < PEC_CHART_SIZE && catalogue[slot] === null; tries++) {
        slot = slot + 1 < PEC_CHART_SIZE ? slot + 1 : 1;
      }
      pinned[i] = slot;
      catalogue[slot] = null;
      lookup[slot] = RAW_CHART[slot] ?? null;
      continue;
    }
    const rgb = parseHexRgb(thread.hex);
    // The reference claims one slot per *distinct* thread, so two blocks sewn
    // in the same colour share a slot instead of pushing each other along.
    if (rgb && claimedColours.has(thread.hex.toLowerCase())) continue;
    const slot = nearestSlot(rgb, catalogue);
    if (slot === null) break; // the reference stops claiming once the chart runs out
    if (rgb) claimedColours.add(thread.hex.toLowerCase());
    catalogue[slot] = null;
    lookup[slot] = rgb;
  }

  const palette: number[] = [];
  for (let i = 0; i < threadCount; i++) {
    if (pinned[i] !== null) {
      palette.push(pinned[i]!);
      continue;
    }
    const thread = threads[i];
    const slot = thread ? nearestSlot(parseHexRgb(thread.hex), lookup) : null;
    palette.push(slot ?? fallbackChartIndex(i));
  }
  return palette;
}

/**
 * Encode a generated stitch sequence as a Brother PES v1 file with an
 * embedded PEC stitch block.
 */
export function writePes(stitches: Stitch[], options: PesWriteOptions = {}): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');

  const { rows, threadCount } = normalizePes(stitches);
  const bounds = unitBounds(rows);
  const threads = options.threads ?? [];
  const colorCodes = blockColorCodes(threads, threadCount);
  const palette = uniquePalette(threads, threadCount);

  const out: number[] = [];
  for (const b of utf8Bytes(PES_SIGNATURE)) out.push(b);
  const pecOffsetPos = out.length;
  u32(out, 0); // patched below

  // The reference always encodes first, so even an empty design keeps its
  // CEmbOne / CSewSeg blocks (with zero sections) rather than a short header.
  pesBlocks(out, rows, bounds, colorCodes);

  const pecOffset = out.length;
  out[pecOffsetPos] = pecOffset & 0xff;
  out[pecOffsetPos + 1] = (pecOffset >> 8) & 0xff;
  out[pecOffsetPos + 2] = (pecOffset >> 16) & 0xff;
  out[pecOffsetPos + 3] = (pecOffset >>> 24) & 0xff;

  // No "#PEC0001" here: the offset points straight at the PEC header, which is
  // what every reader (and the machine) expects inside a PES. The signature
  // only exists in a standalone .pec file.
  pecHeader(out, options.name ?? 'Untitled', palette);
  pecBlock(out, rows, bounds);
  pecGraphics(out, rows, bounds);

  return Uint8Array.from(out);
}

// --- reader ---------------------------------------------------------------

export interface PesReadResult {
  name: string;
  colorCount: number;
  stitches: Stitch[];
  /** Brother chart indices for each colour block, when the file carries them. */
  paletteIndices: number[];
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

type ReadStep =
  | { kind: 'end' }
  | { kind: 'color' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'trim'; x: number; y: number }
  | { kind: 'stitch'; x: number; y: number };

/** Parse the PEC stitch stream, mirroring pyembroidery's read_pec_stitches. */
function readPecStitches(bytes: Uint8Array, start: number, end: number): ReadStep[] {
  const steps: ReadStep[] = [];
  let pos = start;
  const readByte = (): number | null => (pos < end ? bytes[pos++]! : null);

  for (;;) {
    const val1 = readByte();
    const val2 = readByte();
    if (val1 === null || val2 === null) break;
    if (val1 === 0xff && val2 === 0x00) break;
    if (val1 === 0xfe && val2 === 0xb0) {
      readByte();
      steps.push({ kind: 'color' });
      continue;
    }

    let jump = false;
    let trim = false;
    let x: number;
    let second = val2;

    if (val1 & PEC_FLAG_LONG) {
      if (val1 & PEC_TRIM_CODE) trim = true;
      if (val1 & PEC_JUMP_CODE) jump = true;
      x = signed12((val1 << 8) | second);
      const next = readByte();
      if (next === null) break;
      second = next;
    } else {
      x = signed7(val1);
    }

    let y: number;
    if (second & PEC_FLAG_LONG) {
      if (second & PEC_TRIM_CODE) trim = true;
      if (second & PEC_JUMP_CODE) jump = true;
      const val3 = readByte();
      if (val3 === null) break;
      y = signed12((second << 8) | val3);
    } else {
      y = signed7(second);
    }

    if (jump) steps.push({ kind: 'move', x, y });
    else if (trim) steps.push({ kind: 'trim', x, y });
    else steps.push({ kind: 'stitch', x, y });
  }

  return steps;
}

/** Parse a PES file and return the stitch stream from its PEC block. */
export function readPes(bytes: Uint8Array): PesReadResult {
  if (bytes.length < 12) {
    throw new PesEncodingError(`file too short: ${bytes.length} bytes`);
  }
  if (ascii(bytes, 0, 8) !== PES_SIGNATURE) {
    throw new PesEncodingError(`missing ${PES_SIGNATURE} signature`);
  }

  const pecOffset = bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | ((bytes[11]! << 24) >>> 0);
  if (pecOffset + PEC_HEADER_SIZE + 16 > bytes.length) {
    throw new PesEncodingError(`PEC offset out of range: ${pecOffset}`);
  }
  if (ascii(bytes, pecOffset, pecOffset + 3) !== 'LA:') {
    throw new PesEncodingError(`PEC header not found at offset ${pecOffset}`);
  }

  // A PES carries no "#PEC0001": the offset points straight at the header.
  return parsePecBlock(bytes, pecOffset);
}

/** Parse a standalone `.pec` file, which does carry the signature. */
export function readPec(bytes: Uint8Array): PesReadResult {
  if (bytes.length < 8 + PEC_HEADER_SIZE + 16) {
    throw new PesEncodingError(`file too short: ${bytes.length} bytes`);
  }
  if (ascii(bytes, 0, 8) !== PEC_SIGNATURE) {
    throw new PesEncodingError(`missing ${PEC_SIGNATURE} signature`);
  }
  return parsePecBlock(bytes, 8);
}

/** Shared PEC parsing: header, palette, stitch stream. */
function parsePecBlock(bytes: Uint8Array, headerStart: number): PesReadResult {
  const name = ascii(bytes, headerStart + 3, headerStart + 19).trim();

  // Palette: colour-change count sits at header offset 48, indices follow.
  const colorChanges = bytes[headerStart + 48] ?? 0;
  const colorCount = colorChanges + 1;
  const paletteIndices: number[] = [];
  for (let i = 0; i < colorCount; i++) paletteIndices.push(bytes[headerStart + 49 + i] ?? 0);

  const blockStart = headerStart + PEC_HEADER_SIZE;
  const length =
    bytes[blockStart + 2]! | (bytes[blockStart + 3]! << 8) | (bytes[blockStart + 4]! << 16);
  const blockEnd = Math.min(blockStart + length, bytes.length);
  // Stitch data begins after 5 header bytes, the 31 FF F0 marker and 4 shorts.
  const steps = readPecStitches(bytes, blockStart + 16, blockEnd);

  const stitches: Stitch[] = [];
  let x = 0; // 0.1 mm, design space (PEC y is already y-down)
  let y = 0;
  let colorIndex = 0;
  let sequence = 0;

  const push = (command: Stitch['command']): void => {
    stitches.push({
      x: x * PES_MM_PER_UNIT,
      y: y * PES_MM_PER_UNIT,
      command,
      colorIndex,
      objectId: null,
      sequence: sequence++,
    });
  };

  for (const step of steps) {
    switch (step.kind) {
      case 'color':
        colorIndex++;
        push('colorChange');
        break;
      case 'move':
        x += step.x;
        y += step.y;
        push('jump');
        break;
      case 'trim':
        x += step.x;
        y += step.y;
        push('trim');
        break;
      case 'stitch':
        x += step.x;
        y += step.y;
        push('stitch');
        break;
      default:
        break;
    }
  }

  return { name, colorCount, stitches, paletteIndices };
}

/**
 * Brother chart colour at an index, so importers can recover plausible thread
 * colours from a PES/PEC palette instead of inventing greys.
 */
export function pecChartColor(index: number): { r: number; g: number; b: number } {
  const size = PEC_THREAD_CHART.length;
  const entry = PEC_THREAD_CHART[((index % size) + size) % size] ?? PEC_THREAD_CHART[1]!;
  return { r: entry[0], g: entry[1], b: entry[2] };
}

/** Human-readable Brother thread names, derived from the chart itself. */
export const PEC_CHART_NAMES: readonly string[] = PEC_THREAD_CHART.map((entry) => entry[3]);

/** File extension for this format. */
export const PES_EXTENSION = '.pes';

/** MIME type used for local download. */
export const PES_MIME = 'application/octet-stream';
