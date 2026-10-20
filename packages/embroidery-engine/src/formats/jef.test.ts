import { describe, it, expect } from 'vitest';
import {
  JEF_COLOR_SLOT_BYTES,
  JEF_HEADER_BYTES,
  JEF_MAX_STEP,
  JefEncodingError,
  jefHoopSize,
  readJef,
  splitJefMove,
  writeJef,
} from './jef.js';
import { JEF_THREADS, nearestJefIndex, redMeanDistance, roundHalfToEven } from './jefColors.js';
import type { Stitch, ThreadColor } from '../types.js';

const stitch = (x: number, y: number, command: Stitch['command'] = 'stitch'): Stitch => ({
  x,
  y,
  command,
  colorIndex: 0,
  objectId: null,
  sequence: 0,
});

const thread = (hex: string): ThreadColor => ({
  id: hex,
  code: hex,
  name: hex,
  hex,
  brand: 'Test',
});

/** Read a 32-bit little-endian field out of a header. */
const field = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! |
  (bytes[offset + 1]! << 8) |
  (bytes[offset + 2]! << 16) |
  (bytes[offset + 3]! << 24);

const bodyOf = (bytes: Uint8Array): number[] => {
  const offset = field(bytes, 0);
  return Array.from(bytes.slice(offset));
};

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  Array.from(bytes.slice(start, end))
    .map((b) => String.fromCharCode(b))
    .join('');

/**
 * JEF was pinned against pyembroidery's JefWriter record for record. Each
 * expected body below is the literal byte stream that reference produced for
 * the same input, so a regression here is a file a machine would sew
 * differently - not a cosmetic difference.
 */
describe('JEF records against the reference', () => {
  it('opens a colour block with a jump, then sews the first point in place', () => {
    // Reference output for (1,1), (4,1), (4,4) mm:
    //   jump to the first point, sew there, then two ordinary stitches.
    const bytes = writeJef([stitch(1, 1), stitch(4, 1), stitch(4, 4)], { date: '20240101120000' });
    expect(bodyOf(bytes)).toEqual([
      0x80,
      0x02,
      0x0a,
      0xf6, // jump  (+10, +10)
      0x00,
      0x00, // sew   in place
      0x1e,
      0x00, // stitch (+30,   0)
      0x00,
      0xe2, // stitch (   0, +30)
      0x80,
      0x10, // end
    ]);
  });

  it('carries a colour change with no movement of its own', () => {
    // Reference output for (10,10), (40,10), colour change, (70,10) mm: the
    // stop is a flag where the needle already is, and the travel to the next
    // colour happens afterwards as jumps because the block reopens.
    const bytes = writeJef(
      [stitch(10, 10), stitch(40, 10), stitch(40, 10, 'colorChange'), stitch(70, 10)],
      { date: '20240101120000' },
    );
    expect(bodyOf(bytes)).toEqual([
      0x80,
      0x02,
      0x64,
      0x9c, // jump   (+100, +100)
      0x00,
      0x00, // sew    in place
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x64,
      0x00, // stitch (+100, 0)
      0x80,
      0x01,
      0x00,
      0x00, // colour change, no delta
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x00,
      0x00, // sew    in place
      0x80,
      0x10, // end
    ]);
  });

  it('writes a trim as three zero-distance jumps', () => {
    // Reference output for (10,10), (40,10), trim at (40,40), (60,60) mm.
    // The trim cuts where the needle stands; the travel to the trim point is
    // not the trim's to make, so it belongs to the next stitch.
    const bytes = writeJef(
      [stitch(10, 10), stitch(40, 10), stitch(40, 40, 'trim'), stitch(60, 60)],
      { date: '20240101120000' },
    );
    expect(bodyOf(bytes)).toEqual([
      0x80,
      0x02,
      0x64,
      0x9c, // jump   (+100, +100)
      0x00,
      0x00, // sew    in place
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x80,
      0x02,
      0x64,
      0x00, // hop    (+100, 0)
      0x64,
      0x00, // stitch (+100, 0)
      0x80,
      0x02,
      0x00,
      0x00, // trim, on the spot
      0x80,
      0x02,
      0x00,
      0x00,
      0x80,
      0x02,
      0x00,
      0x00,
      0x80,
      0x02,
      0x32,
      0x83, // hop    (+50, +125)
      0x80,
      0x02,
      0x32,
      0x83,
      0x80,
      0x02,
      0x32,
      0x83,
      0x80,
      0x02,
      0x32,
      0x83,
      0x00,
      0x00, // sew    in place
      0x80,
      0x10, // end
    ]);
  });

  it('splits a move that will not fit one record into equal hops', () => {
    const hops = splitJefMove(800, 800);
    // Reference divides 800 into ceil(800/127) = 7 parts: 114,115,114,114,
    // 114,115,114 - the same rounding the reference performs.
    expect(hops.map((h) => h.x)).toEqual([114, 115, 114, 114, 114, 115, 114]);
    expect(hops.reduce((sum, h) => sum + h.x, 0)).toBe(800);
    expect(hops.reduce((sum, h) => sum + h.y, 0)).toBe(800);
    for (const hop of hops) expect(Math.abs(hop.x)).toBeLessThanOrEqual(JEF_MAX_STEP);
  });

  it('leaves a move inside one record alone', () => {
    expect(splitJefMove(127, -127)).toEqual([{ x: 127, y: -127 }]);
    expect(splitJefMove(-50, 60)).toEqual([{ x: -50, y: 60 }]);
  });
});

