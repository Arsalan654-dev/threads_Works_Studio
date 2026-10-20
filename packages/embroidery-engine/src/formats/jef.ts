/**
 * Janome JEF encoder and decoder.
 *
 * Verified against pyembroidery's JefWriter / JefReader (the reference behind
 * Ink/Stitch) at the byte level, from the header down to the last record.
 *
 * File layout
 * -----------
 *   A fixed header, a colour table indexed by the machine's own thread
 *   library, one thread-type word per colour, then the stitch records:
 *
 *     +0x00  int32   offset of the first stitch record
 *     +0x04  int32   0x14 - reserved; readers ignore it
 *     +0x08  14      creation date, "YYYYMMDDHHMMSS", then two zero bytes
 *     +0x18  int32   number of colour blocks
 *     +0x1C  int32   length of the record area in 2-byte units
 *     +0x20  int32   hoop the design fits (see JEF_HOOPS)
 *     +0x24  int32x4 distance from the centre of the hoop: half width,
 *                     half height, half width, half height
 *     +0x34  int32x4 slack at each edge of a 110x110 hoop, or -1 if it does
 *                     not fit; the same again for 50x50, for 140x200 and for
 *                     the machine's custom hoop
 *     +0x74  int32xN colour library slot per colour block
 *     then   int32xN 0x0D, one thread-type word per colour block
 *     then   records, until 0x80 0x10
 *
 * Record
 * ------
 *   A normal stitch is 2 bytes: [dx, dy] signed 8-bit, 0.1 mm units. 0x80 in
 *   the first byte marks an escape, so a stitch may never start with -128 -
 *   the encoder splits a move before that can happen. The second byte of an
 *   escape is the control:
 *     80 02 [dx dy]     jump          (4 bytes)
 *     80 01 00 00       colour change (4 bytes)
 *     80 10             end           (2 bytes)
 *   A trim is three zero-distance jump records, which is how the format has
 *   always spelled "cut here"; a reader that does not know the convention
 *   simply sees three hops on the spot.
 *
 * Coordinates
 * -----------
 *   Like Tajima DST and Melco EXP, JEF measures y upward while the engine's
 *   design space is y-down, so y is negated once at the encoder boundary and
 *   once on the way back in.
 *
 * What the encoder does that a naive translation would not
 * --------------------------------------------------------
 *   - A colour block opens with travel: the needle jumps to the first sewn
 *     point and only then takes a stitch, so no thread is dragged across the
 *     hoop on the way in. Inside a block a long stitch is split with its
 *     last hop sewn, because there the thread is already in the fabric.
 *   - A trim and a colour change carry no movement at all. They are flags on
 *     the needle's *current* position; the travel that follows them belongs
 *     to the next stitch. Writing their coordinate instead would move the
 *     needle twice.
 */
import type { Stitch, ThreadColor } from '../types.js';
import { nearestJefIndex, roundHalfToEven } from './jefColors.js';
import { planMove, type PlannedHop } from './moves.js';

export const JEF_MM_PER_UNIT = 0.1;
export const JEF_MAX_STEP = 127; // 12.7 mm in 0.1 mm units

/** Bytes before the colour table. */
export const JEF_HEADER_BYTES = 0x74;
/** Colour slot plus thread-type word. */
export const JEF_COLOR_SLOT_BYTES = 8;

const ESCAPE = 0x80;
const CONTROL_COLOR = 0x01;
const CONTROL_JUMP = 0x02;
const CONTROL_END = 0x10;
const RESERVED_VERSION = 0x14;
const THREAD_TYPE_WORD = 0x0d;
const DEFAULT_TRIM_RECORDS = 3;

/**
 * The four slack rows the header carries, in 0.1 mm from the centre of each
 * hoop, in the order they are written: 110x110, 50x50, 140x200, and the
 * machine's custom hoop. The 126x110 and 200x200 sizes appear only as the
 * hoop number - the header has no fifth row for them.
 */
const JEF_SLACK_HOOPS: ReadonlyArray<{ halfW: number; halfH: number }> = [
  { halfW: 550, halfH: 550 }, // 110 x 110
  { halfW: 250, halfH: 250 }, // 50 x 50
  { halfW: 700, halfH: 1000 }, // 140 x 200
  { halfW: 700, halfH: 1000 }, // custom
];

