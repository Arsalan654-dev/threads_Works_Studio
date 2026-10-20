import { roundHalfToEven } from './moves.js';

/**
 * The Janome colour library a JEF file indexes into.
 *
 * A JEF file does not store thread colours as RGB. Every colour block in the
 * header is a 32-bit slot holding a *number* into the machine's built-in
 * thread table, so a file that picked arbitrary numbers would name a thread
 * the operator does not have. The numbers below are Janome's own thread
 * numbers; the RGB values and English names are the reference set published
 * with pyembroidery (https://github.com/EmbroidePy/pyembroidery), MIT
 * License, Copyright (c) 2018 - kept here as data, not code, so an exported
 * file can suggest a thread that exists and an imported file can name one.
 *
 * Index 0 is the format's "no colour" slot and stays `null`; real threads
 * start at 1. The matching function below is ours.
 *
 * The distance used to pick a colour is the integer "red mean" formula from
 * https://www.compuphase.com/cmetric.htm - the same weighting a machine uses
 * when it has to collapse a photograph into the threads it owns. It favours
 * red and blue over green the way human vision does, which matters because
 * the two greens in this table are 20 units apart.
 */
import type { ThreadColor } from '../types.js';

export interface JefThread {
  /** '#rrggbb'. */
  hex: string;
  /** Thread name as the machine shows it. */
  name: string;
  /** Janome thread number. */
  catalog: string;
}

/** Every slot a JEF file may point at: 0 is "unassigned". */
export const JEF_THREADS: ReadonlyArray<JefThread | null> = [
  null,
  { hex: '#000000', name: 'Black', catalog: '002' },
  { hex: '#FFFFFF', name: 'White', catalog: '001' },
  { hex: '#FFFF17', name: 'Yellow', catalog: '204' },
  { hex: '#FF6600', name: 'Orange', catalog: '203' },
  { hex: '#2F5933', name: 'Olive Green', catalog: '219' },
  { hex: '#237336', name: 'Green', catalog: '226' },
  { hex: '#65C2C8', name: 'Sky', catalog: '217' },
  { hex: '#AB5A96', name: 'Purple', catalog: '208' },
  { hex: '#F669A0', name: 'Pink', catalog: '201' },
  { hex: '#FF0000', name: 'Red', catalog: '225' },
  { hex: '#B1704E', name: 'Brown', catalog: '214' },
  { hex: '#0B2F84', name: 'Blue', catalog: '207' },
  { hex: '#E4C35D', name: 'Gold', catalog: '003' },
  { hex: '#481A05', name: 'Dark Brown', catalog: '205' },
  { hex: '#AC9CC7', name: 'Pale Violet', catalog: '209' },
  { hex: '#FCF294', name: 'Pale Yellow', catalog: '210' },
  { hex: '#F999B7', name: 'Pale Pink', catalog: '211' },
  { hex: '#FAB381', name: 'Peach', catalog: '212' },
  { hex: '#C9A480', name: 'Beige', catalog: '213' },
  { hex: '#970533', name: 'Wine Red', catalog: '215' },
  { hex: '#A0B8CC', name: 'Pale Sky', catalog: '216' },
  { hex: '#7FC21C', name: 'Yellow Green', catalog: '218' },
  { hex: '#E5E5E5', name: 'Silver Gray', catalog: '220' },
  { hex: '#889B9B', name: 'Gray', catalog: '221' },
  { hex: '#98D6BD', name: 'Pale Aqua', catalog: '227' },
  { hex: '#B2E1E3', name: 'Baby Blue', catalog: '228' },
  { hex: '#368BA0', name: 'Powder Blue', catalog: '229' },
  { hex: '#4F83AB', name: 'Bright Blue', catalog: '230' },
  { hex: '#386A91', name: 'Slate Blue', catalog: '231' },
  { hex: '#071650', name: 'Navy Blue', catalog: '232' },
  { hex: '#F999A2', name: 'Salmon Pink', catalog: '233' },
  { hex: '#F9676B', name: 'Coral', catalog: '234' },
  { hex: '#E3311F', name: 'Burnt Orange', catalog: '235' },
  { hex: '#E2A188', name: 'Cinnamon', catalog: '236' },
  { hex: '#B59474', name: 'Umber', catalog: '237' },
  { hex: '#E4CF99', name: 'Blond', catalog: '238' },
  { hex: '#FFCB00', name: 'Sunflower', catalog: '239' },
  { hex: '#E1ADD4', name: 'Orchid Pink', catalog: '240' },
  { hex: '#C3007E', name: 'Peony Purple', catalog: '241' },
  { hex: '#80004B', name: 'Burgundy', catalog: '242' },
  { hex: '#540571', name: 'Royal Purple', catalog: '243' },
  { hex: '#B10525', name: 'Cardinal Red', catalog: '244' },
  { hex: '#CAE0C0', name: 'Opal Green', catalog: '245' },
  { hex: '#899856', name: 'Moss Green', catalog: '246' },
  { hex: '#5C941A', name: 'Meadow Green', catalog: '247' },
  { hex: '#003114', name: 'Dark Green', catalog: '248' },
  { hex: '#5DAE94', name: 'Aquamarine', catalog: '249' },
  { hex: '#4CBF8F', name: 'Emerald Green', catalog: '250' },
  { hex: '#007772', name: 'Peacock Green', catalog: '251' },
  { hex: '#595B61', name: 'Dark Gray', catalog: '252' },
  { hex: '#FFFFF2', name: 'Ivory White', catalog: '253' },
  { hex: '#B15818', name: 'Hazel', catalog: '254' },
  { hex: '#CB8A07', name: 'Toast', catalog: '255' },
  { hex: '#986C80', name: 'Salmon', catalog: '256' },
  { hex: '#98692D', name: 'Cocoa Brown', catalog: '257' },
  { hex: '#4D3419', name: 'Sienna', catalog: '258' },
  { hex: '#4C330B', name: 'Sepia', catalog: '259' },
  { hex: '#33200A', name: 'Dark Sepia', catalog: '260' },
  { hex: '#523A97', name: 'Violet Blue', catalog: '261' },
  { hex: '#0D217E', name: 'Blue Ink', catalog: '262' },
  { hex: '#1E77AC', name: 'Sola Blue', catalog: '263' },
  { hex: '#B2DD53', name: 'Green Dust', catalog: '264' },
  { hex: '#F33689', name: 'Crimson', catalog: '265' },
  { hex: '#DE649E', name: 'Floral Pink', catalog: '266' },
  { hex: '#984161', name: 'Wine', catalog: '267' },
  { hex: '#4C5612', name: 'Olive Drab', catalog: '268' },
  { hex: '#4C881F', name: 'Meadow', catalog: '269' },
  { hex: '#E4DE79', name: 'Mustard', catalog: '270' },
  { hex: '#CB8A1A', name: 'Yellow Ocher', catalog: '271' },
  { hex: '#CBA21C', name: 'Old Gold', catalog: '272' },
  { hex: '#FF9805', name: 'Honey Dew', catalog: '273' },
  { hex: '#FCB257', name: 'Tangerine', catalog: '274' },
  { hex: '#FFE505', name: 'Canary Yellow', catalog: '275' },
  { hex: '#F0331F', name: 'Vermilion', catalog: '202' },
  { hex: '#1A842D', name: 'Bright Green', catalog: '206' },
  { hex: '#386CAE', name: 'Ocean Blue', catalog: '222' },
  { hex: '#E3C4B4', name: 'Beige Gray', catalog: '223' },
  { hex: '#E3AC81', name: 'Bamboo', catalog: '224' },
];