describe('JEF header', () => {
  it('points at the records, counts the colours and measures the record area', () => {
    const source = [stitch(5, 5), stitch(15, 5), stitch(15, 5, 'colorChange'), stitch(25, 15)];
    const bytes = writeJef(source, { date: '20240101120000' });

    expect(field(bytes, 0)).toBe(JEF_HEADER_BYTES + 2 * JEF_COLOR_SLOT_BYTES);
    expect(field(bytes, 0x18)).toBe(2); // one slot per colour block
    expect(field(bytes, 0x1c)).toBe((bytes.length - field(bytes, 0)) / 2);
    // Every record is 2 or 4 bytes, so the record area is always a whole
    // number of 2-byte units - the count the machine reads.
    expect(field(bytes, 0x1c) * 2).toBe(bytes.length - field(bytes, 0));
  });

  it('writes the reserved word, the creation date and the thread types', () => {
    const bytes = writeJef([stitch(5, 5)], { date: '20240101120000' });
    expect(field(bytes, 4)).toBe(0x14);
    expect(ascii(bytes, 8, 22)).toBe('20240101120000');
    expect([bytes[22], bytes[23]]).toEqual([0, 0]);

    const paletteStart = JEF_HEADER_BYTES;
    const typeStart = paletteStart + 4;
    expect(field(bytes, typeStart)).toBe(0x0d);
  });

  it('defaults the date to now rather than leaving it blank', () => {
    const bytes = writeJef([stitch(5, 5)]);
    const date = ascii(bytes, 8, 22);
    expect(date).toMatch(/^\d{14}$/);
    expect(Number(date.slice(0, 4))).toBeGreaterThanOrEqual(2000);
  });

  it('declares the hoop the design fits and the slack it has in each one', () => {
    // A 60 x 60 mm design: 600 x 600 in 0.1 mm units, exactly the file the
    // reference was probed with, so every field below is its reported value.
    const bytes = writeJef([stitch(10, 10), stitch(70, 70)], { date: '20240101120000' });
    expect(field(bytes, 0x20)).toBe(3); // 126 x 110, the first hoop it fits
    expect(field(bytes, 0x24)).toBe(300); // half width, 0.1 mm
    expect(field(bytes, 0x28)).toBe(300); // half height
    expect(field(bytes, 0x2c)).toBe(300);
    expect(field(bytes, 0x30)).toBe(300);
    // 110 x 110 (550): 550 - 300 = 250 of slack on every edge.
    expect(field(bytes, 0x34)).toBe(250);
    expect(field(bytes, 0x38)).toBe(250);
    // 50 x 50 (250): it does not fit, and a negative slack would read as a
    // distance, so the reference writes four -1s instead of four negatives.
    expect(field(bytes, 0x44)).toBe(-1);
    expect(field(bytes, 0x48)).toBe(-1);
    expect(field(bytes, 0x4c)).toBe(-1);
    expect(field(bytes, 0x50)).toBe(-1);
    // 140 x 200 (700 x 1000) and the custom hoop both have room to spare.
    expect(field(bytes, 0x54)).toBe(400);
    expect(field(bytes, 0x58)).toBe(700);
    expect(field(bytes, 0x64)).toBe(400);
    expect(field(bytes, 0x68)).toBe(700);
  });

  it('keeps a small design inside the smallest hoop', () => {
    // 40 x 40 mm is under 50 x 50, so it claims that hoop and the 50 x 50
    // row reports real slack rather than the -1 a non-fitting design gets.
    const bytes = writeJef([stitch(10, 10), stitch(50, 50)], { date: '20240101120000' });
    expect(field(bytes, 0x20)).toBe(1); // 50 x 50
    expect(field(bytes, 0x24)).toBe(200);
    expect(field(bytes, 0x44)).toBe(50); // 250 - 200
  });

  it('picks a hoop by size, largest last', () => {
    expect(jefHoopSize(499, 499)).toBe(1); // 50 x 50
    expect(jefHoopSize(500, 499)).toBe(3); // 126 x 110
    expect(jefHoopSize(1260, 1100)).toBe(2); // 140 x 200
    expect(jefHoopSize(1400, 1999)).toBe(4); // 200 x 200
    expect(jefHoopSize(2000, 2000)).toBe(0); // 110 x 110
  });
});