export class JefEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JefEncodingError';
  }
}

function signed8(b: number): number {
  return b & 0x80 ? b - 0x100 : b;
}

/**
 * Plan a JEF move as the chain of records that carries it.
 *
 * JEF cannot encode a single move beyond 12.7 mm on either axis, so long
 * jumps and travel stitches are broken into equal parts rather than truncated.
 * The division itself is shared with the other formats - see `moves.ts` - and
 * is the same one pyembroidery performs, which is what makes the two encoders'
 * output comparable byte for byte.
 */
function planJefMove(dx: number, dy: number): PlannedHop[] {
  return planMove(dx, dy, JEF_MAX_STEP);
}

/**
 * Split a move that will not fit one record into chained hops.
 *
 * The steps are equal shares of the move, each written as a whole 0.1 mm
 * hop from the last landing - the same division the reference encoder
 * performs, so the records agree byte for byte.
 */
export function splitJefMove(dx: number, dy: number): Array<{ x: number; y: number }> {
  return planJefMove(dx, dy).map((hop) => ({ x: hop.x, y: hop.y }));
}

/** Write a 2-byte stitch record. Y is negated into machine space here. */
function pushStitch(out: number[], dx: number, dy: number): void {
  out.push(dx & 0xff, -dy & 0xff);
}

/** Write a 4-byte escape record. */
function pushEscape(out: number[], control: number, dx: number, dy: number): void {
  out.push(ESCAPE, control, dx & 0xff, -dy & 0xff);
}

/** 'YYYYMMDDHHMMSS' for this moment, local time. */
function defaultDate(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    String(now.getFullYear()) +
    p(now.getMonth() + 1) +
    p(now.getDate()) +
    p(now.getHours()) +
    p(now.getMinutes()) +
    p(now.getSeconds())
  );
}

export interface JefWriteOptions {
  /** Thread palette, in colour-index order: drives the colour library slots. */
  threads?: ThreadColor[];
  /**
   * Creation date as 'YYYYMMDDHHMMSS'. Defaults to now; tests pin it so the
   * bytes are reproducible.
   */
  date?: string;
  /**
   * Write the three in-place jumps that spell a trim. On by default: the
   * design asked for a cut and a file that silently drops it leaves a thread
   * trailing across the hoop.
   */
  trims?: boolean;
}

/**
 * The colour index of every block the sequence splits into.
 *
 * Counted from the colour-change commands, because that is what the machine
 * stops for; the thread comes from the first needle penetration after the
 * boundary, which is the colour the operator will actually see.
 */
function colourBlocks(stitches: Stitch[]): { count: number; indices: number[] } {
  let count = 1;
  for (const stitch of stitches) if (stitch.command === 'colorChange') count++;

  const indices: number[] = new Array<number>(count).fill(0);
  const filled: boolean[] = new Array<boolean>(count).fill(false);
  let block = 0;

  for (const stitch of stitches) {
    if (stitch.command === 'colorChange') {
      if (block + 1 < count) block++;
      continue;
    }
    if (filled[block]) continue;
    if (stitch.command !== 'stitch' && stitch.command !== 'lock') continue;
    indices[block] = stitch.colorIndex;
    filled[block] = true;
  }

  // A block with nothing sewn in it inherits the colour before it rather than
  // claiming the first thread in the palette.
  for (let i = 1; i < count; i++) if (!filled[i]) indices[i] = indices[i - 1]!;
  return { count, indices };
}

/**
 * Map each block to a colour library slot.
 *
 * Two different threads nearest-matching the same slot would leave the machine
 * asking for one thread twice with nothing to tell them apart, so the second
 * one is pushed to its next-best colour instead.
 */
