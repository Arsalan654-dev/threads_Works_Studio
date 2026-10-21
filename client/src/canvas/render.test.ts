import { describe, it, expect } from 'vitest';
import type { EmbroideryObject, Hoop, Stitch, ThreadColor } from '@threadworks/engine';
import { DEFAULT_APPLIQUE } from '@threadworks/engine';
import {
  isMajorGridLine,
  hitTest,
  render,
  wheelZoomFactor,
  type RenderOptions,
  type View,
} from './render.js';
import { createLettering, createObject, rectangleRing } from '../model/defaults.js';

/**
 * Canvas 2D is not available under jsdom, so drawing is observed through a
 * recording stand-in. That is enough for what these tests assert: how *much*
 * got submitted to the context, not what the pixels looked like. Pixel-level
 * correctness of a 2D rasteriser is not something a unit test can honestly
 * claim, so none is claimed here.
 */
function makeCtx() {
  const ops: string[] = [];
  const texts: string[] = [];
  const record =
    (name: string) =>
    (..._args: unknown[]): void => {
      ops.push(name);
    };

  const ctx = {
    ops,
    texts,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: record('save'),
    restore: record('restore'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: record('arc'),
    rect: record('rect'),
    clip: record('clip'),
    drawImage: record('drawImage'),
    fill: record('fill'),
    stroke: record('stroke'),
    setLineDash: record('setLineDash'),
    setTransform: record('setTransform'),
    translate: record('translate'),
    strokeRect: record('strokeRect'),
    fillText: (...args: unknown[]): void => {
      ops.push('fillText');
      texts.push(String(args[0]));
    },
    measureText: () => ({ width: 10 }),
  };

  return ctx as unknown as CanvasRenderingContext2D & { ops: string[]; texts: string[] };
}

const count = (ctx: { ops: string[] }, name: string): number =>
  ctx.ops.filter((op) => op === name).length;

function lineStitches(n: number): Stitch[] {
  return Array.from({ length: n }, (_, i) => ({
    x: i * 0.5,
    y: 10,
    command: 'stitch' as const,
    colorIndex: 0,
    objectId: 'obj-1',
    sequence: i,
  }));
}

const palette: ThreadColor[] = [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }];

const hoop: Hoop = {
  id: 'hoop-180x130',
  name: '180 x 130',
  width: 180,
  height: 130,
  shape: 'rect',
  safeMargin: 5,
};

const view: View = { scale: 4, offsetX: 0, offsetY: 0 };

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    view,
    width: 800,
    height: 600,
    designWidth: 180,
    designHeight: 130,
    hoop,
    objects: [] as EmbroideryObject[],
    palette,
    stitches: lineStitches(60),
    selection: [],
    showGrid: false,
    showRulers: false,
    showUnderlay: true,
    showStitches: true,
    showOutlines: false,
    gridSize: 5,
    ...overrides,
  };
}

describe('stitch limit (playback reveal)', () => {
  it('draws the whole sequence when no limit is given', () => {
    const ctx = makeCtx();
    render(ctx, options());

    // 60 stitches in a straight line: the first is moveTo, the rest lineTo.
    expect(count(ctx, 'lineTo')).toBe(59);
  });

  it('draws only the first N stitches when a limit is given', () => {
    const ctx = makeCtx();
    render(ctx, options({ stitchLimit: 21 }));

    // 20 lineTo, because the 21st stitch is the last one revealed and has no
    // successor to draw towards.
    expect(count(ctx, 'lineTo')).toBe(20);
  });

  it('draws strictly less as the limit drops', () => {
    const at40 = makeCtx();
    render(at40, options({ stitchLimit: 40 }));

    const at15 = makeCtx();
    render(at15, options({ stitchLimit: 15 }));

    const full = makeCtx();
    render(full, options());

    expect(count(at15, 'lineTo')).toBeLessThan(count(at40, 'lineTo'));
    expect(count(at40, 'lineTo')).toBeLessThan(count(full, 'lineTo'));
  });

  it('draws nothing when the limit is zero', () => {
    const ctx = makeCtx();
    render(ctx, options({ stitchLimit: 0 }));

    expect(count(ctx, 'lineTo')).toBe(0);
    expect(count(ctx, 'stroke')).toBe(0);
    // The needle head is guarded by limit > 0, so it must not appear either.
    expect(count(ctx, 'arc')).toBe(0);
  });

  it('clamps a limit past the end to the whole sequence', () => {
    const over = makeCtx();
    render(over, options({ stitchLimit: 9_999 }));

    const none = makeCtx();
    render(none, options());

    expect(count(over, 'lineTo')).toBe(count(none, 'lineTo'));
  });

  it('floors a fractional limit, since stitches are discrete', () => {
    const ctx = makeCtx();
    render(ctx, options({ stitchLimit: 21.99 }));

    expect(count(ctx, 'lineTo')).toBe(20);
  });
});

