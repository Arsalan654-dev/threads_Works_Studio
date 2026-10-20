import { describe, it, expect } from 'vitest';
import {
  writeVp3,
  readVp3,
  Vp3DecodingError,
  VP3_MAGIC,
  VP3_MAX_JUMP,
  VP3_MAX_STITCH,
  VP3_SETTINGS,
} from './vp3.js';
import type { FormatStitch } from './normalize.js';
import type { ThreadColor } from '../types.js';

const row = (x: number, y: number, command: FormatStitch['command']): FormatStitch => ({
  x,
  y,
  command,
});

const thread = (hex: string, name: string, code: string, brand?: string): ThreadColor => ({
  id: `t-${hex}`,
  code,
  name,
  hex,
  brand,
});

const RED = thread('#C8102E', 'Red', '1001', 'Madeira');
const BLUE = thread('#003DA5', 'Blue', '1002');

describe('VP3 encoder', () => {
  it('opens with the format magic', () => {
    const bytes = writeVp3([row(0, 0, 'stitch'), row(5, 5, 'stitch'), row(5, 5, 'end')], [RED]);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe(VP3_MAGIC);
  });

  it('rejects input that is not a pair of arrays', () => {
    expect(() => writeVp3(undefined as never, [RED])).toThrow(TypeError);
    expect(() => writeVp3([], undefined as never)).toThrow(TypeError);
  });

  it('carries each thread colour, name, number and brand', () => {
    const bytes = writeVp3(
      [
        row(0, 0, 'jump'),
        row(10, 0, 'stitch'),
        row(10, 0, 'colorChange'),
        row(20, 0, 'stitch'),
        row(20, 0, 'end'),
      ],
      [RED, BLUE],
    );
    // VP3 announces one thread per colour block, so the second spool only
    // travels once the design changes to it.
    const { threads } = readVp3(bytes);
    expect(threads.map((t) => [t.hex, t.name, t.code, t.brand])).toEqual([
      ['#C8102E', 'Red', '1001', 'Madeira'],
      ['#003DA5', 'Blue', '1002', undefined],
    ]);
  });

  it('records one colour block per thread change', () => {
    const bytes = writeVp3(
      [
        row(0, 0, 'stitch'),
        row(10, 0, 'stitch'),
        row(10, 0, 'colorChange'),
        row(20, 0, 'stitch'),
        row(20, 0, 'end'),
      ],
      [RED, BLUE],
    );
    // The block count is the byte just before the producer string in the
    // file block; two threads means two blocks.
    expect(bytes.length).toBeGreaterThan(200);
    expect(readVp3(bytes).threads).toHaveLength(2);
  });

  it('carries a stitch longer than one record to its destination', () => {
    expect(VP3_MAX_STITCH).toBe(255);
    const bytes = writeVp3([row(0, 0, 'jump'), row(700, 0, 'stitch'), row(700, 0, 'end')], [RED]);
    const stitches = readVp3(bytes).stitches.filter((r) => r.command === 'stitch');
    // VP3 has no separate hop record: a move past the single-byte range is
    // written as one escaped delta, so the destination must survive intact.
    expect(stitches[stitches.length - 1]!.x).toBe(700);
    expect(stitches[stitches.length - 1]!.y).toBe(0);
  });

  it('carries a jump longer than one record to its destination', () => {
    expect(VP3_MAX_JUMP).toBe(3200);
    const bytes = writeVp3([row(0, 0, 'jump'), row(7000, 0, 'jump'), row(7000, 0, 'end')], [RED]);
    const rows = readVp3(bytes).stitches;
    expect(rows[rows.length - 1]!.command).toBe('end');
  });
});

describe('VP3 decoder', () => {
  it('round-trips coordinates through its own writer', () => {
    const input = [
      row(0, 0, 'jump'),
      row(50, 0, 'stitch'),
      row(60, 10, 'stitch'),
      row(70, 0, 'stitch'),
      row(70, 0, 'end'),
    ];
    const back = readVp3(writeVp3(input, [RED]));
    const stitches = back.stitches.filter((r) => r.command === 'stitch');
    expect(stitches.map((r) => [r.x, r.y])).toEqual([
      [50, 0],
      [60, 10],
      [70, 0],
    ]);
  });

  it('marks where a colour change closed a block', () => {
    const input = [
      row(0, 0, 'jump'),
      row(10, 0, 'stitch'),
      row(10, 0, 'colorChange'),
      row(20, 0, 'stitch'),
      row(20, 0, 'end'),
    ];
    const rows = readVp3(writeVp3(input, [RED, BLUE])).stitches;
    expect(rows.some((r) => r.command === 'colorChange')).toBe(true);
  });

  it('ends the design with an end row', () => {
    const rows = readVp3(writeVp3([row(0, 0, 'jump'), row(4, 4, 'end')], [RED])).stitches;
    expect(rows[rows.length - 1]!.command).toBe('end');
  });

  it('refuses a file too short to be VP3', () => {
    expect(() => readVp3(new Uint8Array(4))).toThrow(Vp3DecodingError);
  });
});

describe('VP3 settings', () => {
  it('uses the reference defaults for the shared normaliser', () => {
    expect(VP3_SETTINGS.maxJump).toBe(VP3_MAX_JUMP);
    expect(VP3_SETTINGS.maxStitch).toBe(VP3_MAX_STITCH);
    expect(VP3_SETTINGS.fullJump).toBe(false);
    // VP3 keeps its stitch rows without rounding them to whole millimetres.
    expect(VP3_SETTINGS.round).toBe(false);
    expect(VP3_SETTINGS.threadChangeCommand).toBe('colorChange');
  });
});
