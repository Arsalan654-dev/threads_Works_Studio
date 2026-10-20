import { describe, it, expect } from 'vitest';
import {
  writePes,
  readPes,
  nearestPecColorIndex,
  PES_SIGNATURE,
  PEC_HEADER_SIZE,
  PEC_CHART_SIZE,
  PEC_ICON_STRIDE,
  PEC_ICON_HEIGHT,
  PEC_MAX_BLOCK_BYTES,
  pecWriteBlockLength,
  PES_MM_PER_UNIT,
  PesEncodingError,
} from '../formats/pes.js';
import type { Stitch, ThreadColor } from '../types.js';

const stitch = (
  x: number,
  y: number,
  command: Stitch['command'] = 'stitch',
  colorIndex = 0,
): Stitch => ({
  x,
  y,
  command,
  colorIndex,
  objectId: null,
  sequence: 0,
});

const thread = (hex: string, name = 'Thread'): ThreadColor => ({
  id: 't',
  code: '000',
  name,
  hex,
});

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** Offset of the embedded PEC header, read from the pointer after the signature. */
function pecStart(bytes: Uint8Array): number {
  return bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | ((bytes[11]! << 24) >>> 0);
}

/**
 * PES wraps a PEC stitch block and a PES design block in one file. These tests
 * pin the container structure, the 512-byte PEC header geometry, and - most
 * importantly - that the stitch stream survives a round trip with the Brother
 * (non-negated) y convention.
 */
describe('Brother colour matching', () => {
  it('matches primary colours to the chart', () => {
    expect(nearestPecColorIndex('#ff0000')).toBe(5); // Red
    expect(nearestPecColorIndex('#000000')).toBe(20); // Black
    expect(nearestPecColorIndex('#ffffff')).toBe(29); // White
  });

  it('always returns a valid chart index above the unknown slot', () => {
    const samples = ['#123456', '#abcdef', '#0000ff', 'not-a-colour', '#f0f0f0'];
    for (const s of samples) {
      const idx = nearestPecColorIndex(s);
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(idx).toBeLessThan(PEC_CHART_SIZE);
    }
  });
});

