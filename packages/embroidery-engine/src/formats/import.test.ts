import { describe, it, expect } from 'vitest';
import { detectFormat, importMachineFile, ImportError, FORMAT_LABELS } from './import.js';
import { writeDst } from './dst.js';
import { writePes, readPes, PEC_SIGNATURE, PEC_CHART_NAMES, pecChartColor } from './pes.js';
import { writeExp } from './exp.js';
import { writeVp3 } from './vp3.js';
import { writeTbf } from './tbf.js';
import { writeHus } from './hus.js';
import type { Stitch, StitchCommand, ThreadColor } from '../types.js';

const stitch = (
  x: number,
  y: number,
  command: StitchCommand = 'stitch',
  colorIndex = 0,
): Stitch => ({
  x,
  y,
  command,
  colorIndex,
  objectId: null,
  sequence: 0,
});

/** A small two-colour design: a bar, a colour change, then a second bar. */
function sample(): Stitch[] {
  const stitches: Stitch[] = [];
  for (let i = 0; i <= 10; i++) stitches.push(stitch(i, 0, 'stitch', 0));
  stitches.push(stitch(10, 0, 'colorChange', 1));
  for (let i = 0; i <= 10; i++) stitches.push(stitch(10 + i, 5, 'stitch', 1));
  return stitches;
}

const THREADS: ThreadColor[] = [
  { id: 'c1', code: '1001', name: 'Red', hex: '#FF0000' },
  { id: 'c2', code: '1002', name: 'White', hex: '#FFFFFF' },
];

/** Build a standalone .pec by taking the PEC block out of a PES. */
function standalonePec(): Uint8Array {
  const pes = writePes(sample(), { name: 'PEC TEST', colorCount: 2, threads: THREADS });
  const pecOffset = pes[8]! | (pes[9]! << 8) | (pes[10]! << 16) | ((pes[11]! << 24) >>> 0);
  const body = pes.slice(pecOffset);
  const signature = Array.from(PEC_SIGNATURE).map((c) => c.charCodeAt(0));
  return Uint8Array.from([...signature, ...body]);
}

describe('detectFormat', () => {
  it('recognises each format by its signature', () => {
    expect(detectFormat(writeDst(sample(), { name: 'X', colorCount: 1 }), 'whatever.bin')).toBe(
      'dst',
    );
    expect(detectFormat(writePes(sample(), { colorCount: 1 }), 'whatever.bin')).toBe('pes');
    expect(detectFormat(standalonePec(), 'whatever.bin')).toBe('pec');
  });

  it('falls back to the extension, which EXP needs because it has no header', () => {
    const exp = writeExp(sample());
    expect(detectFormat(exp, 'design.exp')).toBe('exp');
    expect(detectFormat(exp)).toBeNull();
  });

  it('rejects something that is not a machine file', () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(detectFormat(junk, 'photo.png')).toBeNull();
    expect(detectFormat(junk, 'photo.jpg')).toBeNull();
    expect(detectFormat(junk)).toBeNull();
  });
});