function buildPalette(blocks: number[], threads: ThreadColor[]): number[] {
  const palette: number[] = [];
  let lastIndex: number | null = null;
  let lastKey: string | null = null;

  for (const colorIndex of blocks) {
    const thread: ThreadColor | null | undefined = threads[colorIndex];
    let slot = nearestJefIndex(thread ?? null);
    const key = thread?.hex ? thread.hex.toLowerCase() : '';

    if (lastIndex !== null && slot === lastIndex && lastKey !== null && lastKey !== key) {
      slot = nearestJefIndex(thread ?? null, slot);
    }

    palette.push(slot);
    lastIndex = slot;
    lastKey = key;
  }
  return palette;
}

/** The hoop number a design of this size is declared to fit. */
export function jefHoopSize(width: number, height: number): number {
  if (width < 500 && height < 500) return 1; // 50 x 50
  if (width < 1260 && height < 1100) return 3; // 126 x 110
  if (width < 1400 && height < 2000) return 2; // 140 x 200
  if (width < 2000 && height < 2000) return 4; // 200 x 200
  return 0; // 110 x 110 - the only hoop left that always accepts a file
}

/**
 * Encode a generated stitch sequence as a Janome JEF file.
 *
 * Millimeter coordinates are scaled to 0.1 mm units, moves beyond the single
 * move limit are chained, and each colour block opens with a jump so the
 * needle never drags thread across the hoop to reach its first point.
 */