describe('PES container structure', () => {
  it('starts with the PES signature followed by a valid PEC offset', () => {
    const bytes = writePes([stitch(0, 0), stitch(5, 5)], { name: 'TEST' });
    expect(ascii(bytes, 0, 8)).toBe(PES_SIGNATURE);

    const pecOffset =
      bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | ((bytes[11]! << 24) >>> 0);
    expect(pecOffset).toBeGreaterThan(12);
    expect(pecOffset).toBeLessThan(bytes.length);
    // A PES has no "#PEC0001": the offset lands straight on the PEC header,
    // which every reader (and the machine) parses from the "LA:" line.
    expect(ascii(bytes, pecOffset, pecOffset + 3)).toBe('LA:');
  });

  it('embeds the CEmbOne and CSewSeg design blocks', () => {
    const bytes = writePes([stitch(0, 0), stitch(10, 0), stitch(10, 10)], { name: 'T' });
    // Scan the ASCII of the whole file: the block names are plain text.
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    }
    expect(text.includes('CEmbOne')).toBe(true);
    expect(text.includes('CSewSeg')).toBe(true);
  });

  it('writes a 512-byte PEC header carrying the design label', () => {
    const bytes = writePes([stitch(0, 0), stitch(1, 1)], { name: 'FLOWER' });
    const pecOffset =
      bytes[8]! | (bytes[9]! << 8) | (bytes[10]! << 16) | ((bytes[11]! << 24) >>> 0);
    const headerStart = pecOffset; // the offset lands on the header itself
    // "LA:" + 16-byte label
    expect(ascii(bytes, headerStart, headerStart + 3)).toBe('LA:');
    expect(ascii(bytes, headerStart + 3, headerStart + 11)).toBe('FLOWER  ');
    // The stitch block must start exactly 512 bytes in.
    const blockStart = headerStart + PEC_HEADER_SIZE;
    expect(bytes[blockStart]).toBe(0x00);
    expect(bytes[blockStart + 1]).toBe(0x00);
  });

  it('stores the colour palette in the header', () => {
    // One entry per colour block the sequence declares - the same count the
    // reference's encoder carries into the file.
    const bytes = writePes(
      [
        stitch(0, 0, 'stitch', 0),
        stitch(5, 0, 'stitch', 0),
        stitch(5, 0, 'colorChange', 1),
        stitch(5, 5, 'stitch', 1),
        stitch(10, 5, 'stitch', 1),
      ],
      { name: 'C', colorCount: 2, threads: [thread('#ff0000'), thread('#ffffff')] },
    );
    const headerStart = pecStart(bytes);
    // offset 48 holds colour_changes = colour blocks - 1, then the indices.
    expect(bytes[headerStart + 48]).toBe(1);
    expect(bytes[headerStart + 49]).toBe(5); // Red
    expect(bytes[headerStart + 50]).toBe(29); // White
  });

  it('writes one palette entry per colour block, not per thread offered', () => {
    // A design with a single colour block and two threads on offer keeps only
    // the thread it actually reaches; the rest would be invented colour data.
    const bytes = writePes([stitch(0, 0), stitch(5, 5)], {
      name: 'C',
      colorCount: 2,
      threads: [thread('#ff0000'), thread('#ffffff')],
    });
    const headerStart = pecStart(bytes);
    expect(bytes[headerStart + 48]).toBe(0);
    expect(bytes[headerStart + 49]).toBe(5); // Red
    expect(bytes[headerStart + 50]).toBe(0x20); // padding, not a second index
  });

  it('gives two threads that match the same swatch a slot each', () => {
    // Both colours are nearer Black than anything else, so the raw chart would
    // put them on top of each other. The header palette de-duplicates, the way
    // pyembroidery's build_unique_palette does, so each block keeps a slot.
    const bytes = writePes(
      [
        stitch(0, 0),
        stitch(5, 0, 'colorChange', 1),
        stitch(5, 0),
        stitch(5, 5, 'colorChange', 1),
        stitch(10, 5),
      ],
      { name: 'D', threads: [thread('#010101'), thread('#030303')] },
    );
    const headerStart = pecStart(bytes);
    expect(bytes[headerStart + 48]).toBe(2);
    expect(bytes[headerStart + 49]).toBe(20); // Black
    expect(bytes[headerStart + 50]).not.toBe(20); // the second claim moves on
    expect(bytes[headerStart + 51]).not.toBe(20);
  });

  it('draws the real hoop icon into every thumbnail', () => {
    // The thumbnails are 6 x 38 monochrome frames, each starting from the fixed
    // hoop icon pyembroidery carries in PecGraphics, with the design drawn on
    // top: one preview plus one per colour block.
    const bytes = writePes(
      [stitch(0, 0), stitch(4, 0), stitch(4, 4, 'colorChange', 1), stitch(0, 4), stitch(0, 0)],
      { name: 'G', threads: [thread('#000000'), thread('#ff0000')] },
    );
    const headerStart = pecStart(bytes);
    const blockStart = headerStart + PEC_HEADER_SIZE;
    const blockLength =
      bytes[blockStart + 2]! | (bytes[blockStart + 3]! << 8) | (bytes[blockStart + 4]! << 16);
    const graphicsStart = blockStart + blockLength;

    const icon = PEC_ICON_STRIDE * PEC_ICON_HEIGHT;
    expect((bytes.length - graphicsStart) % icon).toBe(0);
    expect((bytes.length - graphicsStart) / icon).toBe(3); // preview + 2 blocks

    // Row 0 of the hoop icon is empty; row 1 is its full-width top border.
    expect(bytes[graphicsStart]).toBe(0x00);
    expect(bytes[graphicsStart + 6]).toBe(0xf0);
    expect(bytes[graphicsStart + 7]).toBe(0xff);
    expect(bytes[graphicsStart + 11]).toBe(0x0f);
    // Every block frame starts from the same icon.
    expect(bytes[graphicsStart + icon + 6]).toBe(0xf0);
  });

  it('round-trips an empty design without corrupting the container', () => {
    const bytes = writePes([]);
    expect(ascii(bytes, 0, 8)).toBe(PES_SIGNATURE);
    const parsed = readPes(bytes);
    expect(parsed.stitches.length).toBe(0);
  });
});

