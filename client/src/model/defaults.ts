/**
 * Default values and small constructors for the editable design model.
 *
 * Kept in one module so the "New project" path, the object tools, and the
 * parameter panel cannot drift apart and produce an object with, say, an
 * undefined `underlay` that the engine then trips over.
 */

import type {
  EmbroideryObject,
  Hoop,
  LetteringSpec,
  Point,
  StitchParameters,
  StitchType,
  ThreadColor,
} from '@threadworks/engine';
import { DEFAULT_LETTERING_SPEC } from '@threadworks/engine';

export const DEFAULT_SPACING = 0.4;
export const DST_MAX_STEP_MM = 12.1;

/** Undo/redo depth. Large enough to recover from a mistake, bounded so a
 * long session does not grow memory without limit. */
export const HISTORY_LIMIT = 60;

export function defaultParams(stitchType: StitchType = 'tatami'): StitchParameters {
  const fillish =
    stitchType === 'tatami' ||
    stitchType === 'motif' ||
    stitchType === 'contour' ||
    stitchType === 'spiral';

  return {
    stitchType,
    angle: 0,
    spacing: stitchType === 'satin' ? 0.4 : fillish ? DEFAULT_SPACING : 3,
    maxStitchLength: DST_MAX_STEP_MM,
    minStitchLength: 0.3,
    pullCompensation: stitchType === 'satin' ? 0.4 : 0.2,
    fillPattern:
      stitchType === 'motif'
        ? 'motif'
        : stitchType === 'contour'
          ? 'contour'
          : stitchType === 'spiral'
            ? 'spiral'
            : 'tatami',
    underlay: fillish
      ? { type: 'edgeRun', spacing: 3, offset: 1, inset: 1 }
      : { type: 'none', spacing: 3, offset: 1, inset: 1 },
    tieIn: { enabled: true, length: 0.4, count: 3 },
    tieOff: { enabled: true, length: 0.4, count: 3 },
    // Off by default: a design is flat until someone asks for puff.
    foam: { enabled: false, thicknessMm: 2, tackUnderlay: true },
    // Off by default: a fill is plain until someone asks for texture.
    carve: {
      enabled: false,
      pattern: 'diamond',
      spacing: 6,
      scale: 3,
      rotation: 0,
      outline: true,
    },
  };
}

let objectCounter = 0;

/** Stable, collision-free object id. `crypto.randomUUID` needs a secure
 * context, which a plain `http://127.0.0.1` page is not - so this does not
 * rely on it. */
export function nextObjectId(): string {
  objectCounter += 1;
  return `obj-${Date.now().toString(36)}-${objectCounter.toString(36)}`;
}

export function createObject(
  type: EmbroideryObject['type'],
  rings: Point[][],
  colorIndex = 0,
  order = 0,
  stitchType?: StitchType,
): EmbroideryObject {
  const shapeType: StitchType =
    type === 'column'
      ? 'satin'
      : type === 'run'
        ? 'run'
        : type === 'bean'
          ? 'bean'
          : type === 'motif'
            ? 'motif'
            : type === 'contour'
              ? 'contour'
              : type === 'spiral'
                ? 'spiral'
                : 'tatami';

  // The "default stitch type" preference decides what a freshly drawn complex
  // fill starts as - it is the one tool whose type is a free choice. Every
  // other tool already means a single type (a column is satin, a run is a
  // run), so the preference has nothing to choose there and is ignored.
  const chosen = type === 'fill' && stitchType ? stitchType : shapeType;

  return {
    id: nextObjectId(),
    name: defaultName(type),
    type,
    path: { rings },
    transform: { x: 0, y: 0 },
    colorIndex,
    params: defaultParams(chosen),
    entryExit: { entry: null, exit: null },
    // Lettering objects carry their own text spec; everything else is
    // path-driven and leaves this null.
    lettering: null,
    order,
    locked: false,
    hidden: false,
    groupId: null,
    warnings: [],
  };
}

/**
 * A lettering object placed at a point.
 *
 * Lettering is generated from its text spec rather than from `path`, so the
 * path is left empty and the position is carried by `transform.x/y` - the
 * spec's origin is the text's top-left corner, which matches how the field
 * is addressed.
 */
export function createLettering(
  at: Point,
  options: Partial<LetteringSpec> = {},
  colorIndex = 0,
  order = 0,
): EmbroideryObject {
  const spec: LetteringSpec = { ...DEFAULT_LETTERING_SPEC, ...options };

  const obj = createObject('lettering', [], colorIndex, order);
  return {
    ...obj,
    name: `Text "${spec.text}"`,
    transform: { ...obj.transform, x: at.x, y: at.y },
    // Satin is the only sensible top stitch for a skeleton font: each stroke
    // is a column, so spacing here is the satin row spacing.
    params: defaultParams('satin'),
    lettering: spec,
  };
}

export function defaultName(type: EmbroideryObject['type']): string {
  switch (type) {
    case 'column':
      return 'Column';
    case 'fill':
      return 'Complex Fill';
    case 'run':
      return 'Run';
    case 'bean':
      return 'Bean Run';
    case 'lettering':
      return 'Lettering';
    case 'motif':
      return 'Motif';
    case 'contour':
      return 'Contour';
    case 'spiral':
      return 'Spiral';
    default:
      return 'Object';
  }
}

/** A starting palette: a handful of stock colours so a new design is usable
 * before the user opens the palette manager. */
export const STARTER_PALETTE: ThreadColor[] = [
  { id: 'start-0', code: '1001', name: 'Black', hex: '#000000', brand: 'ThreadWorks' },
  { id: 'start-1', code: '1002', name: 'White', hex: '#FFFFFF', brand: 'ThreadWorks' },
  { id: 'start-2', code: '1003', name: 'Red', hex: '#C8102E', brand: 'ThreadWorks' },
  { id: 'start-3', code: '1004', name: 'Blue', hex: '#003DA5', brand: 'ThreadWorks' },
  { id: 'start-4', code: '1005', name: 'Green', hex: '#00843D', brand: 'ThreadWorks' },
  { id: 'start-5', code: '1006', name: 'Yellow', hex: '#FFD100', brand: 'ThreadWorks' },
];

/** Hoop used when no project hoop has been chosen yet. */
export const DEFAULT_HOOP: Hoop = {
  id: 'hoop-180x130',
  name: '180 x 130 mm',
  width: 180,
  height: 130,
  shape: 'rect',
  safeMargin: 5,
};

export interface NewDesignOptions {
  name?: string;
  width?: number;
  height?: number;
  hoopId?: string | null;
}

export function createEmptyDesign(options: NewDesignOptions = {}) {
  return {
    units: 'mm' as const,
    width: options.width ?? DEFAULT_HOOP.width,
    height: options.height ?? DEFAULT_HOOP.height,
    hoopId: options.hoopId === undefined ? DEFAULT_HOOP.id : options.hoopId,
    objects: [] as EmbroideryObject[],
    threadPalette: STARTER_PALETTE.map((c) => ({ ...c })),
    name: options.name ?? 'Untitled design',
  };
}

/** A simple closed rectangle ring, used by the shape tools. */
export function rectangleRing(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Approximate a circle as a closed ring. */
export function circleRing(cx: number, cy: number, r: number, segments = 48): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}