describe('needle head marker', () => {
  it('is drawn while playback is limiting the reveal', () => {
    const ctx = makeCtx();
    render(ctx, options({ stitchLimit: 30 }));

    expect(count(ctx, 'arc')).toBe(1);
  });

  it('is not drawn in the ordinary editor view', () => {
    const ctx = makeCtx();
    render(ctx, options({ stitchLimit: undefined }));

    // The only other source of `arc` here would be a round hoop or a lone
    // single-stitch run; this sequence is 60 connected stitches in a rect hoop.
    expect(count(ctx, 'arc')).toBe(0);
  });
});

describe('scene layers', () => {
  it('honours showStitches by drawing nothing at all when off', () => {
    const ctx = makeCtx();
    render(ctx, options({ showStitches: false }));

    expect(count(ctx, 'lineTo')).toBe(0);
  });

  it('draws the hoop field even with no hoop selected', () => {
    const ctx = makeCtx();
    render(ctx, options({ hoop: null, showStitches: false }));

    // The design area rect still marks the embroidery field.
    expect(count(ctx, 'fillRect')).toBeGreaterThanOrEqual(1);
  });

  it('draws object outlines only when outlines are on', () => {
    const objects = [createObject('fill', [rectangleRing(20, 20, 60, 40)])];

    const off = makeCtx();
    render(off, options({ showOutlines: false, objects }));

    const on = makeCtx();
    render(on, options({ showOutlines: true, objects }));

    expect(count(on, 'stroke')).toBeGreaterThan(count(off, 'stroke'));
  });

  it('outlines an object without filling over its stitches', () => {
    const objects = [createObject('fill', [rectangleRing(20, 20, 60, 40)])];
    const ctx = makeCtx();
    render(
      ctx,
      options({
        objects,
        showOutlines: true,
        showStitches: false,
        hoop: null,
      }),
    );

    // A stale fillStyle used to paint a dark silhouette over every object.
    expect(count(ctx, 'fill')).toBe(0);
  });

  it('always clears the canvas before painting', () => {
    const ctx = makeCtx();
    render(ctx, options());

    expect(count(ctx, 'clearRect')).toBe(1);
    expect(ctx.ops.indexOf('clearRect')).toBeLessThan(ctx.ops.indexOf('fillRect'));
  });

  it('does not draw a white cell lattice over an auto-generated photo', () => {
    // A photo object is one object per thread colour, with one ring per cell.
    // Stroking each ring made the generated picture disappear behind a grid.
    const cells = Array.from({ length: 120 }, (_, i) =>
      rectangleRing((i % 12) * 5, Math.floor(i / 12) * 5, 4, 4),
    );
    const photo = createObject('fill', cells);
    photo.params = {
      ...photo.params,
      photo: { enabled: true, style: 'satin', spacing: 0.4 },
    };

    const ctx = makeCtx();
    render(
      ctx,
      options({
        objects: [photo],
        showOutlines: true,
        showStitches: false,
        hoop: null,
      }),
    );

    // The hoop field is a fill, not a stroke. With the lattice suppressed there
    // is no outline stroke at all.
    expect(count(ctx, 'stroke')).toBe(0);
  });

  it('still draws a selection box around a photo object', () => {
    const cells = Array.from({ length: 120 }, (_, i) =>
      rectangleRing((i % 12) * 5, Math.floor(i / 12) * 5, 4, 4),
    );
    const photo = createObject('fill', cells);
    photo.params = {
      ...photo.params,
      photo: { enabled: true, style: 'satin', spacing: 0.4 },
    };

    const ctx = makeCtx();
    render(
      ctx,
      options({
        objects: [photo],
        selection: [photo.id],
        showOutlines: true,
        showStitches: false,
        hoop: null,
      }),
    );

    expect(count(ctx, 'strokeRect')).toBe(1);
  });
});

describe('wheel zoom', () => {
  it('zooms in when the wheel turns up and out when it turns down', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });

  it('leaves the view alone for a zero or unusable delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });

  it('caps one wheel event so a high-resolution wheel cannot jump', () => {
    expect(wheelZoomFactor(-10_000)).toBe(2);
    expect(wheelZoomFactor(10_000)).toBe(0.5);
  });
});

describe('applique preview', () => {
  function patch(enabled: boolean): EmbroideryObject {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 1);
    obj.params.applique = { ...DEFAULT_APPLIQUE, enabled };
    return obj;
  }

  it('tints an enabled patch as fabric under the stitches', () => {
    const ctx = makeCtx();
    render(ctx, options({ objects: [patch(true)] }));

    // One translucent fill for the patch; the stitch run itself is a stroke.
    expect(count(ctx, 'fill')).toBe(1);
  });

  it('leaves an ordinary fill alone', () => {
    const ctx = makeCtx();
    render(ctx, options({ objects: [patch(false)] }));

    expect(count(ctx, 'fill')).toBe(0);
  });

  it('skips a hidden patch', () => {
    const obj = patch(true);
    obj.hidden = true;
    const ctx = makeCtx();
    render(ctx, options({ objects: [obj] }));

    expect(count(ctx, 'fill')).toBe(0);
  });
});