describe('JEF colour library', () => {
  it('maps a known thread to its Janome number', () => {
    // The table's own entries are exact, so a round colour lands on itself.
    expect(nearestJefIndex(thread('#FF0000'))).toBe(10); // Red, 225
    expect(nearestJefIndex(thread('#0B2F84'))).toBe(12); // Blue, 207
    expect(nearestJefIndex(thread('#FFFFFF'))).toBe(2); // White, 001
    expect(JEF_THREADS[10]!.catalog).toBe('225');
    expect(JEF_THREADS.length).toBe(79);
    expect(JEF_THREADS[0]).toBeNull();
  });

  it('writes one slot per colour block, chosen from the block thread', () => {
    const source = [stitch(10, 10), stitch(40, 10), stitch(40, 10, 'colorChange'), stitch(70, 10)];
    source[0]!.colorIndex = 0;
    source[1]!.colorIndex = 0;
    source[3]!.colorIndex = 1;

    const bytes = writeJef(source, {
      date: '20240101120000',
      threads: [thread('#FF0000'), thread('#0B2F84')],
    });
    expect(field(bytes, 0x18)).toBe(2);
    expect(field(bytes, JEF_HEADER_BYTES)).toBe(10);
    expect(field(bytes, JEF_HEADER_BYTES + 4)).toBe(12);
  });

  it('does not let two different threads collapse onto one machine colour', () => {
    const source = [stitch(10, 10), stitch(40, 10), stitch(40, 10, 'colorChange'), stitch(70, 10)];
    source[0]!.colorIndex = 0;
    source[1]!.colorIndex = 0;
    source[3]!.colorIndex = 1;

    // Both are nearer to Red than to anything else; without the second pass
    // the machine would ask for one thread twice with nothing to tell apart.
    expect(nearestJefIndex(thread('#FF0001'))).toBe(nearestJefIndex(thread('#FE0002')));

    const bytes = writeJef(source, {
      date: '20240101120000',
      threads: [thread('#FF0001'), thread('#FE0002')],
    });
    const first = field(bytes, JEF_HEADER_BYTES);
    const second = field(bytes, JEF_HEADER_BYTES + 4);
    expect(first).not.toBe(second);
  });

  it('leaves a thread it knows nothing about unassigned', () => {
    expect(nearestJefIndex(null)).toBe(0);
    expect(nearestJefIndex(thread('not-a-colour'))).toBe(0);
    const bytes = writeJef([stitch(10, 10)], { date: '20240101120000' });
    expect(field(bytes, JEF_HEADER_BYTES)).toBe(0);
  });
});