describe('PES / PEC stitch round trip', () => {
  it('reads back the same stitches it wrote', () => {
    // Starting at the origin keeps the first record a plain stitch (a non-zero
    // first point is expressed as a jump and covered separately below).
    const source: Stitch[] = [stitch(0, 0), stitch(2, 0), stitch(4, 0), stitch(6, 2), stitch(8, 4)];

    const parsed = readPes(writePes(source, { name: 'RT' }));

    expect(parsed.stitches.length).toBe(source.length);
    const HALF_UNIT_MM = 0.05;
    for (let i = 0; i < source.length; i++) {
      expect(Math.abs(parsed.stitches[i]!.x - source[i]!.x)).toBeLessThanOrEqual(
        HALF_UNIT_MM + 1e-9,
      );
      expect(Math.abs(parsed.stitches[i]!.y - source[i]!.y)).toBeLessThanOrEqual(
        HALF_UNIT_MM + 1e-9,
      );
      expect(parsed.stitches[i]!.command).toBe('stitch');
    }
  });

  it('does NOT negate y (Brother convention)', () => {
    // A stitch 20 mm toward the bottom of the canvas must read back at +20.
    const parsed = readPes(writePes([stitch(0, 0), stitch(0, 20)], { name: 'Y' }));
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.y).toBeCloseTo(20, 1);
  });

  it('expresses travel from the start point as a jump', () => {
    // The first stitch of a real design sits away from the machine's origin;
    // the encoder must jump there rather than drag a thread across the canvas.
    const parsed = readPes(writePes([stitch(50, 30), stitch(52, 30)], { name: 'S' }));
    const jump = parsed.stitches.find((s) => s.command === 'jump');
    expect(jump).toBeDefined();
    expect(jump!.x).toBeCloseTo(50, 1);
    expect(jump!.y).toBeCloseTo(30, 1);
    // The first penetration still lands on the first source stitch.
    const firstStitch = parsed.stitches.find((s) => s.command === 'stitch')!;
    expect(firstStitch.x).toBeCloseTo(50, 1);
    expect(firstStitch.y).toBeCloseTo(30, 1);
  });

  it('carries a distant trim as a trim jump', () => {
    const source = [stitch(0, 0), stitch(40, 0, 'trim'), stitch(40, 0), stitch(42, 0)];
    const parsed = readPes(writePes(source, { name: 'T' }));
    const trim = parsed.stitches.find((s) => s.command === 'trim');
    expect(trim).toBeDefined();
    // The needle must have travelled to the trim point, not cut at the origin.
    expect(trim!.x).toBeCloseTo(40, 1);
    expect(trim!.y).toBeCloseTo(0, 1);
  });

  it('drops the coordinate on a trim row and cuts at the needle', () => {
    // A trim row carries no travel of its own: the cut happens where the
    // needle already stands, and the thread is carried only as far as the
    // opening jump of the next block (which is where the cut flag travels).
    const source = [stitch(0, 0), stitch(4, 0), stitch(90, 90, 'trim'), stitch(8, 0)];
    const parsed = readPes(writePes(source, { name: 'T' }));

    const trim = parsed.stitches.find((s) => s.command === 'trim')!;
    expect(trim.x).toBeCloseTo(8, 1);
    expect(trim.y).toBeCloseTo(0, 1);
    // The stray 90, 90 point must never reach the machine.
    const travelled = parsed.stitches.some((s) => s.x > 50 || s.y > 50);
    expect(travelled).toBe(false);
  });

  it('swallows a colour change that precedes the first stitch', () => {
    // Nothing has been sewn yet, so there is no second block to announce: the
    // reference turns it into a silent thread bookkeeping entry.
    const source = [stitch(20, 20, 'colorChange', 1), stitch(0, 0), stitch(10, 0)];
    const parsed = readPes(writePes(source, { name: 'L', threads: [thread('#000000')] }));

    expect(parsed.stitches.filter((s) => s.command === 'colorChange')).toHaveLength(0);
    expect(parsed.colorCount).toBe(1);
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(10, 1);
  });

  it('records a colour change and keeps stitching after it', () => {
    const source = [
      stitch(0, 0, 'stitch', 0),
      stitch(5, 0, 'stitch', 0),
      stitch(5, 0, 'colorChange', 1),
      stitch(5, 5, 'stitch', 1),
      stitch(10, 5, 'stitch', 1),
    ];
    const parsed = readPes(writePes(source, { name: 'C', colorCount: 2 }));

    const change = parsed.stitches.find((s) => s.command === 'colorChange');
    expect(change).toBeDefined();

    // Everything after the colour change must be on the second colour block.
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(10, 1);
    expect(last.y).toBeCloseTo(5, 1);
    expect(last.colorIndex).toBe(1);
  });

  it('uses the short form for small moves and the long form for large ones', () => {
    // 3 mm is inside the one-byte range; 30 mm needs the two-byte form.
    const shortBytes = writePes([stitch(0, 0), stitch(3, 0)], { name: 'S' });
    const longBytes = writePes([stitch(0, 0), stitch(30, 0)], { name: 'L' });
    // A 3 mm stitch adds a single byte per axis, a 30 mm stitch two.
    expect(longBytes.length).toBeGreaterThan(shortBytes.length);
  });

  it('round-trips a long chained travel to the exact final position', () => {
    const source = [stitch(0, 0), stitch(60, 60), stitch(-120, -120), stitch(150, -90)];
    const parsed = readPes(writePes(source, { name: 'L' }));
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(150, 1);
    expect(last.y).toBeCloseTo(-90, 1);
  });

  it('preserves a design bound well inside the single-move limit', () => {
    // A 100 mm square exercises the long form on both axes in both directions.
    const source = [stitch(0, 0), stitch(100, 0), stitch(100, 100), stitch(0, 100)];
    const parsed = readPes(writePes(source, { name: 'SQ' }));
    const points = parsed.stitches.filter((s) => s.command === 'stitch');
    const last = points[points.length - 1]!;
    expect(last.x).toBeCloseTo(0, 1);
    expect(last.y).toBeCloseTo(100, 1);
  });
});