/**
 * Re-exported from the shared move planner, because a JEF header carries two
 * halves - the design's half width and half height - that are compared against
 * the reference implementation's bytes, and colour matching averages channels
 * the same way. Keeping one definition means DST, EXP and JEF all round the
 * same hop the same way.
 */
export { roundHalfToEven };

/** Split '#rrggbb' into components. Invalid input returns null. */
function parseHex(hex: string): [number, number, number] | null {
  if (hex.length !== 7 || hex[0] !== '#') return null;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

/**
 * The integer red-mean distance. `mean` is rounded half-to-even, the same way
 * Python's round() behaves, so a half-unit tie lands on the same channel for
 * every implementation of this algorithm.
 */
export function redMeanDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const redMean = roundHalfToEven((r1 + r2) / 2);
  const r = r1 - r2;
  const g = g1 - g2;
  const b = b1 - b2;
  return (((512 + redMean) * r * r) >>> 8) + 4 * g * g + (((767 - redMean) * b * b) >>> 8);
}

/**
 * The Janome slot whose colour is nearest to `thread`.
 *
 * A thread without a usable hex cannot be matched, so it gets slot 0 - the
 * format's own "nothing selected" - rather than a colour that happens to come
 * first. `excluded` lets the caller drop a slot that the previous colour
 * block already took when the two threads are genuinely different, so two
 * different threads never collapse onto one machine colour.
 */
export function nearestJefIndex(
  thread: ThreadColor | null | undefined,
  excluded: number = 0,
): number {
  const rgb = thread?.hex ? parseHex(thread.hex) : null;
  if (!rgb) return 0;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < JEF_THREADS.length; i++) {
    if (i === excluded) continue;
    const entry = JEF_THREADS[i];
    if (!entry) continue;
    const candidate = parseHex(entry.hex);
    if (!candidate) continue;
    const distance = redMeanDistance(
      rgb[0],
      rgb[1],
      rgb[2],
      candidate[0],
      candidate[1],
      candidate[2],
    );
    // `<=` keeps the later of two exactly-equal candidates, which is what the
    // reference does; the ordering of the table decides the tie.
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The thread a JEF slot names, or null for slot 0 and unknown numbers. */
export function jefThreadAt(index: number): JefThread | null {
  return JEF_THREADS[index] ?? null;
}