describe('JEF round trip', () => {
  it('reads back the coordinates it wrote, y not flipped by mistake', () => {
    const source: Stitch[] = [
      stitch(20, 30),
      stitch(30.5, 33.25),
      stitch(40, 40),
      stitch(35, 45, 'colorChange'),
      stitch(50, 60),
      stitch(60, 62, 'trim'),
      stitch(75, 70),
    ];
    const parsed = readJef(writeJef(source, { date: '20240101120000' }));

    // The five sewn points survive; the trim and the colour change come back
    // as their own commands rather than as stitches.
    const sewn = parsed.stitches.filter((s) => s.command === 'stitch');
    expect(sewn.length).toBe(source.filter((s) => s.command === 'stitch').length);
    expect(parsed.stitches.length).toBeGreaterThanOrEqual(source.length);

    // Every point the design asked for is still on the path, within the
    // 0.1 mm the records can hold.
    const path = parsed.stitches;
    const hasPoint = (x: number, y: number): boolean =>
      path.some((s) => Math.abs(s.x - x) < 0.1 && Math.abs(s.y - y) < 0.1);
    for (const s of source) {
      if (s.command === 'stitch') expect(hasPoint(s.x, s.y)).toBe(true);
    }

    // y is stored upward: a point below the origin in design space must come
    // back below the origin, not mirrored onto it.
    expect(hasPoint(75, 70)).toBe(true);
    expect(hasPoint(75, -70)).toBe(false);
  });

  it('round trips trim and colour change as commands', () => {
    const source: Stitch[] = [
      stitch(10, 10),
      stitch(40, 10),
      stitch(40, 40, 'trim'),
      stitch(60, 60),
      stitch(60, 60, 'colorChange'),
      stitch(80, 60),
    ];
    const parsed = readJef(writeJef(source, { date: '20240101120000' }));
    const commands = parsed.stitches.map((s) => s.command);
    expect(commands).toContain('trim');
    expect(commands.filter((c) => c === 'colorChange').length).toBe(1);
    expect(commands[commands.length - 1]).toBe('stitch');
  });

  it('keeps the needle on the design path through a long travel', () => {
    // 60 mm of travel between colours: 12.7 mm hops, then a stitch on arrival.
    const source: Stitch[] = [stitch(10, 10), stitch(10, 10, 'colorChange'), stitch(70, 70)];
    const parsed = readJef(writeJef(source, { date: '20240101120000' }));
    const last = parsed.stitches[parsed.stitches.length - 1]!;
    expect(last.x).toBeCloseTo(70, 1);
    expect(last.y).toBeCloseTo(70, 1);
    expect(parsed.stitches.filter((s) => s.command === 'jump').length).toBeGreaterThan(1);
  });

  it('drops the trim records when the caller asks it to', () => {
    const source: Stitch[] = [stitch(10, 10), stitch(40, 40, 'trim'), stitch(60, 60)];
    const withTrims = readJef(writeJef(source, { date: '20240101120000', trims: true }));
    const withoutTrims = readJef(writeJef(source, { date: '20240101120000', trims: false }));
    expect(withTrims.stitches.some((s) => s.command === 'trim')).toBe(true);
    expect(withoutTrims.stitches.some((s) => s.command === 'trim')).toBe(false);
    // The needle still ends in the same place either way.
    const end = (list: Stitch[]): Stitch => list[list.length - 1]!;
    expect(end(withTrims.stitches).x).toBe(end(withoutTrims.stitches).x);
    expect(end(withTrims.stitches).y).toBe(end(withoutTrims.stitches).y);
  });

  it('counts colour blocks the same way the header claims', () => {
    const source: Stitch[] = [];
    for (let colour = 0; colour < 4; colour++) {
      if (colour > 0) source.push(stitch(10 + colour * 10, 10, 'colorChange'));
      source.push(stitch(10 + colour * 10, 10));
      source.push(stitch(20 + colour * 10, 20));
    }
    const bytes = writeJef(source, { date: '20240101120000' });
    expect(field(bytes, 0x18)).toBe(4);
    const parsed = readJef(bytes);
    expect(parsed.stitches.filter((s) => s.command === 'colorChange').length).toBe(3);
    expect(parsed.paletteIndices.length).toBe(4);
  });
});

describe('JEF error handling', () => {
  it('refuses to encode nothing', () => {
    expect(() => writeJef([])).toThrow(JefEncodingError);
    expect(() => writeJef(undefined as unknown as Stitch[])).toThrow(TypeError);
  });

  it('refuses to read a file that is not a JEF file', () => {
    expect(() => readJef(new Uint8Array(10))).toThrow(JefEncodingError);
    const bytes = writeJef([stitch(10, 10)], { date: '20240101120000' });
    // A record offset outside the file means the header is not describing one.
    const damaged = Uint8Array.from(bytes);
    damaged[0] = 0x7f;
    damaged[1] = 0xff;
    expect(() => readJef(damaged)).toThrow(JefEncodingError);
  });

  it('refuses a colour table that runs into the records', () => {
    const bytes = Uint8Array.from(writeJef([stitch(10, 10)], { date: '20240101120000' }));
    // Claim 4096 colours: the table would start long before the records do.
    bytes[0x18] = 0x00;
    bytes[0x19] = 0x10;
    expect(() => readJef(bytes)).toThrow(JefEncodingError);
  });
});

describe('JEF integer helpers', () => {
  it('rounds .5 to the even side, like the reference does', () => {
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    expect(roundHalfToEven(4.5)).toBe(4);
    expect(roundHalfToEven(62.5)).toBe(62);
    expect(roundHalfToEven(2.4)).toBe(2);
    expect(roundHalfToEven(2.6)).toBe(3);
  });

  it('scores a colour against itself as zero and symmetrically otherwise', () => {
    expect(redMeanDistance(10, 20, 30, 10, 20, 30)).toBe(0);
    expect(redMeanDistance(10, 20, 30, 200, 40, 90)).toBe(redMeanDistance(200, 40, 90, 10, 20, 30));
    // Red and green of the same strength are not scored the same: the
    // weighting is what makes a machine's nearest colour look nearest.
    expect(redMeanDistance(255, 0, 0, 0, 255, 0)).not.toBe(redMeanDistance(255, 0, 0, 0, 0, 255));
  });
});