describe('importMachineFile', () => {
  it('round-trips a DST and says the colours are placeholders', () => {
    const bytes = writeDst(sample(), { name: 'SMOKE', colorCount: 2 });
    const imported = importMachineFile(bytes, { filename: 'smoke.dst' });

    expect(imported.format).toBe('dst');
    expect(imported.name).toBe('SMOKE');
    expect(imported.stitches.length).toBeGreaterThan(0);
    expect(imported.paletteIsPlaceholder).toBe(true);
    // Two colour blocks were found, so two placeholder threads came back.
    expect(imported.colorCount).toBe(2);
    expect(imported.palette).toHaveLength(2);
    expect(imported.palette[0]!.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(imported.notes.join(' ')).toMatch(/placeholder/i);
  });

  it('recovers Brother thread colours and names from a PES', () => {
    const bytes = writePes(sample(), { name: 'ROSE', colorCount: 2, threads: THREADS });
    const imported = importMachineFile(bytes, { filename: 'rose.pes' });

    expect(imported.format).toBe('pes');
    expect(imported.paletteIsPlaceholder).toBe(false);
    expect(imported.palette).toHaveLength(2);
    expect(imported.palette[0]!.brand).toBe('Brother');
    // Red maps to Brother's Red, white to its White.
    expect(imported.palette[0]!.name).toBe('Red');
    expect(imported.palette[1]!.name).toBe('White');
    expect(imported.palette[0]!.hex).toBe('#ED171F');
  });

  it('reads a standalone .pec', () => {
    const imported = importMachineFile(standalonePec(), { filename: 'standalone.pec' });

    expect(imported.format).toBe('pec');
    expect(imported.stitches.length).toBeGreaterThan(0);
    expect(imported.palette).toHaveLength(2);
  });

  it('reads an EXP when told what it is', () => {
    const bytes = writeExp(sample());
    const imported = importMachineFile(bytes, { filename: 'design.exp' });

    expect(imported.format).toBe('exp');
    expect(imported.name).toBe('design');
    expect(imported.paletteIsPlaceholder).toBe(true);
    expect(imported.palette).toHaveLength(2);
  });

  it('keeps stitch positions through the round trip', () => {
    const source = sample();
    const imported = importMachineFile(writeDst(source, { name: 'POS', colorCount: 2 }));

    const sewn = imported.stitches.filter((s) => s.command === 'stitch');
    expect(sewn.length).toBeGreaterThanOrEqual(source.filter((s) => s.command === 'stitch').length);
    // DST quantises to 0.1 mm; nothing should drift further than half a unit.
    for (const s of sewn) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
    const first = sewn[0]!;
    expect(Math.abs(first.x - 0)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(first.y - 0)).toBeLessThanOrEqual(0.05);
  });

  it('reports the bounding box of the imported design', () => {
    const imported = importMachineFile(writeDst(sample(), { name: 'B', colorCount: 2 }));
    expect(imported.bounds.maxX).toBeGreaterThan(imported.bounds.minX);
    expect(imported.bounds.maxY).toBeGreaterThan(imported.bounds.minY);
  });

  it('renumbers colour blocks so the palette index always resolves', () => {
    const imported = importMachineFile(writePes(sample(), { colorCount: 2, threads: THREADS }));

    for (const s of imported.stitches) {
      expect(s.colorIndex).toBeGreaterThanOrEqual(0);
      expect(s.colorIndex).toBeLessThan(imported.palette.length);
    }
    expect(imported.stitches.some((s) => s.colorIndex === 1)).toBe(true);
  });

  it('names an unnamed file after the file name', () => {
    const imported = importMachineFile(writeExp(sample()), {
      filename: 'C:\\jobs\\client logo.exp',
    });
    expect(imported.name).toBe('client logo');
  });

  it('rejects an empty file, junk, and a file with no stitches', () => {
    expect(() => importMachineFile(new Uint8Array(0))).toThrow(ImportError);
    expect(() => importMachineFile(Uint8Array.from([1, 2, 3]), { filename: 'x.png' })).toThrow(
      ImportError,
    );

    // A DST header with no records at all.
    const empty = writeDst([], { name: 'EMPTY', colorCount: 1 });
    expect(() => importMachineFile(empty)).toThrow(/no stitches/i);
  });

  it('says what went wrong rather than throwing something opaque', () => {
    const truncated = writePes(sample(), { colorCount: 1 }).slice(0, 40);
    expect(() => importMachineFile(truncated)).toThrow(/Could not read the Brother PES file/);
  });

  it('labels every format', () => {
    expect(FORMAT_LABELS.dst).toBe('Tajima DST');
    expect(FORMAT_LABELS.pes).toBe('Brother PES');
    expect(FORMAT_LABELS.pec).toBe('Brother PEC');
    expect(FORMAT_LABELS.exp).toBe('Melco EXP');
  });
});

describe('Brother chart accessors', () => {
  it('exposes the chart colour and name for an index', () => {
    expect(pecChartColor(5)).toEqual({ r: 237, g: 23, b: 31 });
    expect(PEC_CHART_NAMES[5]).toBe('Red');
    expect(PEC_CHART_NAMES).toHaveLength(65);
  });

  it('wraps out-of-range indices instead of returning undefined', () => {
    expect(pecChartColor(1000)).toEqual(pecChartColor(1000 % 65));
    expect(pecChartColor(-1)).toEqual(pecChartColor(64));
  });

  it('agrees with what the reader reports for a written file', () => {
    const bytes = writePes(sample(), { colorCount: 2, threads: THREADS });
    const parsed = readPes(bytes);
    expect(parsed.paletteIndices).toHaveLength(2);
    expect(parsed.paletteIndices[0]).toBe(5); // Red
    expect(parsed.paletteIndices[1]).toBe(29); // White
  });
});

describe('VP3, TBF and HUS detection', () => {
  it('recognises each by its own signature, not its name', () => {
    const vp3 = writeVp3(sample(), THREADS);
    expect(detectFormat(vp3, 'whatever.bin')).toBe('vp3');

    const tbf = writeTbf(sample(), THREADS, 'Sample');
    expect(detectFormat(tbf, 'whatever.bin')).toBe('tbf');

    const hus = writeHus(sample(), THREADS, 'Sample');
    expect(detectFormat(hus, 'whatever.bin')).toBe('hus');
  });

  it('falls back to the extension when no signature is present', () => {
    expect(detectFormat(new Uint8Array(32), 'design.vp3')).toBe('vp3');
    expect(detectFormat(new Uint8Array(32), 'design.tbf')).toBe('tbf');
    expect(detectFormat(new Uint8Array(32), 'design.hus')).toBe('hus');
  });

  it('does not mistake another file for one of these', () => {
    // A DST opens with its own label record, so its signature wins over the
    // name it was given.
    expect(detectFormat(writeDst(sample(), { name: 'X', colorCount: 1 }), 'x.hus')).toBe('dst');
    // With no signature to go on the extension is the last resort, which is
    // what EXP depends on - an unreadable file is reported as such on the
    // next step rather than passed off as some other format here.
    expect(detectFormat(new Uint8Array(8), 'x.vp3')).toBe('vp3');
  });

  it('labels each format for the interface', () => {
    expect(FORMAT_LABELS.vp3).toBe('Husqvarna VP3');
    expect(FORMAT_LABELS.tbf).toBe('TBF');
    expect(FORMAT_LABELS.hus).toBe('Husqvarna HUS');
  });
});

describe('VP3, TBF and HUS import', () => {
  it('brings back the stitches, palette and colour count', () => {
    for (const [bytes, format] of [
      [writeVp3(sample(), THREADS), 'vp3'],
      [writeTbf(sample(), THREADS, 'Sample'), 'tbf'],
      [writeHus(sample(), THREADS, 'Sample'), 'hus'],
    ] as const) {
      const design = importMachineFile(bytes, { format });
      expect(design.format).toBe(format);
      expect(design.stitches.length).toBeGreaterThan(0);
      // Two colour blocks in, two threads out - the palette travels with
      // the file rather than being invented here.
      expect(design.colorCount).toBe(2);
      expect(design.palette).toHaveLength(2);
      expect(design.paletteIsPlaceholder).toBe(false);
      expect(design.bounds.maxX).toBeGreaterThan(design.bounds.minX);
    }
  });

  it('names the imported design when the format carries a name', () => {
    expect(importMachineFile(writeTbf(sample(), THREADS, 'Orchid'), { format: 'tbf' }).name).toBe(
      'Orchid',
    );
    expect(importMachineFile(writeHus(sample(), THREADS, 'Tulip'), { format: 'hus' }).name).toBe(
      'Tulip',
    );
  });

  it('numbers the colour blocks in sewing order', () => {
    const design = importMachineFile(writeVp3(sample(), THREADS), { format: 'vp3' });
    const indices = design.stitches.map((s) => s.colorIndex);
    expect(new Set(indices).size).toBe(2);
  });

  it('says what the format could not tell us', () => {
    const design = importMachineFile(writeHus(sample(), THREADS, 'Sample'), { format: 'hus' });
    expect(design.notes.join(' ')).toMatch(/machine library/i);
  });
});
