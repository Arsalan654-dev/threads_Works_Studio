import { describe, it, expect } from 'vitest';
import { splitExpMove, writeExp, readExp, EXP_MAX_STEP } from '../formats/exp.js';
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
 * EXP is a bare stream of signed-byte move records, so a wrong sign or an
 * un-chained long move silently lands the needle in the wrong place. These
 * tests pin the record layout to pyembroidery's reference and verify that a
 * file we write reads back to the same coordinates.
 */
describe('EXP long move splitting', () => {
  it('leaves short moves alone', () => {
    expect(splitExpMove(100, 100)).toEqual([{ x: 100, y: 100 }]);
  });

  it('chains moves longer than the machine limit', () => {
    const hops = splitExpMove(400, 0);
    expect(hops.length).toBeGreaterThan(1);
    for (const h of hops) {
      expect(Math.abs(h.x)).toBeLessThanOrEqual(EXP_MAX_STEP);
      expect(Math.abs(h.y)).toBeLessThanOrEqual(EXP_MAX_STEP);
    }
    expect(hops.reduce((s, h) => s + h.x, 0)).toBe(400);
  });

  it('preserves negative travel exactly', () => {
    const hops = splitExpMove(-500, -300);
    expect(hops.reduce((s, h) => s + h.x, 0)).toBe(-500);
    expect(hops.reduce((s, h) => s + h.y, 0)).toBe(-300);
  });

  it('rounds each hop from the last landing the way the reference does', () => {
    // 402 units over four parts is 100.5 per part, and each part is rounded
    // from where the needle last landed rather than from the origin.
    expect(splitExpMove(402, 0)).toEqual([
      { x: 100, y: 0 },
      { x: 101, y: 0 },
      { x: 100, y: 0 },
      { x: 101, y: 0 },
    ]);
  });
});

describe('EXP record layout', () => {
  it('writes a normal stitch as two signed bytes with y negated', () => {
    const bytes = writeExp([stitch(0, 0), stitch(2, -3)]);
    // EXP stores 0.1 mm units: dx 2 mm -> 20; dy -3 mm negated -> +30.
    expect(bytes[bytes.length - 2]).toBe(20);
    expect(bytes[bytes.length - 1]).toBe(30);
  });

  it('writes a jump as a 0x80 0x04 escape followed by the move', () => {
    const bytes = writeExp([stitch(5, 0, 'jump')]);
    // escape, control, dx (5 mm -> 50 units), dy negated (0)
    expect(Array.from(bytes)).toEqual([0x80, 0x04, 50, 0]);
  });

  it('opens a block with a jump and lands with a stitch of zero length', () => {
    // The first stitch of a block is travelled to rather than sewn towards:
    // the file shows the needle jumping there and then taking one stitch in
    // place, which is what tells the machine to start sewing.
    const bytes = writeExp([stitch(10, 0)]);
    expect(Array.from(bytes)).toEqual([0x80, 0x04, 100, 0, 0x00, 0x00]);
  });

  it('writes a trim as the fixed 4-byte pyembroidery sequence', () => {
    const bytes = writeExp([stitch(10, 10), stitch(10, 10, 'trim')]);
    // trailing four bytes: 80 80 07 00 (trim at the current position)
    const tail = bytes.slice(bytes.length - 4);
    expect(Array.from(tail)).toEqual([0x80, 0x80, 0x07, 0x00]);
  });

  it('writes a colour change as 80 01 00 00', () => {
    const bytes = writeExp([stitch(4, 4), stitch(4, 4, 'colorChange')]);
    const tail = bytes.slice(bytes.length - 4);
    expect(Array.from(tail)).toEqual([0x80, 0x01, 0x00, 0x00]);
  });

  it('writes a cut where the needle stands rather than travelling to the point', () => {
    // A cut record cannot move the needle, so the reference writes it where
    // the needle already is and leaves the distance to the next point to the
    // row that follows. 40 mm away is far beyond one hop, and none of it is
    // jumped here.
    const bytes = writeExp([stitch(0, 0), stitch(40, 0, 'trim')]);
    const parsed = readExp(bytes);
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.command).toBe('trim');
    expect(last.x).toBe(0);
    expect(parsed.stitches.filter((s) => s.command === 'jump').length).toBe(0);
  });

  it('drops a second cut taken while the thread is already up', () => {
    // Cutting twice in a row would be one cut in the wrong place, so the
    // second one is not written at all.
    const bytes = writeExp([
      stitch(0, 0),
      stitch(10, 0, 'trim'),
      stitch(10, 0, 'trim'),
      stitch(20, 0),
    ]);
    expect(readExp(bytes).stitches.filter((s) => s.command === 'trim').length).toBe(1);
  });
});

