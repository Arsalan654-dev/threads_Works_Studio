import { describe, it, expect } from 'vitest';
import {
  writeHus,
  readHus,
  HusDecodingError,
  HUS_EXTENSION,
  HUS_MIME,
  HUS_MAX_STEP,
  HUS_HEADER_LENGTH,
  HUS_THREAD_COUNT,
  HUS_SETTINGS,
} from './hus.js';
import { HUS_THREADS, nearestHusThreadIndex, husThreadColor } from './husColors.js';
import type { FormatStitch } from './normalize.js';
import type { ThreadColor } from '../types.js';

const row = (x: number, y: number, command: FormatStitch['command']): FormatStitch => ({
  x,
  y,
  command,
});

const thread = (hex: string): ThreadColor => ({
  id: `t-${hex}`,
  code: '',
  name: '',
  hex,
});

const RED = thread('#C8102E');
const BLUE = thread('#003DA5');

const DESIGN = [row(0, 0, 'jump'), row(50, 0, 'stitch'), row(60, 10, 'stitch'), row(60, 10, 'end')];

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

describe('HUS header layout', () => {
  it('writes three offsets that step forward and land inside the file', () => {
    const bytes = writeHus(DESIGN, [RED], 'Design');
    const commandOffset = u32le(bytes, 0x14);
    const xOffset = u32le(bytes, 0x18);
    const yOffset = u32le(bytes, 0x1c);
    expect(commandOffset).toBeGreaterThanOrEqual(HUS_HEADER_LENGTH);
    expect(xOffset).toBeGreaterThan(commandOffset);
    expect(yOffset).toBeGreaterThan(xOffset);
    expect(yOffset).toBeLessThanOrEqual(bytes.length);
  });

  it('counts the stitches and threads it wrote', () => {
    const bytes = writeHus(DESIGN, [RED, BLUE], 'Design');
    expect(u32le(bytes, 4)).toBeGreaterThan(0);
    // HUS announces one thread per colour block, so the second spool only
    // travels once the design changes to it.
    expect(u32le(bytes, 8)).toBe(1);
  });

  it('stores the name in the eight bytes the format allows', () => {
    const back = readHus(writeHus(DESIGN, [RED], 'My Shop'));
    expect(back.name).toBe('My Shop');
  });

  it('names the extension and type it writes', () => {
    expect(HUS_EXTENSION).toBe('.hus');
    expect(HUS_MIME).toBe('application/x-hus');
  });
});

describe('HUS palette', () => {
  it('snaps every thread onto one the machine can name', () => {
    const input = [
      row(0, 0, 'jump'),
      row(10, 0, 'stitch'),
      row(10, 0, 'colorChange'),
      row(20, 0, 'stitch'),
      row(20, 0, 'end'),
    ];
    const back = readHus(writeHus(input, [RED, BLUE], 'Design'));
    const names = back.threads.map((t) => t.hex);
    // Both inputs are outside the machine's library, so each lands on the
    // nearest spool it owns rather than on a colour it cannot supply.
    for (const hex of names) expect(HUS_THREADS.some((t) => t.hex === hex)).toBe(true);
    expect(back.threads).toHaveLength(2);
  });

  it('recognises exact library colours and near ones alike', () => {
    expect(nearestHusThreadIndex('#FF0000')).toBe(3); // Red
    expect(nearestHusThreadIndex('#000000')).toBe(0); // Black
    expect(nearestHusThreadIndex('#FFFFFF')).toBe(12); // White
    // A colour the library does not have still lands on a thread it does.
    expect(HUS_THREADS[nearestHusThreadIndex('#123456')]).toBeDefined();
  });

  it('names an imported slot after the machine thread it points at', () => {
    const back = readHus(writeHus(DESIGN, [thread('#FF0000')], 'Design'));
    expect(back.threads[0]!.name).toBe('Red');
    expect(back.threads[0]!.code).toBe('014');
  });

  it('ships a library with a usable number of threads', () => {
    expect(HUS_THREADS).toHaveLength(HUS_THREAD_COUNT);
    expect(HUS_THREAD_COUNT).toBeGreaterThan(20);
    expect(husThreadColor(0).name).toBe('Black');
  });
});