describe('PES error handling', () => {
  it('rejects non-array input', () => {
    expect(() => writePes(null as unknown as Stitch[])).toThrow(TypeError);
  });

  it('rejects a file without the PES signature', () => {
    expect(() => readPes(new Uint8Array(64))).toThrow(PesEncodingError);
  });

  it('rejects a file whose PEC offset is out of range', () => {
    const bytes = writePes([stitch(0, 0), stitch(1, 1)]);
    bytes[8] = 0xff;
    bytes[9] = 0xff;
    bytes[10] = 0xff;
    bytes[11] = 0x7f;
    expect(() => readPes(bytes)).toThrow(PesEncodingError);
  });

  it('uses one PEC unit per 0.1 mm', () => {
    expect(PES_MM_PER_UNIT).toBe(0.1);
  });

  it('writes the stitch block length as the three bytes the field allows', () => {
    const out = [0, 0, 0, 0];
    pecWriteBlockLength(out, 1, 0x123456);
    expect(out).toEqual([0, 0x56, 0x34, 0x12]);
  });

  it('refuses a block too big for the length field instead of wrapping it', () => {
    // The field holds 16,777,215 bytes. Beyond that the number would wrap and
    // the file would still be written - a machine would then read stitches
    // starting in the middle of nowhere - so the size is refused out loud.
    expect(PEC_MAX_BLOCK_BYTES).toBe(0xffffff);
    expect(() => pecWriteBlockLength([0, 0, 0, 0], 1, PEC_MAX_BLOCK_BYTES)).not.toThrow();
    expect(() => pecWriteBlockLength([0, 0, 0, 0], 1, PEC_MAX_BLOCK_BYTES + 1)).toThrow(
      PesEncodingError,
    );
  });
});