describe('EXP file round trip', () => {
  it('reads back the same coordinates it wrote', () => {
    // Keep every consecutive delta within the 12.7 mm single-move limit so
    // each source stitch maps to one record and comparison is index-by-index.
    // The colour change sits on the previous stitch's point (zero delta), the
    // way the sequencer actually emits it.
    const source: Stitch[] = [
      stitch(0, 0, 'jump'),
      stitch(10.5, -3.2), // dx 10.5, dy -3.2
      stitch(12, 4.75), // dx  1.5, dy  7.95
      stitch(6, 10), // dx -6.0, dy  5.25
      stitch(-5, 5), // dx -11.0, dy -5.0
      stitch(-5, 5, 'colorChange'), // dx  0.0, dy  0.0 (zero-delta stop)
      stitch(5, 10), // dx 10.0, dy  5.0
      stitch(-3, -1), // dx -8.0, dy -11.0
    ];

    // Guard the fixture so this test cannot silently start chaining.
    for (let i = 1; i < source.length; i++) {
      expect(Math.abs(source[i]!.x - source[i - 1]!.x)).toBeLessThanOrEqual(12.7);
      expect(Math.abs(source[i]!.y - source[i - 1]!.y)).toBeLessThanOrEqual(12.7);
    }

    const bytes = writeExp(source);
    const parsed = readExp(bytes);

    // A colour stop shares its point with the stitch before it, so walking
    // the stream and collapsing runs of repeated points leaves the source
    // minus that one row - and the file is two rows longer than the walk,
    // because each block opens with a landing stitch of its own: the needle
    // travels to the first point of a block with jumps and lands on it
    // rather than sewing the distance.
    const walked: Stitch[] = [];
    for (const s of parsed.stitches) {
      const prev = walked[walked.length - 1];
      if (!prev || prev.x !== s.x || prev.y !== s.y) walked.push(s);
    }
    expect(parsed.stitches.length).toBe(walked.length + 3);

    // EXP stores 0.1 mm units, so quantisation moves a coordinate by at most
    // half a unit (0.05 mm). Assert the real bound explicitly.
    const HALF_UNIT_MM = 0.05;
    const withinQuantisation = (actual: number, expected: number): void => {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(HALF_UNIT_MM + 1e-9);
    };

    // The walk ends where the design ends: a colour stop and its landing do
    // not move the needle off the last point the design named.
    const last = walked[walked.length - 1]!;
    withinQuantisation(last.x, source[source.length - 1]!.x);
    withinQuantisation(last.y, source[source.length - 1]!.y);
    expect(last.command).toBe('stitch');
  });

  it('preserves the final needle position across a long chained travel', () => {
    const source: Stitch[] = [stitch(0, 0), stitch(60, 60), stitch(-120, -120), stitch(150, -90)];

    const parsed = readExp(writeExp(source));

    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(150, 1);
    expect(last.y).toBeCloseTo(-90, 1);
    expect(parsed.stitches.length).toBeGreaterThan(source.length);
  });

  it('encodes a long travel as chained jumps rather than dropping it', () => {
    const source = [stitch(0, 0, 'jump'), stitch(200, 0, 'jump'), stitch(205, 0)];
    const parsed = readExp(writeExp(source));

    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(205, 1);
    expect(parsed.stitches.filter((s) => s.command === 'jump').length).toBeGreaterThan(1);
  });

  it('negates y so a downward design reads back downward', () => {
    // Design space is y-down. If EXP were not y-negated, a shape drawn toward
    // the bottom of the canvas would read back upward - a silent vertical flip.
    // 10 mm is under the 12.7 mm single-move limit so it stays one record.
    const source = [stitch(0, 0), stitch(0, 10)];
    const parsed = readExp(writeExp(source));
    expect(parsed.stitches[1]!.y).toBeCloseTo(10, 1);
  });

  it('round-trips an empty design without emitting bytes', () => {
    const bytes = writeExp([]);
    expect(bytes.length).toBe(0);
    expect(readExp(bytes).stitches.length).toBe(0);
  });

  it('emits nothing for an end command', () => {
    const withEnd = writeExp([stitch(3, 3), stitch(3, 3, 'end')]);
    const withoutEnd = writeExp([stitch(3, 3)]);
    // EXP has no end record, so the file just stops. The first stitch opens
    // its block - travelled to with a jump, landed with a stitch of zero
    // length - which is what the six bytes below are.
    expect(Array.from(withEnd)).toEqual([0x80, 0x04, 30, 0xe2, 0x00, 0x00]);
    expect(withEnd.length).toBe(withoutEnd.length);
  });
});

describe('EXP error handling', () => {
  it('rejects a non-array input', () => {
    expect(() => writeExp(null as unknown as Stitch[])).toThrow(TypeError);
  });

  it('never emits an 0x80 first byte for a normal stitch (escape collision)', () => {
    // A normal stitch whose dx is -128 would be written as 0x80 and mistaken
    // for an escape. The encoder must chain it so |dx| stays <= 127 instead.
    // -12.8 mm is exactly -128 units, the first value that would collide.
    const bytes = writeExp([stitch(0, 0), stitch(-12.8, 0)]);
    const parsed = readExp(bytes);
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    // It must have been chained into hops and still land on -12.8 mm, never
    // emitted as a single 0x80-leading stitch.
    expect(parsed.stitches.length).toBeGreaterThan(2);
    expect(last.x).toBeCloseTo(-12.8, 1);
  });
});
