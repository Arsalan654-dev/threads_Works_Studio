/**
 * Reading machine files back in.
 *
 * Every reader in this folder was written to prove an encoder; this module is
 * the front door that turns one of them into something the studio can show,
 * convert and render. It is deliberately *not* a route back into the editor's
 * object model: a DST is a flattened point list, so there are no shapes to
 * recover. What comes out is a stitch sequence, which is enough to preview,
 * re-export and film.
 */

import type { Bounds, Stitch, ThreadColor } from '../types.js';
import { boundsOfStitches, readDst } from './dst.js';
import {
  PEC_CHART_NAMES,
  PEC_SIGNATURE,
  PES_SIGNATURE,
  pecChartColor,
  readPec,
  readPes,
} from './pes.js';
import { readExp } from './exp.js';
import { JEF_COLOR_SLOT_BYTES, JEF_HEADER_BYTES, readJef } from './jef.js';
import { jefThreadAt } from './jefColors.js';
import { readVp3, VP3_MAGIC } from './vp3.js';
import { readTbf, TBF_NAME_OFFSET } from './tbf.js';
import { readHus, HUS_HEADER_LENGTH } from './hus.js';
import type { FormatStitch } from './normalize.js';

export type MachineFormat = 'dst' | 'pes' | 'pec' | 'exp' | 'jef' | 'vp3' | 'tbf' | 'hus';

export interface ImportedDesign {
  format: MachineFormat;
  /** Design name from the file, or the file name when it carries none. */
  name: string;
  stitches: Stitch[];
  /** One thread per colour block, in sewing order. */
  palette: ThreadColor[];
  colorCount: number;
  bounds: Bounds;
  /** True when the palette had to be invented because the format carries none. */
  paletteIsPlaceholder: boolean;
  /** What this format could not tell us, in plain language. */
  notes: string[];
}

