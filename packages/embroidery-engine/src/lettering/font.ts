/**
 * A single-stroke embroidery font.
 *
 * Each glyph is a set of open polylines (the letter's *skeleton*), not a
 * closed outline. That is deliberate: embroidery lettering is sewn as satin
 * or run columns along the skeleton, so the skeleton IS the shape we need.
 * Closed outline fonts (the kind used for screen text) would have to be
 * skeletonized first, which is lossy and error prone.
 *
 * Coordinates live in a 100-unit em square:
 *   - baseline at y = 0
 *   - cap height at y = 70
 *   - x-height at y = 50
 *   - descenders reach y = -20
 *   - y increases UPWARD (mathematical convention); the layout engine flips
 *     it into the design's top-left coordinate frame.
 *
 * `advance` is how far the pen moves after the glyph, in the same units.
 * It is larger than the ink width: real letterforms need side bearing or the
 * letters collide when stitched.
 */

export interface Glyph {
  /** Pen advance in em units. */
  advance: number;
  /** Open polylines; each is a sequence of [x, y] pairs in em units. */
  strokes: Array<Array<[number, number]>>;
}

/** Cap height, x-height and descender depth in em units. */
export const METRICS = {
  capHeight: 70,
  xHeight: 50,
  descender: -20,
} as const;

/**
 * A practical subset: every uppercase letter, the digits, space, and the
 * punctuation people actually put on garments. Lowercase is mapped to its
 * uppercase form by the layout engine (see `resolveGlyph`) - single-case
 * lettering covers the overwhelming majority of real jobs, and inventing a
 * second full set of skeletons would double the maintenance surface for
 * little return.
 */