export function writeJef(stitches: Stitch[], options: JefWriteOptions = {}): Uint8Array {
  if (!Array.isArray(stitches)) throw new TypeError('stitches must be an array');
  if (stitches.length === 0) throw new JefEncodingError('The design has no stitches.');

  const trims = options.trims ?? true;
  const { count: colorCount, indices } = colourBlocks(stitches);
  const palette = buildPalette(indices, options.threads ?? []);

  // --- records ------------------------------------------------------------
  const body: number[] = [];
  let px = 0;
  let py = 0;
  // False until the needle has taken a stitch in this colour block. The first
  // point of a block is approached with jumps rather than sewn towards it.
  let sewing = false;

  // The size the header declares is measured here, on the same rounded
  // 0.1 mm grid the records use, because it describes the path the needle
  // takes: a trim carries no movement and a colour change happens where the
  // needle already stands, so neither can make the design bigger. That is why
  // a design whose furthest point is only ever touched by a trim still
  // reports the size it actually sews - which is what the reference's own
  // header says, since the encoder rewrites those two to the needle first.
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

  for (const stitch of stitches) {
    const ax = Math.round(stitch.x / JEF_MM_PER_UNIT);
    const ay = Math.round(stitch.y / JEF_MM_PER_UNIT);
    const dx = ax - px;
    const dy = ay - py;
    // A trim, a colour change and the end marker are notes about where the
    // needle already stands: their coordinate is not a destination, so the
    // running position stays put and the travel belongs to the next command.
    const movesNeedle =
      stitch.command !== 'trim' && stitch.command !== 'colorChange' && stitch.command !== 'end';
    // Where the needle stood before this command - the origin a chained move
    // counts its hops from.
    const sx = px;
    const sy = py;
    const hops = movesNeedle ? planJefMove(dx, dy) : [];
    if (movesNeedle) {
      // Every hop is somewhere the needle really goes, so every one of them
      // counts towards the size the header declares: a chain that opens a
      // block from the machine's home passes nearer the edge than any point
      // the design ever names. A stop measures nothing extra, because it
      // happens where the needle already stands - and a cut measures nothing
      // at all, since it travels nowhere.
      for (const hop of hops) measure(sx + hop.fx, sy + hop.fy);
      px = ax;
      py = ay;
    } else if (stitch.command !== 'trim') {
      measure(px, py);
    }

    switch (stitch.command) {
      case 'end':
        // The end record is written once, after the loop.
        break;

      case 'trim': {
        // A cut is only worth writing when thread is in the fabric. One
        // arriving right after a colour change - which already stops the
        // machine - is the reference's cue to write nothing, and a file that
        // asked for two cuts in a row would only have the machine ignore the
        // second one.
        if (sewing && trims) {
          for (let i = 0; i < DEFAULT_TRIM_RECORDS; i++) {
            pushEscape(body, CONTROL_JUMP, 0, 0);
          }
        }
        // Cutting ends this run of sewing whether or not the file says so.
        sewing = false;
        break;
      }

      case 'colorChange': {
        pushEscape(body, CONTROL_COLOR, 0, 0);
        sewing = false;
        break;
      }

      case 'jump': {
        // An explicit jump is written even when it goes nowhere: the design
        // asked to move without sewing, and silence would lose that. The
        // travel that reopens a colour block is a different thing - there the
        // needle only moves if there is somewhere to go.
        for (const hop of hops) pushEscape(body, CONTROL_JUMP, hop.x, hop.y);
        break;
      }

      case 'stitch':
      case 'lock':
      default: {
        if (!sewing) {
          // Open the block by travelling to its first point with jumps, then
          // take the stitch where it lands. A block that already starts at
          // the needle has nowhere to go, so nothing is written for it.
          if (dx !== 0 || dy !== 0) {
            for (const hop of hops) pushEscape(body, CONTROL_JUMP, hop.x, hop.y);
          }
          pushStitch(body, 0, 0);
        } else {
          for (let i = 0; i < hops.length; i++) {
            const hop = hops[i]!;
            if (i === hops.length - 1) {
              pushStitch(body, hop.x, hop.y);
            } else {
              pushEscape(body, CONTROL_JUMP, hop.x, hop.y);
            }
          }
        }
        sewing = true;
        break;
      }
    }
  }
  body.push(ESCAPE, CONTROL_END);

  // --- header -------------------------------------------------------------
  if (!Number.isFinite(minX)) {
    // Nothing the needle could travel to: a file of stops and cuts alone has
    // no size to declare.
    minX = maxX = 0;
    minY = maxY = 0;
  }
  const designWidth = roundHalfToEven(maxX - minX);
  const designHeight = roundHalfToEven(maxY - minY);
  const halfWidth = roundHalfToEven(designWidth / 2);
  const halfHeight = roundHalfToEven(designHeight / 2);

  const out: number[] = [];
  const pushInt32 = (value: number): void => {
    const v = value | 0;
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };

  pushInt32(JEF_HEADER_BYTES + colorCount * JEF_COLOR_SLOT_BYTES);
  pushInt32(RESERVED_VERSION);
  const date = (options.date ?? defaultDate()).slice(0, 14).padEnd(14, '0');
  for (let i = 0; i < 14; i++) out.push(date.charCodeAt(i) & 0xff);
  out.push(0, 0);
  pushInt32(colorCount);
  pushInt32(body.length / 2);
  pushInt32(jefHoopSize(designWidth, designHeight));
  pushInt32(halfWidth);
  pushInt32(halfHeight);
  pushInt32(halfWidth);
  pushInt32(halfHeight);

  // Slack at each edge of each hoop the machine knows, -1 where the design
  // does not fit.
  for (const hoop of JEF_SLACK_HOOPS) {
    const x = hoop.halfW - halfWidth;
    const y = hoop.halfH - halfHeight;
    if (Math.min(x, y) >= 0) {
      pushInt32(x);
      pushInt32(y);
      pushInt32(x);
      pushInt32(y);
    } else {
      pushInt32(-1);
      pushInt32(-1);
      pushInt32(-1);
      pushInt32(-1);
    }
  }

  for (const slot of palette) pushInt32(slot);
  for (let i = 0; i < colorCount; i++) pushInt32(THREAD_TYPE_WORD);
  for (const byte of body) out.push(byte & 0xff);

  return Uint8Array.from(out);
}

// --- reading ---------------------------------------------------------------

function int32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

export interface JefReadResult {
  stitches: Stitch[];
  /** Colour library slot per colour block, in sewing order. */
  paletteIndices: number[];
}

/**
 * Parse a JEF file back into stitches.
 *
 * @throws JefEncodingError when the header does not describe a JEF file
 */
