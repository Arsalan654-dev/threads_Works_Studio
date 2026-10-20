import type { ThreadColor } from '../types.js';

/**
 * The Husqvarna Viking thread library a HUS file indexes into.
 *
 * A HUS file does not store thread colours as RGB. Every slot in its palette
 * block is a 16-bit number pointing into the machine's own built-in thread
 * table, so a file that picked arbitrary numbers would name a thread the
 * operator does not own. The 29 entries below are that table; the RGB values
 * and English names are the reference set published with pyembroidery
 * (https://github.com/EmbroidePy/pyembroidery), MIT License, Copyright (c)
 * 2018 - kept here as data, not code, so an exported file can name a thread
 * that exists and an imported file can name the one it points at.
 *
 * Every index is real: unlike JEF there is no "unassigned" slot, so an
 * unknown colour has to be matched to its nearest neighbour rather than left
 * blank. The matching function below is ours.
 *
 * The distance used is the integer "red mean" formula from
 * https://www.compuphase.com/cmetric.htm - the same weighting a machine uses
 * when it has to collapse a photograph into the threads it owns. It favours
 * red and blue over green the way human vision does, which keeps a slightly
 * warm red from landing on the greens that sit nearby in raw RGB.
 */

export interface HusThread {
  /** '#rrggbb'. */
  hex: string;
  /** Thread name as the machine shows it. */
  name: string;
  /** Husqvarna thread number. */
  catalog: string;
}

/** The machine's thread table, in the order a HUS file stores its indices. */
export const HUS_THREADS: ReadonlyArray<HusThread> = [
  { hex: '#000000', name: 'Black', catalog: '026' },
  { hex: '#0000E7', name: 'Blue', catalog: '005' },
  { hex: '#00C600', name: 'Green', catalog: '002' },
  { hex: '#FF0000', name: 'Red', catalog: '014' },
  { hex: '#840084', name: 'Purple', catalog: '008' },
  { hex: '#FFFF00', name: 'Yellow', catalog: '020' },
  { hex: '#848484', name: 'Grey', catalog: '024' },
  { hex: '#8484E7', name: 'Light Blue', catalog: '006' },
  { hex: '#00FF84', name: 'Light Green', catalog: '003' },
  { hex: '#FF7B31', name: 'Orange', catalog: '017' },
  { hex: '#FF8CA5', name: 'Pink', catalog: '011' },
  { hex: '#845200', name: 'Brown', catalog: '028' },
  { hex: '#FFFFFF', name: 'White', catalog: '022' },
  { hex: '#000084', name: 'Dark Blue', catalog: '004' },
  { hex: '#008400', name: 'Dark Green', catalog: '001' },
  { hex: '#7B0000', name: 'Dark Red', catalog: '013' },
  { hex: '#FF6384', name: 'Light Red', catalog: '015' },
  { hex: '#522952', name: 'Dark Purple', catalog: '007' },
  { hex: '#FF00FF', name: 'Light Purple', catalog: '009' },
  { hex: '#FFDE00', name: 'Dark Yellow', catalog: '019' },
  { hex: '#FFFF9C', name: 'Light Yellow', catalog: '021' },
  { hex: '#525252', name: 'Dark Grey', catalog: '025' },
  { hex: '#D6D6D6', name: 'Light Grey', catalog: '023' },
  { hex: '#FF5208', name: 'Dark Orange', catalog: '016' },
  { hex: '#FF9C5A', name: 'Light Orange', catalog: '018' },
  { hex: '#FF52B5', name: 'Dark Pink', catalog: '010' },
  { hex: '#FFC6DE', name: 'Light Pink', catalog: '012' },
  { hex: '#523100', name: 'Dark Brown', catalog: '027' },
  { hex: '#B5A584', name: 'Light Brown', catalog: '029' },
];

function channel(hex: string, offset: number): number {
  const parsed = Number.parseInt(hex.replace('#', '').slice(offset, offset + 2), 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Squared colour distance with red mean weighting. */
function distance(a: string, b: string): number {
  const ar = channel(a, 0);
  const ag = channel(a, 2);
  const ab = channel(a, 4);
  const br = channel(b, 0);
  const bg = channel(b, 2);
  const bb = channel(b, 4);
  const rmean = (ar + br) / 2;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}

/**
 * The index of the machine thread closest to `hex`.
 *
 * The library is small and full of near-primaries, so an exported colour is
 * almost always snapped onto a thread the operator really has. Index 0 is
 * Black, which is a better default than anything far away.
 */
export function nearestHusThreadIndex(hex: string): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < HUS_THREADS.length; i++) {
    const candidate = distance(hex, HUS_THREADS[i]!.hex);
    if (candidate < bestDistance) {
      bestDistance = candidate;
      best = i;
    }
  }
  return best;
}

/**
 * A `ThreadColor` for the given index, so an imported design names the
 * thread it points at rather than showing a raw swatch.
 */
export function husThreadColor(index: number): ThreadColor {
  const entry = HUS_THREADS[index] ?? HUS_THREADS[0]!;
  return {
    id: `hus-${index}`,
    code: entry.catalog,
    name: entry.name,
    hex: entry.hex,
    brand: 'Husqvarna Viking',
  };
}