export const GLYPHS: Record<string, Glyph> = {
  ' ': { advance: 40, strokes: [] },
  A: {
    advance: 70,
    strokes: [
      [
        [5, 0],
        [35, 70],
        [65, 0],
      ],
      [
        [17, 28],
        [53, 28],
      ],
    ],
  },
  B: {
    advance: 66,
    strokes: [
      [
        [10, 0],
        [10, 70],
        [40, 70],
        [52, 58],
        [52, 43],
        [40, 35],
        [10, 35],
      ],
      [
        [10, 35],
        [45, 35],
        [58, 22],
        [58, 12],
        [45, 0],
        [10, 0],
      ],
    ],
  },
  C: {
    advance: 68,
    strokes: [
      [
        [60, 56],
        [46, 70],
        [24, 70],
        [8, 52],
        [8, 18],
        [24, 0],
        [46, 0],
        [60, 14],
      ],
    ],
  },
  D: {
    advance: 68,
    strokes: [
      [
        [10, 0],
        [10, 70],
        [38, 70],
        [58, 50],
        [58, 20],
        [38, 0],
        [10, 0],
      ],
    ],
  },
  E: {
    advance: 62,
    strokes: [
      [
        [55, 70],
        [10, 70],
        [10, 0],
        [55, 0],
      ],
      [
        [10, 35],
        [46, 35],
      ],
    ],
  },
  F: {
    advance: 58,
    strokes: [
      [
        [55, 70],
        [10, 70],
        [10, 0],
      ],
      [
        [10, 36],
        [44, 36],
      ],
    ],
  },
  G: {
    advance: 72,
    strokes: [
      [
        [62, 56],
        [46, 70],
        [24, 70],
        [8, 52],
        [8, 18],
        [24, 0],
        [48, 0],
        [62, 16],
        [62, 34],
        [44, 34],
      ],
    ],
  },
  H: {
    advance: 70,
    strokes: [
      [
        [10, 0],
        [10, 70],
      ],
      [
        [60, 0],
        [60, 70],
      ],
      [
        [10, 35],
        [60, 35],
      ],
    ],
  },
  I: {
    advance: 34,
    strokes: [
      [
        [17, 0],
        [17, 70],
      ],
      [
        [3, 70],
        [31, 70],
      ],
      [
        [3, 0],
        [31, 0],
      ],
    ],
  },
  J: {
    advance: 54,
    strokes: [
      [
        [42, 70],
        [42, 18],
        [30, 0],
        [14, 0],
        [4, 12],
      ],
    ],
  },
  K: {
    advance: 66,
    strokes: [
      [
        [10, 0],
        [10, 70],
      ],
      [
        [58, 70],
        [10, 32],
      ],
      [
        [26, 44],
        [60, 0],
      ],
    ],
  },
  L: {
    advance: 56,
    strokes: [
      [
        [10, 70],
        [10, 0],
        [50, 0],
      ],
    ],
  },
  M: {
    advance: 82,
    strokes: [
      [
        [8, 0],
        [8, 70],
        [41, 22],
        [74, 70],
        [74, 0],
      ],
    ],
  },
  N: {
    advance: 72,
    strokes: [
      [
        [10, 0],
        [10, 70],
        [62, 0],
        [62, 70],
      ],
    ],
  },
  O: {
    advance: 74,
    strokes: [
      [
        [30, 0],
        [10, 18],
        [10, 52],
        [30, 70],
        [52, 70],
        [64, 52],
        [64, 18],
        [52, 0],
        [30, 0],
      ],
    ],
  },
  P: {
    advance: 64,
    strokes: [
      [
        [10, 0],
        [10, 70],
        [40, 70],
        [54, 56],
        [54, 42],
        [40, 28],
        [10, 28],
      ],
    ],
  },
  Q: {
    advance: 76,
    strokes: [
      [
        [30, 0],
        [10, 18],
        [10, 52],
        [30, 70],
        [52, 70],
        [64, 52],
        [64, 18],
        [52, 0],
        [30, 0],
      ],
      [
        [44, 18],
        [66, -4],
      ],
    ],
  },
  R: {
    advance: 68,
    strokes: [
      [
        [10, 0],
        [10, 70],
        [40, 70],
        [54, 56],
        [54, 42],
        [40, 28],
        [10, 28],
      ],
      [
        [32, 28],
        [60, 0],
      ],
    ],
  },
  S: {
    advance: 66,
    strokes: [
      [
        [58, 58],
        [42, 70],
        [22, 70],
        [8, 56],
        [8, 44],
        [22, 34],
        [46, 30],
        [58, 20],
        [58, 10],
        [42, 0],
        [20, 0],
        [6, 12],
      ],
    ],
  },
  T: {
    advance: 60,
    strokes: [
      [
        [30, 0],
        [30, 70],
      ],
      [
        [4, 70],
        [56, 70],
      ],
    ],
  },
  U: {
    advance: 70,
    strokes: [
      [
        [10, 70],
        [10, 20],
        [26, 0],
        [44, 0],
        [60, 20],
        [60, 70],
      ],
    ],
  },
  V: {
    advance: 68,
    strokes: [
      [
        [6, 70],
        [34, 0],
        [62, 70],
      ],
    ],
  },
  W: {
    advance: 92,
    strokes: [
      [
        [6, 70],
        [24, 0],
        [46, 46],
        [68, 0],
        [86, 70],
      ],
    ],
  },
  X: {
    advance: 68,
    strokes: [
      [
        [8, 70],
        [60, 0],
      ],
      [
        [60, 70],
        [8, 0],
      ],
    ],
  },
  Y: {
    advance: 66,
    strokes: [
      [
        [8, 70],
        [33, 34],
        [58, 70],
      ],
      [
        [33, 34],
        [33, 0],
      ],
    ],
  },
  Z: {
    advance: 64,
    strokes: [
      [
        [8, 70],
        [56, 70],
        [8, 0],
        [56, 0],
      ],
    ],
  },
  '0': {
    advance: 68,
    strokes: [
      [
        [28, 0],
        [10, 18],
        [10, 52],
        [28, 70],
        [46, 70],
        [58, 52],
        [58, 18],
        [46, 0],
        [28, 0],
      ],
      [
        [14, 12],
        [54, 58],
      ],
    ],
  },
  '1': {
    advance: 40,
    strokes: [
      [
        [8, 56],
        [24, 70],
        [24, 0],
      ],
      [
        [6, 0],
        [42, 0],
      ],
    ],
  },
  '2': {
    advance: 64,
    strokes: [
      [
        [8, 56],
        [22, 70],
        [44, 70],
        [56, 56],
        [56, 42],
        [8, 0],
        [58, 0],
      ],
    ],
  },
  '3': {
    advance: 64,
    strokes: [
      [
        [10, 62],
        [26, 70],
        [46, 70],
        [58, 56],
        [58, 44],
        [44, 34],
        [26, 34],
      ],
      [
        [44, 34],
        [58, 22],
        [58, 12],
        [44, 0],
        [24, 0],
        [8, 10],
      ],
    ],
  },
  '4': {
    advance: 66,
    strokes: [
      [
        [46, 0],
        [46, 70],
        [6, 22],
        [60, 22],
      ],
    ],
  },
  '5': {
    advance: 64,
    strokes: [
      [
        [56, 70],
        [14, 70],
        [10, 40],
        [38, 46],
        [56, 34],
        [56, 14],
        [40, 0],
        [18, 0],
        [6, 10],
      ],
    ],
  },
  '6': {
    advance: 66,
    strokes: [
      [
        [56, 62],
        [40, 70],
        [20, 70],
        [8, 46],
        [8, 16],
        [24, 0],
        [44, 0],
        [56, 14],
        [56, 26],
        [42, 38],
        [22, 38],
        [8, 26],
      ],
    ],
  },
  '7': {
    advance: 60,
    strokes: [
      [
        [6, 70],
        [56, 70],
        [22, 0],
      ],
    ],
  },
  '8': {
    advance: 66,
    strokes: [
      [
        [28, 34],
        [12, 44],
        [12, 58],
        [28, 70],
        [44, 70],
        [58, 58],
        [58, 44],
        [44, 34],
        [28, 34],
        [10, 22],
        [10, 10],
        [28, 0],
        [44, 0],
        [58, 10],
        [58, 22],
        [44, 34],
      ],
    ],
  },
  '9': {
    advance: 66,
    strokes: [
      [
        [8, 8],
        [24, 0],
        [44, 0],
        [58, 24],
        [58, 54],
        [42, 70],
        [22, 70],
        [8, 56],
        [8, 44],
        [22, 32],
        [42, 32],
        [58, 44],
      ],
    ],
  },
  '.': {
    advance: 30,
    strokes: [
      [
        [10, 0],
        [18, 0],
      ],
    ],
  },
  ',': {
    advance: 30,
    strokes: [
      [
        [16, 6],
        [8, -10],
      ],
    ],
  },
  '!': {
    advance: 32,
    strokes: [
      [
        [16, 70],
        [16, 20],
      ],
      [
        [16, 0],
        [16, 4],
      ],
    ],
  },
  '?': {
    advance: 60,
    strokes: [
      [
        [8, 56],
        [22, 70],
        [42, 70],
        [54, 56],
        [54, 44],
        [30, 30],
        [30, 18],
      ],
      [
        [30, 0],
        [30, 4],
      ],
    ],
  },
  '-': {
    advance: 50,
    strokes: [
      [
        [8, 34],
        [42, 34],
      ],
    ],
  },
  '+': {
    advance: 56,
    strokes: [
      [
        [8, 34],
        [48, 34],
      ],
      [
        [28, 14],
        [28, 54],
      ],
    ],
  },
  '/': {
    advance: 52,
    strokes: [
      [
        [6, 0],
        [46, 70],
      ],
    ],
  },
  "'": {
    advance: 26,
    strokes: [
      [
        [13, 70],
        [13, 52],
      ],
    ],
  },
  '&': {
    advance: 78,
    strokes: [
      [
        [70, 0],
        [24, 44],
        [16, 58],
        [24, 70],
        [38, 70],
        [46, 58],
        [46, 46],
        [8, 12],
        [8, 4],
        [24, 0],
        [46, 0],
        [66, 16],
      ],
    ],
  },
  '@': {
    advance: 88,
    strokes: [
      [
        [62, 42],
        [50, 52],
        [34, 52],
        [24, 42],
        [24, 26],
        [34, 16],
        [50, 16],
        [62, 26],
        [62, 42],
        [66, 52],
        [62, 62],
        [48, 70],
        [30, 70],
        [14, 56],
        [10, 36],
        [16, 12],
        [34, 0],
        [58, 4],
        [74, 18],
        [78, 40],
        [74, 60],
        [58, 72],
      ],
    ],
  },
  '#': {
    advance: 70,
    strokes: [
      [
        [22, 70],
        [14, 0],
      ],
      [
        [50, 70],
        [42, 0],
      ],
      [
        [8, 46],
        [62, 46],
      ],
      [
        [6, 22],
        [60, 22],
      ],
    ],
  },
  '%': {
    advance: 82,
    strokes: [
      [
        [62, 70],
        [14, 0],
      ],
      [
        [10, 70],
        [28, 70],
        [36, 58],
        [36, 46],
        [28, 34],
        [10, 34],
        [2, 46],
        [2, 58],
        [10, 70],
      ],
      [
        [54, 36],
        [72, 36],
        [80, 24],
        [80, 12],
        [72, 0],
        [54, 0],
        [46, 12],
        [46, 24],
        [54, 36],
      ],
    ],
  },
  '(': {
    advance: 38,
    strokes: [
      [
        [30, 76],
        [12, 52],
        [12, 18],
        [30, -6],
      ],
    ],
  },
  ')': {
    advance: 38,
    strokes: [
      [
        [8, 76],
        [26, 52],
        [26, 18],
        [8, -6],
      ],
    ],
  },
  ':': {
    advance: 28,
    strokes: [
      [
        [14, 40],
        [14, 44],
      ],
      [
        [14, 4],
        [14, 8],
      ],
    ],
  },
  '=': {
    advance: 56,
    strokes: [
      [
        [8, 26],
        [48, 26],
      ],
      [
        [8, 44],
        [48, 44],
      ],
    ],
  },
  '*': {
    advance: 50,
    strokes: [
      [
        [25, 30],
        [25, 70],
      ],
      [
        [7, 40],
        [43, 60],
      ],
      [
        [43, 40],
        [7, 60],
      ],
    ],
  },
};

/** Characters the font defines, for UI pickers and validation. */
export const SUPPORTED_CHARACTERS: string[] = Object.keys(GLYPHS);

/**
 * Find a glyph for a character, falling back sensibly.
 *
 * Lowercase maps to uppercase. An unsupported character maps to '?', because
 * a visible placeholder on the fabric beats a silently dropped letter - the
 * operator needs to see that something did not fit the font.
 */
export function resolveGlyph(char: string): { glyph: Glyph; substituted: boolean } {
  const direct = GLYPHS[char];
  if (direct) return { glyph: direct, substituted: false };

  const upper = GLYPHS[char.toUpperCase()];
  if (upper) return { glyph: upper, substituted: false };

  return { glyph: GLYPHS['?']!, substituted: true };
}
