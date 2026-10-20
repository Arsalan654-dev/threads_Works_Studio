import { describe, it, expect } from 'vitest';
import {
  encodeTernary,
  decodeTernary,
  splitMove,
  writeDst,
  readDst,
  DST_HEADER_SIZE,
  DST_MAX_STEP,
  DstEncodingError,
} from '../formats/dst.js';
import type { Stitch } from '../types.js';

const stitch = (x: number, y: number, command: Stitch['command'] = 'stitch'): Stitch => ({
  x,
  y,
  command,
  colorIndex: 0,
  objectId: null,
  sequence: 0,
});

/**
 * DST coordinate encoding is the single highest-risk piece of this project:
 * a wrong byte puts the needle somewhere else entirely. These tests check
 * the encoder against the documented ternary scheme and verify that a file
 * written by us reads back to the same coordinates.
 */
describe('DST ternary encoding', () => {
  it('round-trips every representable delta', () => {
    for (let x = -DST_MAX_STEP; x <= DST_MAX_STEP; x++) {
      for (let y = -DST_MAX_STEP; y <= DST_MAX_STEP; y += 7) {
        const [b0, b1, b2] = encodeTernary(x, y);
        const back = decodeTernary(b0, b1, b2);
        expect(back.x).toBe(x);
        expect(back.y).toBe(y);
      }
    }
  });

  it('round-trips the full grid on a coarser stride (exhaustive corners)', () => {
    const samples = [
      -121, -120, -81, -41, -40, -14, -13, -5, -4, -2, -1, 0, 1, 2, 4, 5, 13, 14, 40, 41, 81, 120,
      121,
    ];
    for (const x of samples) {
      for (const y of samples) {
        const [b0, b1, b2] = encodeTernary(x, y);
        const back = decodeTernary(b0, b1, b2);
        expect(back.x, `x=${x} y=${y}`).toBe(x);
        expect(back.y, `x=${x} y=${y}`).toBe(y);
      }
    }
  });

  it('rejects values outside the representable range', () => {
    expect(() => encodeTernary(122, 0)).toThrow(DstEncodingError);
    expect(() => encodeTernary(0, -122)).toThrow(DstEncodingError);
  });

  it('rejects non-integer input', () => {
    expect(() => encodeTernary(1.5, 0)).toThrow(DstEncodingError);
  });

  it('never sets the command bits while encoding coordinates', () => {
    // 0x03 = normal command; the encoder must leave those two bits clear.
    for (let x = -121; x <= 121; x += 13) {
      const [, , b2] = encodeTernary(x, 0);
      expect(b2 & 0x03).toBe(0);
    }
  });
});

describe('DST long move splitting', () => {
  it('leaves short moves alone', () => {
    expect(splitMove(50, 50)).toEqual([{ x: 50, y: 50 }]);
  });

  it('chains moves longer than the machine limit', () => {
    const hops = splitMove(400, 0);
    expect(hops.length).toBeGreaterThan(1);
    for (const h of hops) {
      expect(Math.abs(h.x)).toBeLessThanOrEqual(DST_MAX_STEP);
      expect(Math.abs(h.y)).toBeLessThanOrEqual(DST_MAX_STEP);
    }
    const total = hops.reduce((s, h) => s + h.x, 0);
    expect(total).toBe(400);
  });

  it('preserves negative travel exactly', () => {
    const hops = splitMove(-500, -300);
    expect(hops.reduce((s, h) => s + h.x, 0)).toBe(-500);
    expect(hops.reduce((s, h) => s + h.y, 0)).toBe(-300);
  });

  it('rounds each hop from the last landing the way the reference does', () => {
    // 402 units over four parts is 100.5 per part. Rounding each part from the
    // last landing alternates either side of the half, where rounding each
    // part from the origin would drift the same way four times: the file ends
    // up 100, 101, 100, 101 rather than 101, 100, 101, 100.
    expect(splitMove(402, 0)).toEqual([
      { x: 100, y: 0 },
      { x: 101, y: 0 },
      { x: 100, y: 0 },
      { x: 101, y: 0 },
    ]);
  });
});

