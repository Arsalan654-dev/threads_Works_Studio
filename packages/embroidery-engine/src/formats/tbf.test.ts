import { describe, it, expect } from 'vitest';
import {
  writeTbf,
  readTbf,
  TbfDecodingError,
  TBF_EXTENSION,
  TBF_MAX_STEP,
  TBF_NAME_LENGTH,
  TBF_NAME_OFFSET,
  TBF_NEEDLE_ORDER_OFFSET,
  TBF_THREADS_OFFSET,
  TBF_RECORDS_OFFSET,
  TBF_SETTINGS,
} from './tbf.js';
import type { FormatStitch } from './normalize.js';
import type { ThreadColor } from '../types.js';

const row = (x: number, y: number, command: FormatStitch['command']): FormatStitch => ({
  x,
  y,
  command,
});

const thread = (hex: string, name: string, code: string): ThreadColor => ({
  id: `t-${hex}`,
  code,
  name,
  hex,
});

const RED = thread('#C8102E', 'Red', '1001');
const BLUE = thread('#003DA5', 'Blue', '1002');

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

const DESIGN = [row(0, 0, 'jump'), row(50, 0, 'stitch'), row(60, 10, 'stitch'), row(60, 10, 'end')];

describe('TBF header layout', () => {
  it('opens with its version banner, padded to the first record', () => {
    const bytes = writeTbf(DESIGN, [RED], 'Design');
    expect(ascii(bytes, 0, 4)).toBe('3.00');
    expect(bytes[0x80]).toBe(0x4c); // "L" of "LA:"
  });

  it('pins the label at the offset a machine loader seeks to', () => {
    const bytes = writeTbf(DESIGN, [RED], 'Design');
    expect(ascii(bytes, TBF_NAME_OFFSET - 3, TBF_NAME_OFFSET)).toBe('LA:');
    expect(ascii(bytes, TBF_NAME_OFFSET, TBF_NAME_OFFSET + 6)).toBe('Design');
  });

  it('caps the label at the field width so every later record keeps its place', () => {
    const bytes = writeTbf(DESIGN, [RED], 'A Name Far Longer Than Sixteen');
    expect(readTbf(bytes).name).toBe('A Name Far Longe');
    // The needle order has to start at 0x10A whatever the design is called.
    expect(ascii(bytes, TBF_NEEDLE_ORDER_OFFSET - 3, TBF_NEEDLE_ORDER_OFFSET)).toBe('DO:');
    expect(bytes.length).toBeGreaterThan(TBF_RECORDS_OFFSET);
  });

  it('reports the stitch count and needle count in the header', () => {
    const bytes = writeTbf(DESIGN, [RED, BLUE], 'Design');
    const header = ascii(bytes, 0, 0x10a);
    // Two blocks means one needle set, and the rows are the normalised stream.
    expect(header).toContain('CO:  1');
  });

  it('opens the palette with the thread marker each slot carries', () => {
    const bytes = writeTbf(DESIGN, [RED, BLUE], 'Design');
    expect(bytes[TBF_THREADS_OFFSET]).toBe(0x45);
    // Red #C8102E follows immediately as three bytes.
    expect(bytes[TBF_THREADS_OFFSET + 1]).toBe(0xc8);
    expect(bytes[TBF_THREADS_OFFSET + 2]).toBe(0x10);
    expect(bytes[TBF_THREADS_OFFSET + 3]).toBe(0x2e);
  });

  it('names the extension it writes', () => {
    expect(TBF_EXTENSION).toBe('.tbf');
  });
});

describe('TBF records', () => {
  it('walks the design as deltas ending at the terminator', () => {
    const bytes = writeTbf(DESIGN, [RED], 'Design');
    expect(bytes[bytes.length - 1]).toBe(0x1a);
    // Three bytes per record: dx, dy (y negated), command.
    const records = bytes.length - 1 - TBF_RECORDS_OFFSET;
    expect(records % 3).toBe(0);
  });

  it('splits a move longer than the format limit into hops', () => {
    expect(TBF_MAX_STEP).toBe(127);
    const bytes = writeTbf(
      [row(0, 0, 'jump'), row(400, 100, 'jump'), row(400, 100, 'end')],
      [RED],
      'Design',
    );
    const rows = readTbf(bytes).stitches;
    const jumps = rows.filter((r) => r.command === 'jump');
    for (let i = 1; i < jumps.length; i++) {
      const step = Math.max(
        Math.abs(jumps[i]!.x - jumps[i - 1]!.x),
        Math.abs(jumps[i]!.y - jumps[i - 1]!.y),
      );
      expect(step).toBeLessThanOrEqual(TBF_MAX_STEP);
    }
  });

  it('round-trips coordinates through its own reader', () => {
    const back = readTbf(writeTbf(DESIGN, [RED], 'Design'));
    const stitches = back.stitches.filter((r) => r.command === 'stitch');
    expect(stitches.map((r) => [r.x, r.y])).toEqual([
      [50, 0],
      [60, 10],
    ]);
  });

  it('reads a needle set back as a colour change', () => {
    const input = [
      row(0, 0, 'jump'),
      row(10, 0, 'stitch'),
      row(10, 0, 'colorChange'),
      row(20, 0, 'stitch'),
      row(20, 0, 'end'),
    ];
    const back = readTbf(writeTbf(input, [RED, BLUE], 'Design'));
    expect(back.stitches.some((r) => r.command === 'colorChange')).toBe(true);
  });

  it('fills the needle order from each block', () => {
    const input = [
      row(0, 0, 'jump'),
      row(10, 0, 'stitch'),
      row(10, 0, 'colorChange'),
      row(20, 0, 'stitch'),
      row(20, 0, 'end'),
    ];
    const bytes = writeTbf(input, [RED, BLUE], 'Design');
    expect(bytes[TBF_NEEDLE_ORDER_OFFSET]).toBe(1);
    expect(bytes[TBF_NEEDLE_ORDER_OFFSET + 1]).toBe(2);
  });
});

describe('TBF settings', () => {
  it('uses the reference defaults for the shared normaliser', () => {
    expect(TBF_SETTINGS.maxJump).toBe(TBF_MAX_STEP);
    expect(TBF_SETTINGS.maxStitch).toBe(TBF_MAX_STEP);
    // TBF cuts before each colour change and opens the block with a needle.
    expect(TBF_SETTINGS.explicitTrim).toBe(true);
    expect(TBF_SETTINGS.threadChangeCommand).toBe('needleSet');
    // Every coordinate is a whole millimetre in this format.
    expect(TBF_SETTINGS.round).toBe(true);
  });

  it('names the field width it caps the label at', () => {
    expect(TBF_NAME_LENGTH).toBe(16);
  });
});

describe('TBF decoder', () => {
  it('refuses a file too short to hold its own header', () => {
    expect(() => readTbf(new Uint8Array(10))).toThrow(TbfDecodingError);
  });

  it('ends the design with an end row', () => {
    const back = readTbf(writeTbf(DESIGN, [RED], 'Design'));
    expect(back.stitches[back.stitches.length - 1]!.command).toBe('end');
  });

  it('imports every thread the design carries', () => {
    const back = readTbf(writeTbf(DESIGN, [RED, BLUE], 'Design'));
    expect(back.threads.map((t) => t.hex)).toEqual(['#C8102E', '#003DA5']);
  });
});