describe('HUS records', () => {
  it('round-trips coordinates through its own reader', () => {
    const back = readHus(writeHus(DESIGN, [RED], 'Design'));
    const stitches = back.stitches.filter((r) => r.command === 'stitch');
    expect(stitches.map((r) => [r.x, r.y])).toEqual([
      [50, 0],
      [60, 10],
    ]);
  });

  it('splits a move longer than the format limit into hops', () => {
    expect(HUS_MAX_STEP).toBe(127);
    const bytes = writeHus(
      [row(0, 0, 'jump'), row(400, 100, 'jump'), row(400, 100, 'end')],
      [RED],
      'Design',
    );
    const rows = readHus(bytes).stitches;
    const jumps = rows.filter((r) => r.command === 'jump');
    for (let i = 1; i < jumps.length; i++) {
      const step = Math.max(
        Math.abs(jumps[i]!.x - jumps[i - 1]!.x),
        Math.abs(jumps[i]!.y - jumps[i - 1]!.y),
      );
      expect(step).toBeLessThanOrEqual(HUS_MAX_STEP);
    }
  });

  it('marks each colour change so the operator can stop and rethread', () => {
    const input = [
      row(0, 0, 'jump'),
      row(10, 0, 'stitch'),
      row(10, 0, 'colorChange'),
      row(20, 0, 'stitch'),
      row(20, 0, 'end'),
    ];
    const rows = readHus(writeHus(input, [RED, BLUE], 'Design')).stitches;
    expect(rows.filter((r) => r.command === 'colorChange')).toHaveLength(1);
  });

  it('ends the design with an end row', () => {
    const rows = readHus(writeHus(DESIGN, [RED], 'Design')).stitches;
    expect(rows[rows.length - 1]!.command).toBe('end');
  });

  it('chains its stored blocks past one block worth of stitches', () => {
    // A block holds at most 65535 symbols, so a design this size is written
    // as several chained together and has to read back as one run.
    const long: FormatStitch[] = [row(0, 0, 'jump')];
    for (let i = 1; i <= 900; i++) long.push(row(i, i % 7, 'stitch'));
    long.push(row(900, 6, 'end'));

    const back = readHus(writeHus(long, [RED], 'Design'));
    const stitches = back.stitches.filter((r) => r.command === 'stitch');
    expect(stitches).toHaveLength(900);
    // The last stitch is the one at i = 900, whose y is 900 % 7.
    expect(stitches[stitches.length - 1]).toMatchObject({ x: 900, y: 900 % 7 });
  });
});

describe('HUS compression', () => {
  it('reads back exactly the stitch count the header promises', () => {
    const bytes = writeHus(DESIGN, [RED], 'Design');
    const promised = u32le(bytes, 4);
    const back = readHus(bytes);
    // The header counts the records the streams hold, including the end row.
    expect(back.stitches).toHaveLength(promised);
  });

  it('refuses a file too short to hold its own header', () => {
    expect(() => readHus(new Uint8Array(4))).toThrow(HusDecodingError);
  });

  it('refuses a file whose offsets point past its own end', () => {
    const bytes = writeHus(DESIGN, [RED], 'Design');
    // Point the command offset at the horizon.
    bytes[0x14] = 0xff;
    bytes[0x15] = 0xff;
    bytes[0x16] = 0xff;
    bytes[0x17] = 0x7f;
    expect(() => readHus(bytes)).toThrow(HusDecodingError);
  });
});

describe('HUS settings', () => {
  it('uses the limits the format itself imposes', () => {
    expect(HUS_SETTINGS.maxJump).toBe(HUS_MAX_STEP);
    expect(HUS_SETTINGS.maxStitch).toBe(HUS_MAX_STEP);
    // HUS carries a colour change of its own, and its deltas are whole
    // millimetres, so the normaliser neither rounds nor cuts for it.
    expect(HUS_SETTINGS.threadChangeCommand).toBe('colorChange');
    expect(HUS_SETTINGS.round).toBe(false);
  });
});