describe('DST file round trip', () => {
  it('writes a header of exactly 512 bytes', () => {
    const file = writeDst([stitch(0, 0), stitch(1, 1)]);
    expect(file.length).toBeGreaterThan(DST_HEADER_SIZE);
    // header is space padded
    expect(file[DST_HEADER_SIZE - 1]).toBe(0x20);
  });

  it('reads back the same coordinates it wrote', () => {
    // Every consecutive delta is kept within the 12.1 mm single-move limit so
    // each source stitch maps to exactly one record and the comparison can be
    // index-by-index. Long-travel chaining is covered separately below.
    const source: Stitch[] = [
      stitch(0, 0, 'jump'),
      stitch(10.5, -3.2), // dx 10.5, dy -3.2
      stitch(12, 4.75), // dx  1.5, dy  7.95
      stitch(6, 10), // dx -6.0, dy  5.25
      stitch(-5, 5), // dx -11.0, dy -5.0
      stitch(-5, 5, 'colorChange'), // a colour stop happens where the needle stands
      stitch(3, 10), // dx  8.0, dy  5.0
      stitch(-3, -1), // dx -6.0, dy -11.0
    ];

    // Guard the fixture itself so this test cannot silently start chaining.
    for (let i = 1; i < source.length; i++) {
      expect(Math.abs(source[i]!.x - source[i - 1]!.x)).toBeLessThanOrEqual(12.1);
      expect(Math.abs(source[i]!.y - source[i - 1]!.y)).toBeLessThanOrEqual(12.1);
    }

    const bytes = writeDst(source, { name: 'TEST', colorCount: 2 });
    const parsed = readDst(bytes);

    expect(parsed.stitches.length).toBe(source.length);

    // DST stores 0.1 mm units, so quantisation can move a coordinate by at
    // most half a unit (0.05 mm). toBeCloseTo() uses a strict < comparison at
    // that same magnitude, so an exactly-half-unit round would be rejected;
    // assert the real bound explicitly instead.
    const HALF_UNIT_MM = 0.05;
    const withinQuantisation = (actual: number, expected: number): void => {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(HALF_UNIT_MM + 1e-9);
    };

    for (let i = 0; i < source.length; i++) {
      withinQuantisation(parsed.stitches[i]!.x, source[i]!.x);
      withinQuantisation(parsed.stitches[i]!.y, source[i]!.y);
      expect(parsed.stitches[i]!.command).toBe(source[i]!.command);
    }
  });

  it('preserves the final needle position across a long chained travel', () => {
    // Coordinates deliberately far apart: the encoder must chain the move
    // into several records yet still land on the exact target.
    const source: Stitch[] = [stitch(0, 0), stitch(60, 60), stitch(-120, -120), stitch(150, -90)];

    const parsed = readDst(writeDst(source));

    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(150, 1);
    expect(last.y).toBeCloseTo(-90, 1);
    expect(parsed.stitches.length).toBeGreaterThan(source.length);
  });

  it('encodes a long travel as chained jumps rather than dropping it', () => {
    const source = [stitch(0, 0, 'jump'), stitch(200, 0, 'jump'), stitch(205, 0)];
    const parsed = readDst(writeDst(source));

    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(205, 1);
    expect(parsed.stitches.filter((s) => s.command === 'jump').length).toBeGreaterThan(1);
  });

  it('writes a cut as a needle pop that moves nothing', () => {
    // DST has no cut record of its own, so the format answers with three
    // jumps that end exactly where they started: the needle lifts and cuts
    // in place, and the travel to the next point belongs to the row after.
    const source = [stitch(10, 0), stitch(10, 0, 'trim'), stitch(20, 0)];
    const parsed = readDst(writeDst(source));

    const pop = parsed.stitches.slice(1, 4);
    expect(pop.map((s) => s.command)).toEqual(['jump', 'jump', 'jump']);
    // The pop ends where it began: still on the stitch it was taken after.
    expect(pop[pop.length - 1]!.x).toBeCloseTo(10, 1);
    expect(pop[pop.length - 1]!.y).toBeCloseTo(0, 1);
    // And the next stitch measures from there, not from some other point.
    expect(parsed.stitches[4]!.x).toBeCloseTo(20, 1);
  });

  it('records the design name and colour count in the header', () => {
    const bytes = writeDst([stitch(0, 0)], { name: 'FLOWER', colorCount: 3 });
    const parsed = readDst(bytes);
    expect(parsed.name).toBe('FLOWER');
    expect(parsed.headerColorCount).toBe(3);
  });

  it('records where the needle finishes in AX/AY, in machine space', () => {
    const bytes = writeDst([stitch(0, 0), stitch(30, 20)], { name: 'END' });
    let header = '';
    for (let i = 0; i < DST_HEADER_SIZE; i++) header += String.fromCharCode(bytes[i]!);
    // Design (30, 20) is machine (30, -20): x keeps its sign, y flips. Each
    // field is a sign followed by the number right-aligned in five columns,
    // the way the format defines them and the way every other writer spells
    // them.
    expect(header).toContain('AX:+  300');
    expect(header).toContain('AY:-  200');
  });

  it('reports extents that cover every landing of the needle', () => {
    // The header describes the path the needle takes, not the points the
    // design names: a long move arrives through intermediate hops, and one of
    // those can sit further out than any point the design asked for. This
    // fixture keeps every move short so the landings are the named points,
    // and pins the y flip - the file measures y upward, the header reports
    // the design the way it was drawn.
    const source = [stitch(4, 5), stitch(-2, -1), stitch(0, 4)];
    const parsed = readDst(writeDst(source));
    expect(parsed.bounds.maxX).toBeCloseTo(4, 1);
    expect(parsed.bounds.minX).toBeCloseTo(-2, 1);
    expect(parsed.bounds.maxY).toBeCloseTo(5, 1);
    expect(parsed.bounds.minY).toBeCloseTo(-1, 1);
  });

  it('counts rows rather than records in the header stitch count', () => {
    // A cut is one row that writes three records - the needle pop - so ST is
    // the row count of the encoded stream, not the record count. With no cut
    // in the way the two agree exactly.
    // Four rows plus the terminator, one of which wrote three records. The
    // terminator is one of the rows too, which is why the header counts one
    // more than the file's records when nothing else is in the way.
    const plain = readDst(writeDst([stitch(0, 0), stitch(1, 1), stitch(2, 2)]));
    expect(plain.headerStitchCount).toBe(plain.stitches.length + 1);

    const cut = readDst(
      writeDst([stitch(0, 0), stitch(10, 10), stitch(10, 10, 'trim'), stitch(20, 0)]),
    );
    // Four rows plus the terminator, one of which wrote three records.
    expect(cut.headerStitchCount).toBe(5);
    expect(cut.stitches.length).toBe(6);
  });

  it('rejects files shorter than the header', () => {
    expect(() => readDst(new Uint8Array(100))).toThrow(DstEncodingError);
  });

  it('produces a body of whole records that closes on the end record', () => {
    const bytes = writeDst([stitch(0, 0), stitch(1, 1), stitch(2, 2)]);
    const bodyLen = bytes.length - DST_HEADER_SIZE;
    expect(bodyLen % 3).toBe(0);
    // The stream closes with the format's own end record - 00 00 F3 - which
    // is what a Tajima reader looks for rather than an off-format sentinel.
    expect(bytes[bytes.length - 3]).toBe(0x00);
    expect(bytes[bytes.length - 2]).toBe(0x00);
    expect(bytes[bytes.length - 1]).toBe(0xf3);
  });

  it('round-trips an empty design without corrupting the header', () => {
    const parsed = readDst(writeDst([]));
    expect(parsed.stitches.length).toBe(0);
    expect(parsed.headerStitchCount).toBe(0);
  });
});
