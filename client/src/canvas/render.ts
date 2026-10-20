/**
 * Canvas rendering for the editor.
 *
 * Deliberately imperative rather than SVG: a modest fill is tens of thousands
 * of stitch points, and a DOM node per point makes panning stutter long before
 * the geometry gets interesting. Everything here is a pure function of its
 * inputs so the component can redraw on every frame without accumulating
 * state.
 *
 * Coordinates are millimetres in "design space" (0,0 at the top-left of the
 * hoop). The view maps them to pixels.
 */

import type {
  CompoundPath,
  EmbroideryObject,
  Hoop,
  Point,
  Stitch,
  ThreadColor,
} from '@threadworks/engine';
import { letteringBounds, letteringStrokes } from '@threadworks/engine';

export interface View {
  /** Pixels per millimetre. */
  scale: number;
  /** Screen position of design-space (0,0). */
  offsetX: number;
  offsetY: number;
}

export interface RenderOptions {
  view: View;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  designWidth: number;
  designHeight: number;
  hoop: Hoop | null;
  objects: EmbroideryObject[];
  palette: ThreadColor[];
  stitches: Stitch[] | null;
  selection: string[];
  showGrid: boolean;
  showRulers: boolean;
  showUnderlay: boolean;
  showStitches: boolean;
  showOutlines: boolean;
  gridSize: number;
  /**
   * Spacing of the major grid lines in mm.
   *
   * Optional: absent keeps the historical five-minor-lines rule, which is what
   * every saved preference and every caller looked like before the setting
   * existed.
   */
  gridMajorSize?: number;
  /**
   * Reveal only the first N stitches of the sequence.
   *
   * Left undefined (or past the end) everything is drawn. Fractional values
   * are floored, which suits the playback counter because it advances
   * continuously while stitches are discrete. This only ever *hides* work - it
   * never regenerates, so scrubbing is O(1) on the engine side.
   */
  stitchLimit?: number;
  /**
   * Object whose path nodes should be drawn as editable handles.
   *
   * Set by the Node Edit tool. Only one object is node-edited at a time, so
   * this is a single id rather than a set; the selected nodes within it are
   * listed so the canvas can highlight them separately from the rest.
   */
  nodeEdit?: {
    objectId: string;
    /** Selected nodes, as ring index + point index. */
    nodes: { ring: number; index: number }[];
  } | null;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 40;

export function toScreen(p: Point, view: View): Point {
  return { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY };
}

export function toDesign(sx: number, sy: number, view: View): Point {
  return { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Fit a design inside the viewport with a margin, centred. */
export function fitView(
  designWidth: number,
  designHeight: number,
  viewWidth: number,
  viewHeight: number,
  margin = 40,
): View {
  const usableW = Math.max(1, viewWidth - margin * 2);
  const usableH = Math.max(1, viewHeight - margin * 2);
  const scale = clampScale(Math.min(usableW / designWidth, usableH / designHeight));
  return {
    scale,
    offsetX: (viewWidth - designWidth * scale) / 2,
    offsetY: (viewHeight - designHeight * scale) / 2,
  };
}

/** Zoom about a fixed screen point, so the cursor stays on the same design
 * point while the wheel turns. */
export function zoomAt(view: View, factor: number, screenX: number, screenY: number): View {
  const before = toDesign(screenX, screenY, view);
  const scale = clampScale(view.scale * factor);
  return {
    scale,
    offsetX: screenX - before.x * scale,
    offsetY: screenY - before.y * scale,
  };
}

const THEME = {
  background: '#1b1d21',
  grid: 'rgba(255,255,255,0.045)',
  gridMajor: 'rgba(255,255,255,0.10)',
  hoopOutline: '#4f8cff',
  hoopSafe: 'rgba(79,140,255,0.35)',
  hoopFill: 'rgba(255,255,255,0.025)',
  designFill: '#101114',
  outline: 'rgba(255,255,255,0.45)',
  outlineHidden: 'rgba(255,255,255,0.16)',
  selection: '#ffd166',
  selectionFill: 'rgba(255,209,102,0.10)',
  ruler: '#24272c',
  rulerText: 'rgba(255,255,255,0.55)',
} as const;

export function render(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { view, width, height } = options;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, width, height);

  drawHoop(ctx, options);
  if (options.showGrid) drawGrid(ctx, options);

  // Appliqué patches read as fabric, not as empty space with a border around
  // it. The tint is preview only: it is not a stitch and never reaches an
  // encoder, it just makes the patch visible under the placement and finish.
  drawAppliqueFabric(ctx, options);

  if (options.showStitches && options.stitches) {
    drawStitches(ctx, options);
  }

  if (options.showOutlines) {
    const selected = new Set(options.selection);
    // Draw unselected first so the highlighted object sits on top.
    for (const obj of options.objects) {
      if (selected.has(obj.id)) continue;
      drawObjectOutline(ctx, obj, view, obj.hidden ? THEME.outlineHidden : THEME.outline, 1);
    }
    for (const obj of options.objects) {
      if (!selected.has(obj.id)) continue;
      drawSelection(ctx, obj, view);
    }
  }

  // Node handles sit above everything so they stay clickable.
  if (options.nodeEdit) {
    const obj = options.objects.find((o) => o.id === options.nodeEdit!.objectId);
    if (obj) drawNodes(ctx, obj, view, options.nodeEdit.nodes);
  }

  ctx.restore();

  if (options.showRulers) drawRulers(ctx, options);
}

function drawHoop(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { view, hoop, designWidth, designHeight } = options;

  const w = hoop?.width ?? designWidth;
  const h = hoop?.height ?? designHeight;

  const topLeft = toScreen({ x: 0, y: 0 }, view);
  const size = { x: w * view.scale, y: h * view.scale };

  // Design area: visually distinct from the hoop so it is obvious when a
  // design runs past the embroidery field.
  ctx.fillStyle = THEME.designFill;
  ctx.fillRect(topLeft.x, topLeft.y, size.x, size.y);

  if (!hoop) return;

  ctx.strokeStyle = THEME.hoopOutline;
  ctx.lineWidth = 1.5;
  if (hoop.shape === 'round') {
    ctx.beginPath();
    ctx.arc(
      topLeft.x + size.x / 2,
      topLeft.y + size.y / 2,
      Math.min(size.x, size.y) / 2,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (hoop.shape === 'oval') {
    ctx.beginPath();
    ctx.ellipse(
      topLeft.x + size.x / 2,
      topLeft.y + size.y / 2,
      size.x / 2,
      size.y / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else {
    ctx.strokeRect(topLeft.x, topLeft.y, size.x, size.y);
  }

  // Safe stitching area, inset by the frame's margin.
  const margin = hoop.safeMargin * view.scale;
  if (margin > 1) {
    ctx.strokeStyle = THEME.hoopSafe;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      topLeft.x + margin,
      topLeft.y + margin,
      Math.max(0, size.x - margin * 2),
      Math.max(0, size.y - margin * 2),
    );
    ctx.setLineDash([]);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { view, width, height, gridSize, designWidth, designHeight } = options;
  const step = gridSize * view.scale;
  // A major line every 5 minor steps is the old behaviour; the setting only
  // exists so the major and minor spacings can be chosen separately.
  const majorSize = Math.max(gridSize, options.gridMajorSize ?? gridSize * 5);
  const isMajor = (value: number): boolean => isMajorGridLine(value, majorSize);

  // Refuse to draw when the grid would be denser than a pixel: at that point
  // it is not a grid, it is a grey wash over the design.
  if (step < 4) return;

  const startX = view.offsetX % step;
  const startY = view.offsetY % step;

  ctx.save();

  for (let x = startX, i = Math.ceil((0 - view.offsetX) / step); x <= width; x += step, i++) {
    const designX = i * gridSize;
    const major = isMajor(designX);
    ctx.strokeStyle = major ? THEME.gridMajor : THEME.grid;
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
  }

  for (let y = startY, i = Math.ceil((0 - view.offsetY) / step); y <= height; y += step, i++) {
    const designY = i * gridSize;
    const major = isMajor(designY);
    ctx.strokeStyle = major ? THEME.gridMajor : THEME.grid;
    ctx.lineWidth = major ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }

  // Frame outline on top of the grid so the field stays legible.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  const tl = toScreen({ x: 0, y: 0 }, view);
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, designWidth * view.scale, designHeight * view.scale);
  ctx.restore();
}

/**
 * Whether a design coordinate lands on a major grid line.
 *
 * Shared with the tests so the definition of "major" is the one the canvas
 * actually draws, rather than a second copy of the rule. `major` must already
 * be at least the minor step; the caller enforces that.
 */
export function isMajorGridLine(valueMm: number, majorMm: number): boolean {
  if (!Number.isFinite(valueMm) || !Number.isFinite(majorMm) || majorMm <= 0) return false;
  const remainder = Math.abs(valueMm) % majorMm;
  return remainder < 1e-6 || majorMm - remainder < 1e-6;
}

/**
 * Draw the generated stitch sequence.
 *
 * Stitches are batched into runs of identical appearance and submitted as one
 * path, so a 50k-stitch design costs a handful of `stroke()` calls rather than
 * 50k. Travel (jump/trim) is dashed and dim so it reads as movement, not as
 * sewn thread.
 */
function drawStitches(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { stitches, palette } = options;
  if (!stitches || stitches.length === 0) return;

  // The limit is how many stitches exist so far during playback; outside
  // playback it is undefined and the whole sequence is shown.
  const limit =
    options.stitchLimit === undefined
      ? stitches.length
      : Math.min(stitches.length, Math.max(0, Math.floor(options.stitchLimit)));

  const view = options.view;
  const toX = (s: Stitch): number => s.x * view.scale + view.offsetX;
  const toY = (s: Stitch): number => s.y * view.scale + view.offsetY;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Thread appears ~0.4 mm wide, but never thinner than one physical pixel.
  const threadWidth = Math.max(1, 0.4 * view.scale);
  const lockWidth = Math.max(1, threadWidth * 0.7);

  const colorOf = (index: number): string => {
    if (palette.length === 0) return '#C8102E';
    return palette[index % palette.length]?.hex ?? '#C8102E';
  };

  let running = false;
  let runStyle = '';
  let runLength = 0;
  /** Position of the most recent penetration, needed to dot a lone stitch. */
  let lastPoint: { x: number; y: number } | null = null;

  const applyStyle = (color: string, isLock: boolean): void => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = isLock ? lockWidth : threadWidth;
  };

  /**
   * Finish the current path.
   *
   * A path built from a single `moveTo` has nothing to stroke, so a run of
   * exactly one penetration is painted as a dot - otherwise isolated tie-off
   * stitches and single-run details would simply vanish.
   */
  const flush = (): void => {
    if (!running) return;
    if (runLength === 1 && lastPoint) {
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
    running = false;
    runLength = 0;
    runStyle = '';
  };

  for (let i = 0; i < limit; i++) {
    const s = stitches[i]!;
    // `next` is clamped to the same limit, otherwise the final visible stitch
    // would draw a connector to a stitch that is not yet on screen.
    const next = i + 1 < limit ? stitches[i + 1] : undefined;

    if (s.command === 'jump' || s.command === 'trim') {
      flush();
      // Dashed connector to whatever comes next, so travel is visible.
      if (next && next.command !== 'colorChange') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(s), toY(s));
        ctx.lineTo(toX(next), toY(next));
        ctx.stroke();
        ctx.restore();
      }
      continue;
    }

    if (s.command === 'colorChange') {
      flush();
      continue;
    }

    const isLock = s.command === 'lock';
    const color = isLock ? 'rgba(255,255,255,0.7)' : colorOf(s.colorIndex);
    const styleKey = `${isLock ? 'L' : 'T'}:${color}`;
    const x = toX(s);
    const y = toY(s);

    if (!running || styleKey !== runStyle) {
      flush();
      applyStyle(color, isLock);
      ctx.beginPath();
      ctx.moveTo(x, y);
      running = true;
      runStyle = styleKey;
      runLength = 1;
    } else {
      ctx.lineTo(x, y);
      runLength++;
    }

    lastPoint = { x, y };

    // The run ends if this stitch is not connected to the next one.
    if (
      !next ||
      next.command === 'jump' ||
      next.command === 'trim' ||
      next.command === 'colorChange'
    ) {
      flush();
    }
  }

  flush();

  // Needle head: shows exactly where the machine is. Only drawn while
  // playback is actually limiting the reveal, so the normal editor view stays
  // uncluttered.
  if (options.stitchLimit !== undefined && limit > 0) {
    const head = stitches[limit - 1]!;
    const hx = toX(head);
    const hy = toY(head);
    ctx.save();
    ctx.strokeStyle = THEME.selection;
    ctx.fillStyle = 'rgba(255,209,102,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function pathOf(path: CompoundPath, view: View): Path2D {
  const p = new Path2D();
  for (const ring of path.rings) {
    if (ring.length === 0) continue;
    const first = toScreen(ring[0]!, view);
    p.moveTo(first.x, first.y);
    for (let i = 1; i < ring.length; i++) {
      const pt = toScreen(ring[i]!, view);
      p.lineTo(pt.x, pt.y);
    }
    p.closePath();
  }
  return p;
}

/**
 * A translucent fabric swatch under each appliqué patch.
 *
 * The patch's real colour comes from the fabric the operator places, which the
 * design cannot know, so the object's thread colour is used as the tint. This
 * is strictly a preview: no stitch is generated, and hiding stitches does not
 * hide the fabric (it is part of the object, not part of the sequence).
 */
function drawAppliqueFabric(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  if (options.objects.length === 0) return;
  for (const obj of options.objects) {
    if (obj.hidden || !obj.params.applique?.enabled) continue;
    if (obj.path.rings.length === 0) continue;

    const hex = options.palette[obj.colorIndex % Math.max(1, options.palette.length)]?.hex;
    ctx.save();
    ctx.globalAlpha = obj.params.applique.fill ? 0.08 : 0.18;
    ctx.fillStyle = hex ?? '#c8c8c8';
    ctx.fill(pathOf(obj.path, options.view), 'evenodd');
    ctx.restore();
  }
}

function drawObjectOutline(
  ctx: CanvasRenderingContext2D,
  obj: EmbroideryObject,
  view: View,
  stroke: string,
  lineWidth: number,
): void {
  // Lettering has no editable path - its outline is the laid-out glyph
  // strokes, so the editor strokes those instead.
  if (obj.type === 'lettering') {
    const { strokes, frame } = letteringStrokes(obj);
    if (strokes.length === 0 && !frame) return;
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(obj.hidden ? [4, 4] : []);
    ctx.beginPath();
    for (const polyline of frame ? [...strokes, frame] : strokes) {
      if (polyline.length === 0) continue;
      const first = toScreen(polyline[0]!, view);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < polyline.length; i++) {
        const pt = toScreen(polyline[i]!, view);
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (obj.path.rings.length === 0) return;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(obj.hidden ? [4, 4] : []);
  // even-odd so holes are rendered as holes rather than filled solid.
  ctx.fill(pathOf(obj.path, view), 'evenodd');
  ctx.stroke(pathOf(obj.path, view));
  ctx.restore();
}

/** Box around an object: its path, or the laid-out letters for text. */
function objectOutlineBounds(
  obj: EmbroideryObject,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (obj.type === 'lettering') return letteringBounds(obj);
  return ringBounds(obj.path);
}

function drawSelection(ctx: CanvasRenderingContext2D, obj: EmbroideryObject, view: View): void {
  const bounds = objectOutlineBounds(obj);
  if (!bounds) return;

  const tl = toScreen({ x: bounds.minX, y: bounds.minY }, view);
  const w = (bounds.maxX - bounds.minX) * view.scale;
  const h = (bounds.maxY - bounds.minY) * view.scale;

  ctx.save();
  ctx.strokeStyle = THEME.selection;
  ctx.fillStyle = THEME.selectionFill;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w, h);

  // Corner handles, drawn in screen space so they stay clickable while zoomed.
  const handle = 7;
  ctx.fillStyle = THEME.selection;
  for (const [hx, hy] of [
    [tl.x, tl.y],
    [tl.x + w, tl.y],
    [tl.x, tl.y + h],
    [tl.x + w, tl.y + h],
  ] as const) {
    ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
  }

  ctx.restore();

  // Hand-set entry/exit points, so a digitizer can see where a colour will
  // start and stop rather than having to trust that the engine guessed well.
  drawPointMarker(ctx, view, obj.entryExit.entry, 'entry');
  drawPointMarker(ctx, view, obj.entryExit.exit, 'exit');
}

/**
 * Mark an entry or exit point on the canvas.
 *
 * Entry is a filled circle, exit a hollow square: the two differ by SHAPE as
 * well as colour so they stay tellable apart in greyscale printouts and for
 * anyone who cannot separate green from red. Screen-space sizing keeps them
 * legible at every zoom.
 */
function drawPointMarker(
  ctx: CanvasRenderingContext2D,
  view: View,
  point: { x: number; y: number } | null,
  kind: 'entry' | 'exit',
): void {
  if (!point) return;
  const p = toScreen(point, view);
  const r = 5;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = kind === 'entry' ? '#4ade80' : '#f87171';
  ctx.fillStyle = kind === 'entry' ? '#4ade80' : THEME.background;

  ctx.beginPath();
  if (kind === 'entry') {
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function ringBounds(
  path: CompoundPath,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ring of path.rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Size of a node handle in screen pixels, so it stays clickable at any zoom. */
const NODE_HANDLE_PX = 8;

/**
 * Draw the path nodes of the object under edit as small square handles.
 *
 * Handles are drawn in screen space so they keep a constant size however far
 * the user has zoomed: a node that shrank with the design would be impossible
 * to grab at 10% and would blot out the shape at 400%.
 */
function drawNodes(
  ctx: CanvasRenderingContext2D,
  obj: EmbroideryObject,
  view: View,
  selected: { ring: number; index: number }[],
): void {
  const selectedKeys = new Set(selected.map((n) => `${n.ring}:${n.index}`));

  ctx.save();
  ctx.lineWidth = 1.5;

  for (let ri = 0; ri < obj.path.rings.length; ri++) {
    const ring = obj.path.rings[ri]!;
    for (let pi = 0; pi < ring.length; pi++) {
      const pt = toScreen(ring[pi]!, view);
      const half = NODE_HANDLE_PX / 2;
      const isSelected = selectedKeys.has(`${ri}:${pi}`);

      // Filled for a selected node, hollow otherwise, so the two states read
      // apart even when handles overlap on a dense outline.
      ctx.fillStyle = isSelected ? THEME.selection : THEME.background;
      ctx.strokeStyle = THEME.selection;
      ctx.fillRect(pt.x - half, pt.y - half, NODE_HANDLE_PX, NODE_HANDLE_PX);
      ctx.strokeRect(pt.x - half, pt.y - half, NODE_HANDLE_PX, NODE_HANDLE_PX);
    }
  }

  ctx.restore();
}

/**
 * Find the node nearest to a design-space point, within a screen-pixel radius.
 *
 * Returns the ring and point index, or null when nothing is close enough.
 * The tolerance is converted from pixels into millimetres so the grab radius
 * stays constant on screen at any zoom, but the comparison itself happens in
 * design space - matching `hitTestSegment` and the point passed in by the
 * canvas. Comparing screen-space handles against a design-space cursor would
 * make nodes impossible to click.
 */
export function hitTestNode(
  obj: EmbroideryObject,
  point: Point,
  view: View,
  radiusPx = NODE_HANDLE_PX,
): { ring: number; index: number } | null {
  const tolerance = radiusPx / view.scale;
  const tolerance2 = tolerance * tolerance;

  let best: { ring: number; index: number } | null = null;
  let bestDist = tolerance2;

  for (let ri = 0; ri < obj.path.rings.length; ri++) {
    const ring = obj.path.rings[ri]!;
    for (let pi = 0; pi < ring.length; pi++) {
      const p = ring[pi]!;
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d <= bestDist) {
        bestDist = d;
        best = { ring: ri, index: pi };
      }
    }
  }

  return best;
}

/**
 * Find the segment of the object's path nearest to a design-space point.
 *
 * Used by Node Edit to insert a new node: clicking an edge rather than a
 * handle adds a point there, which is how outlines get reshaped without
 * first finding a vertex to drag.
 */
export function hitTestSegment(
  obj: EmbroideryObject,
  point: Point,
  view: View,
  tolerancePx = 6,
): { ring: number; afterIndex: number } | null {
  const tolerance = tolerancePx / view.scale;
  const tolerance2 = tolerance * tolerance;

  let best: { ring: number; afterIndex: number } | null = null;
  let bestDist = tolerance2;

  for (let ri = 0; ri < obj.path.rings.length; ri++) {
    const ring = obj.path.rings[ri]!;
    for (let pi = 0; pi < ring.length; pi++) {
      const a = ring[pi]!;
      const b = ring[(pi + 1) % ring.length]!;
      const d = distToSegment2(point, a, b);
      if (d <= bestDist) {
        bestDist = d;
        best = { ring: ri, afterIndex: pi };
      }
    }
  }

  return best;
}

/** Rulers along the top and left edges, labelled in millimetres. */
function drawRulers(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { view, width, height, designWidth, designHeight } = options;
  const thickness = 18;

  ctx.save();
  ctx.fillStyle = THEME.ruler;
  ctx.fillRect(0, 0, width, thickness);
  ctx.fillRect(0, 0, thickness, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, thickness + 0.5);
  ctx.lineTo(width, thickness + 0.5);
  ctx.moveTo(thickness + 0.5, 0);
  ctx.lineTo(thickness + 0.5, height);
  ctx.stroke();

  // Choose a tick spacing that keeps labels ~60 px apart.
  const targetPx = 64;
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200];
  const mmPerTick =
    candidates.find((c) => c * view.scale >= targetPx) ?? candidates[candidates.length - 1]!;
  const pxPerTick = mmPerTick * view.scale;

  ctx.fillStyle = THEME.rulerText;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';

  const startX = view.offsetX % pxPerTick;
  for (
    let x = startX, i = Math.floor((0 - view.offsetX) / pxPerTick);
    x <= width;
    x += pxPerTick, i++
  ) {
    const mm = i * mmPerTick;
    if (mm < 0 || mm > designWidth) continue;
    ctx.fillText(String(mm), x + 3, thickness - 5);
    ctx.fillRect(x, thickness - 4, 1, 4);
  }

  const startY = view.offsetY % pxPerTick;
  for (
    let y = startY, i = Math.floor((0 - view.offsetY) / pxPerTick);
    y <= height;
    y += pxPerTick, i++
  ) {
    const mm = i * mmPerTick;
    if (mm < 0 || mm > designHeight) continue;
    ctx.save();
    ctx.translate(thickness - 5, y + 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(mm), 0, 0);
    ctx.restore();
    ctx.fillRect(thickness - 4, y, 4, 1);
  }

  ctx.restore();
}

/** Hit test: topmost object whose ring contains the point, or an edge within
 * `tolerance` millimetres of a ring. */
export function hitTest(
  objects: EmbroideryObject[],
  point: Point,
  view: View,
): EmbroideryObject | null {
  const tolerance = 4 / view.scale;

  // Reverse order: the object drawn last is the one the user expects to grab.
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;
    if (obj.hidden || obj.locked) continue;
    // Lettering has no path: its clickable area is the box around the laid
    // out letters, so text that was deselected can be picked up again.
    if (obj.type === 'lettering') {
      const box = letteringBounds(obj);
      if (
        box &&
        point.x >= box.minX &&
        point.x <= box.maxX &&
        point.y >= box.minY &&
        point.y <= box.maxY
      ) {
        return obj;
      }
      continue;
    }
    if (pointInCompound(obj.path, point)) return obj;
  }

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]!;
    if (obj.hidden || obj.locked) continue;
    if (obj.type === 'lettering') {
      const box = letteringBounds(obj);
      if (
        box &&
        point.x >= box.minX - tolerance &&
        point.x <= box.maxX + tolerance &&
        point.y >= box.minY - tolerance &&
        point.y <= box.maxY + tolerance
      ) {
        return obj;
      }
      continue;
    }
    if (nearCompound(obj.path, point, tolerance)) return obj;
  }

  return null;
}

/** Even-odd containment: matches how the engine resolves holes. */
export function pointInCompound(path: CompoundPath, point: Point): boolean {
  let inside = false;
  for (const ring of path.rings) {
    if (pointInRing(ring, point)) inside = !inside;
  }
  return inside;
}

export function pointInRing(ring: Point[], point: Point): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function nearCompound(path: CompoundPath, point: Point, tolerance: number): boolean {
  return path.rings.some((ring) => nearRing(ring, point, tolerance));
}

function nearRing(ring: Point[], point: Point, tolerance: number): boolean {
  const t2 = tolerance * tolerance;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (distToSegment2(point, a, b) <= t2) return true;
  }
  return false;
}

function distToSegment2(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));

  const px = a.x + t * dx - p.x;
  const py = a.y + t * dy - p.y;
  return px * px + py * py;
}