describe('major grid lines', () => {
  it('marks every multiple of the major spacing', () => {
    expect(isMajorGridLine(0, 25)).toBe(true);
    expect(isMajorGridLine(25, 25)).toBe(true);
    expect(isMajorGridLine(-50, 25)).toBe(true);
    expect(isMajorGridLine(10, 5)).toBe(true);
  });

  it('leaves the lines in between minor', () => {
    expect(isMajorGridLine(5, 25)).toBe(false);
    expect(isMajorGridLine(12.5, 25)).toBe(false);
    expect(isMajorGridLine(24.9, 25)).toBe(false);
  });

  it('rejects a spacing that cannot describe a grid', () => {
    expect(isMajorGridLine(10, 0)).toBe(false);
    expect(isMajorGridLine(Number.NaN, 25)).toBe(false);
  });
});

describe('lettering hit testing and outlines', () => {
  // A lettering object carries no path rings at all, so anything that expects
  // an outline has to ask the engine for the laid-out letters instead.
  const text = createLettering({ x: 10, y: 20 }, { text: 'AB', height: 20 }, 0, 0);

  it('finds text by the box around its letters', () => {
    expect(hitTest([text], { x: 12, y: 30 }, view)?.id).toBe(text.id);
    // Far below the letters: nothing to grab.
    expect(hitTest([text], { x: 12, y: 200 }, view)).toBeNull();
  });

  it('keeps the topmost object when text overlaps a shape', () => {
    const box = createObject('fill', [rectangleRing(0, 0, 100, 100)]);

    // Text listed last is drawn on top, so the click grabs the text.
    expect(hitTest([box, text], { x: 12, y: 30 }, view)?.id).toBe(text.id);
    // The other way round, the shape covers the text's box.
    expect(hitTest([text, box], { x: 12, y: 30 }, view)?.id).toBe(box.id);
  });

  it('strokes glyph outlines although there are no path rings', () => {
    const withText = makeCtx();
    render(withText, options({ objects: [text], showOutlines: true, showStitches: false }));
    const empty = makeCtx();
    render(empty, options({ objects: [], showOutlines: true, showStitches: false }));

    expect(count(withText, 'moveTo')).toBeGreaterThan(count(empty, 'moveTo'));
    expect(count(withText, 'stroke')).toBeGreaterThan(count(empty, 'stroke'));
  });

  it('draws a selection box around the laid-out letters', () => {
    const selected = makeCtx();
    render(
      selected,
      options({
        objects: [text],
        selection: [text.id],
        showOutlines: true,
        showStitches: false,
      }),
    );
    const plain = makeCtx();
    render(plain, options({ objects: [text], showOutlines: true, showStitches: false }));

    expect(count(selected, 'strokeRect')).toBeGreaterThan(count(plain, 'strokeRect'));
  });
});

describe('Phase N/O preview passes', () => {
  it('adds shading strokes for the lit preview without changing the stitch path', () => {
    const flat = makeCtx();
    render(flat, options());
    const lit = makeCtx();
    render(lit, options({ render3d: true }));

    expect(count(lit, 'stroke')).toBeGreaterThan(count(flat, 'stroke'));
    expect(count(lit, 'lineTo')).toBe(count(flat, 'lineTo'));
  });

  it('replaces the flat hoop with a labelled crown in cap mode', () => {
    const cap = makeCtx();
    render(
      cap,
      options({
        capWrap: { enabled: true, radiusMm: 90, compensate: true },
        capCenterX: 90,
      }),
    );

    expect(cap.texts.some((text) => text.includes('Cap crown preview'))).toBe(true);
    // The crown is drawn instead of the rectangular hoop field.
    expect(count(cap, 'quadraticCurveTo')).toBeGreaterThan(0);
  });
});

describe('reference image', () => {
  const guide = {
    image: {} as CanvasImageSource,
    x: 10,
    y: 12,
    width: 80,
    height: 50,
    opacity: 0.8,
    visible: true,
  };

  it('paints a visible guide under the stitches', () => {
    const ctx = makeCtx();
    render(ctx, options({ referenceImage: guide }));

    expect(count(ctx, 'drawImage')).toBe(1);
    // It is clipped to its own rectangle rather than painting over the rulers.
    expect(count(ctx, 'clip')).toBe(1);
  });

  it('leaves the guide out when hidden or transparent', () => {
    const hidden = makeCtx();
    render(hidden, options({ referenceImage: { ...guide, visible: false } }));
    expect(count(hidden, 'drawImage')).toBe(0);

    const transparent = makeCtx();
    render(transparent, options({ referenceImage: { ...guide, opacity: 0 } }));
    expect(count(transparent, 'drawImage')).toBe(0);
  });

  it('does not project a flat guide onto the cap crown', () => {
    const ctx = makeCtx();
    render(
      ctx,
      options({
        referenceImage: guide,
        capWrap: { enabled: true, radiusMm: 90, compensate: true },
        capCenterX: 90,
      }),
    );

    expect(count(ctx, 'drawImage')).toBe(0);
  });
});