export function readJef(bytes: Uint8Array): JefReadResult {
  if (!(bytes instanceof Uint8Array) || bytes.length < JEF_HEADER_BYTES) {
    throw new JefEncodingError('The file is too short to be a JEF file.');
  }

  const stitchOffset = int32(bytes, 0);
  const colorCount = int32(bytes, 0x18);
  if (stitchOffset < JEF_HEADER_BYTES || stitchOffset > bytes.length) {
    throw new JefEncodingError(
      `The header points at byte ${stitchOffset}, outside this ${bytes.length}-byte file.`,
    );
  }
  if (colorCount < 0 || colorCount > 4096) {
    throw new JefEncodingError(`The header claims ${colorCount} colour blocks.`);
  }
  if (JEF_HEADER_BYTES + colorCount * 4 > stitchOffset) {
    throw new JefEncodingError('The colour table runs past the start of the stitches.');
  }

  const paletteIndices: number[] = [];
  for (let i = 0; i < colorCount; i++) {
    paletteIndices.push(Math.abs(int32(bytes, JEF_HEADER_BYTES + i * 4)));
  }

  // Parse the records first, then decide what the runs of them mean: a trim
  // is three zero-distance jumps, and that only becomes visible once the
  // records are in a row. Deltas are held exactly as the file spells them -
  // machine space, y-up - and flipped on the way out, which keeps one
  // convention in play instead of two half-applied ones.
  type Raw = { control: number; dx: number; dy: number };
  const raw: Raw[] = [];
  let pos = stitchOffset;
  let finished = false;

  while (pos + 2 <= bytes.length) {
    const b0 = bytes[pos]!;
    const b1 = bytes[pos + 1]!;
    pos += 2;

    if (b0 !== ESCAPE) {
      raw.push({ control: 0, dx: signed8(b0), dy: signed8(b1) });
      continue;
    }

    if (pos + 2 > bytes.length) break;
    const p0 = bytes[pos]!;
    const p1 = bytes[pos + 1]!;
    pos += 2;
    const dx = signed8(p0);
    const dy = signed8(p1);

    if (b1 === CONTROL_END) {
      raw.push({ control: CONTROL_END, dx: 0, dy: 0 });
      finished = true;
      break;
    }
    raw.push({ control: b1, dx, dy });
    if (b1 === CONTROL_COLOR || b1 === CONTROL_JUMP) continue;
    // An unrecognised control still moves the needle by its payload, so the
    // position tracked below stays honest instead of drifting from there on.
  }
  if (!finished && raw.length === 0) {
    throw new JefEncodingError('The file has no stitch records.');
  }

  const stitches: Stitch[] = [];
  let x = 0;
  let y = 0;
  let seq = 0;

  const push = (command: Stitch['command']): void => {
    stitches.push({
      x: x * JEF_MM_PER_UNIT,
      // Mirror of the writer's negation: the file holds y-up machine
      // coordinates, and the design space is y-down, so flip back on read.
      y: -y * JEF_MM_PER_UNIT,
      command,
      colorIndex: 0,
      objectId: null,
      sequence: seq++,
    });
  };

  for (let i = 0; i < raw.length; i++) {
    const record = raw[i]!;

    if (record.control === CONTROL_COLOR) {
      // A colour change may carry a destination in a file this studio did not
      // write; ours writes zero and does not move.
      x += record.dx;
      y += record.dy;
      push('colorChange');
      continue;
    }

    if (record.control === CONTROL_JUMP && record.dx === 0 && record.dy === 0) {
      // Three of these in a row are the format's trim. A shorter run is hops
      // on the spot, which a design may have meant literally.
      let run = 1;
      while (
        run < DEFAULT_TRIM_RECORDS &&
        i + run < raw.length &&
        raw[i + run]!.control === CONTROL_JUMP &&
        raw[i + run]!.dx === 0 &&
        raw[i + run]!.dy === 0
      ) {
        run++;
      }
      if (run >= DEFAULT_TRIM_RECORDS) {
        i += run - 1;
        push('trim');
        continue;
      }
    }

    x += record.dx;
    y += record.dy;
    // A normal record has no control; any escape that is not a colour change
    // or the end marker is a move without sewing.
    push(record.control === 0 ? 'stitch' : 'jump');
  }

  return { stitches, paletteIndices };
}

/** File extension for this format. */
export const JEF_EXTENSION = '.jef';

/** No media type is registered for JEF; it is served as opaque bytes. */
export const JEF_MIME = 'application/octet-stream';