export interface ImportOptions {
  /** File name: used for detection and as a fallback design name. */
  filename?: string;
  /** Force a format instead of detecting one. */
  format?: MachineFormat;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const BY_EXTENSION: Record<string, MachineFormat> = {
  dst: 'dst',
  pes: 'pes',
  pec: 'pec',
  exp: 'exp',
  jef: 'jef',
  vp3: 'vp3',
  tbf: 'tbf',
  hus: 'hus',
};

/** Distinct placeholder threads for formats that store no colours. */
const PLACEHOLDER_HEX = [
  '#C8102E',
  '#1B2A4A',
  '#0B7A3B',
  '#E8A33D',
  '#6A4C93',
  '#2E86AB',
  '#D64550',
  '#7BA05B',
];

export const FORMAT_LABELS: Record<MachineFormat, string> = {
  dst: 'Tajima DST',
  pes: 'Brother PES',
  pec: 'Brother PEC',
  exp: 'Melco EXP',
  jef: 'Janome JEF',
  vp3: 'Husqvarna VP3',
  tbf: 'TBF',
  hus: 'Husqvarna HUS',
};

function int32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

/**
 * JEF carries no magic string, so it is recognised by the shape of its fixed
 * header: a record offset that lands inside the file, a colour count whose
 * table fits before that offset, and fourteen digits of creation date at
 * +0x08. The reserved word at +0x04 is deliberately not part of the test -
 * the reference writes 0x14 there, a machine may write something else, and
 * only the date needs to agree for the shape to be unmistakable.
 */
function looksLikeJef(bytes: Uint8Array): boolean {
  if (bytes.length < JEF_HEADER_BYTES + JEF_COLOR_SLOT_BYTES) return false;
  const offset = int32le(bytes, 0);
  if (offset < JEF_HEADER_BYTES || offset > bytes.length) return false;
  if (offset % 4 !== 0) return false;
  const colors = int32le(bytes, 0x18);
  if (colors < 1 || colors > 4096) return false;
  if (JEF_HEADER_BYTES + colors * JEF_COLOR_SLOT_BYTES > offset) return false;
  for (let i = 0x08; i < 0x16; i++) {
    const digit = bytes[i]!;
    if (digit < 0x30 || digit > 0x39) return false;
  }
  return true;
}

function extensionOf(filename: string | undefined): string | null {
  if (filename === undefined) return null;
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * A TBF file is recognised by its version banner and by the label record the
 * format pins at a fixed offset - both together, so no other "3.00" file is
 * mistaken for one.
 */
function looksLikeTbf(bytes: Uint8Array): boolean {
  if (bytes.length < 0x93) return false;
  if (ascii(bytes, 0, 4) !== '3.00') return false;
  return ascii(bytes, TBF_NAME_OFFSET - 3, TBF_NAME_OFFSET) === 'LA:';
}

/**
 * A HUS file has no magic string, so it is recognised by its shape: three
 * offsets that step forward and land inside the file, a thread count whose
 * table fits before them, and the block tag the compressed streams all open
 * with. Any one of these alone is weak; together they are unmistakable.
 */
function looksLikeHus(bytes: Uint8Array): boolean {
  if (bytes.length < HUS_HEADER_LENGTH) return false;
  const colors = int32le(bytes, 8);
  if (colors < 0 || colors > 4096) return false;
  const commandOffset = int32le(bytes, 0x14);
  const xOffset = int32le(bytes, 0x18);
  const yOffset = int32le(bytes, 0x1c);
  if (commandOffset < HUS_HEADER_LENGTH + colors * 2) return false;
  if (!(xOffset > commandOffset) || !(yOffset > xOffset) || yOffset > bytes.length) return false;
  // Each stream opens with a 16-bit symbol count and then this tag.
  return (
    bytes[commandOffset + 2] === 0x02 &&
    bytes[commandOffset + 3] === 0xa0 &&
    bytes[commandOffset + 4] === 0x01 &&
    bytes[commandOffset + 5] === 0xfe
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Work out what a file is.
 *
 * Signatures first, because they are definitive; JEF has no magic string but
 * a header shape distinctive enough to recognise; the extension is the last
 * resort and what EXP depends on, since it has no header at all.
 */
export function detectFormat(bytes: Uint8Array, filename?: string): MachineFormat | null {
  if (bytes.length >= 8) {
    const signature = ascii(bytes, 0, 8);
    if (signature.startsWith(PES_SIGNATURE.slice(0, 4))) return 'pes';
    if (signature.startsWith(PEC_SIGNATURE.slice(0, 4))) return 'pec';
  }
  // A DST header starts with its label record, "LA:".
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'LA:') return 'dst';
  // VP3 opens with a magic string; TBF with its version banner.
  if (bytes.length >= VP3_MAGIC.length && ascii(bytes, 0, VP3_MAGIC.length) === VP3_MAGIC) {
    return 'vp3';
  }
  if (looksLikeTbf(bytes)) return 'tbf';
  if (looksLikeHus(bytes)) return 'hus';
  if (looksLikeJef(bytes)) return 'jef';

  const extension = extensionOf(filename);
  if (extension !== null && extension in BY_EXTENSION) return BY_EXTENSION[extension]!;
  return null;
}

function nameFromFilename(filename: string | undefined): string {
  if (filename === undefined) return 'Imported design';
  const base = filename
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .trim();
  return base === '' ? 'Imported design' : base;
}

/** Renumber colour blocks from the change commands, and count them. */
function reindexColors(stitches: Stitch[]): number {
  let colorIndex = 0;
  for (const stitch of stitches) {
    if (stitch.command === 'colorChange') colorIndex++;
    stitch.colorIndex = colorIndex;
  }
  return colorIndex + 1;
}

function placeholderThread(index: number): ThreadColor {
  const hex = PLACEHOLDER_HEX[index % PLACEHOLDER_HEX.length]!;
  return {
    id: `imported-${index + 1}`,
    code: `T${index + 1}`,
    name: `Thread ${index + 1}`,
    hex,
    brand: 'Imported',
  };
}

function chartHex(index: number): string {
  const { r, g, b } = pecChartColor(index);
  const hex = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/**
 * Turn a reader's row list into engine stitches.
 *
 * The three newer formats carry a bare machine stop, which the engine folds
 * into its colour change - the same "the machine pauses here" meaning - so a
 * stop survives the import as a pause the operator can see rather than being
 * dropped on the floor.
 */
function toEngineStitches(rows: readonly FormatStitch[]): Stitch[] {
  let colorIndex = 0;
  let seenStitch = false;
  const out: Stitch[] = [];
  for (const row of rows) {
    const command: Stitch['command'] = row.command === 'stop' ? 'colorChange' : row.command;
    if (command === 'colorChange') {
      // TBF announces its first needle before any sewing starts, which is
      // the machine loading its first spool - not changing to a second one.
      if (!seenStitch) continue;
      colorIndex += 1;
    }
    if (command === 'stitch' || command === 'jump') seenStitch = true;
    out.push({ x: row.x, y: row.y, command, colorIndex, objectId: null, sequence: out.length });
  }
  return out;
}

/**
 * Read a machine file into stitches and a palette.
 *
 * @throws ImportError when the format is unknown or the file cannot be read
 */
export function importMachineFile(bytes: Uint8Array, options: ImportOptions = {}): ImportedDesign {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ImportError('The file is empty.');
  }

  const format = options.format ?? detectFormat(bytes, options.filename);
  if (format === null) {
    throw new ImportError(
      'Not a machine file this studio recognises. Use .dst, .pes, .pec, .exp, .jef, .vp3, .tbf or .hus.',
    );
  }

  const notes: string[] = [];
  let stitches: Stitch[];
  let name = '';
  let chartPalette: number[] | null = null;
  let jefPalette: number[] | null = null;
  let carriedPalette: ThreadColor[] | null = null;
  let paletteNote = '';

  try {
    switch (format) {
      case 'dst': {
        const parsed = readDst(bytes);
        stitches = parsed.stitches;
        name = parsed.name;
        break;
      }
      case 'jef': {
        const parsed = readJef(bytes);
        stitches = parsed.stitches;
        jefPalette = parsed.paletteIndices;
        break;
      }
      case 'pes': {
        const parsed = readPes(bytes);
        stitches = parsed.stitches;
        name = parsed.name;
        chartPalette = parsed.paletteIndices;
        break;
      }
      case 'pec': {
        const parsed = readPec(bytes);
        stitches = parsed.stitches;
        name = parsed.name;
        chartPalette = parsed.paletteIndices;
        break;
      }
      case 'vp3': {
        const parsed = readVp3(bytes);
        stitches = toEngineStitches(parsed.stitches);
        carriedPalette = parsed.threads;
        paletteNote = 'Thread colours, names and numbers all come from the file.';
        break;
      }
      case 'tbf': {
        const parsed = readTbf(bytes);
        stitches = toEngineStitches(parsed.stitches);
        carriedPalette = parsed.threads;
        name = parsed.name;
        paletteNote =
          'TBF stores thread colours but not their names or numbers, so each was imported as a swatch.';
        break;
      }
      case 'hus': {
        const parsed = readHus(bytes);
        stitches = toEngineStitches(parsed.stitches);
        carriedPalette = parsed.threads;
        name = parsed.name;
        paletteNote =
          'HUS names each thread from the machine library rather than storing its colour, so the names are the ones your machine will show.';
        break;
      }
      case 'exp':
      default: {
        const parsed = readExp(bytes);
        stitches = parsed.stitches;
        break;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ImportError(`Could not read the ${FORMAT_LABELS[format]} file: ${reason}`);
  }

  if (stitches.length === 0) {
    throw new ImportError(`The ${FORMAT_LABELS[format]} file contains no stitches.`);
  }

  const colorCount = reindexColors(stitches);

  // --- palette ------------------------------------------------------------
  let palette: ThreadColor[];
  let paletteIsPlaceholder = false;

  if (chartPalette !== null) {
    palette = [];
    for (let i = 0; i < colorCount; i++) {
      const index = chartPalette[i] ?? chartPalette[chartPalette.length - 1] ?? 1;
      const safe =
        ((index % PEC_CHART_NAMES.length) + PEC_CHART_NAMES.length) % PEC_CHART_NAMES.length;
      palette.push({
        id: `imported-${i + 1}`,
        code: String(safe),
        name: PEC_CHART_NAMES[safe] ?? `Brother ${safe}`,
        hex: chartHex(safe),
        brand: 'Brother',
      });
    }
    notes.push('Thread colours are the Brother chart entries this file names.');
  } else if (carriedPalette !== null) {
    // The file carried a palette of its own; it is the design's, not ours.
    palette = carriedPalette.map((thread, i) => ({ ...thread, id: `imported-${i + 1}` }));
    while (palette.length < colorCount) palette.push(placeholderThread(palette.length));
    paletteIsPlaceholder = palette.length > carriedPalette.length;
    if (paletteNote !== '') notes.push(paletteNote);
  } else if (jefPalette !== null) {
    palette = [];
    let named = 0;
    for (let i = 0; i < colorCount; i++) {
      const thread = jefThreadAt(jefPalette[i] ?? 0);
      if (thread) {
        named++;
        palette.push({
          id: `imported-${i + 1}`,
          code: thread.catalog,
          name: `${thread.name} (${thread.catalog})`,
          hex: thread.hex,
          brand: 'Janome',
        });
      } else {
        palette.push(placeholderThread(i));
      }
    }
    paletteIsPlaceholder = named < colorCount;
    notes.push(
      named === colorCount
        ? 'Thread colours are the Janome colour numbers this file names.'
        : `This file names ${named} of its ${colorCount} colours, so the rest were filled with placeholders - set them to match your spools.`,
    );
  } else {
    paletteIsPlaceholder = true;
    palette = [];
    for (let i = 0; i < colorCount; i++) palette.push(placeholderThread(i));
    notes.push(
      format === 'dst'
        ? 'DST stores how many colour changes there are, but not the thread colours, so placeholder threads were added - set them to match your spools.'
        : 'EXP stores no colour information at all, so placeholder threads were added.',
    );
  }

  if (name.trim() === '') name = nameFromFilename(options.filename);
  notes.push(
    'A machine file is a flattened stitch list: the shapes that produced it cannot be recovered.',
  );

  return {
    format,
    name: name.trim(),
    stitches,
    palette,
    colorCount,
    bounds: boundsOfStitches(stitches),
    paletteIsPlaceholder,
    notes,
  };
}
