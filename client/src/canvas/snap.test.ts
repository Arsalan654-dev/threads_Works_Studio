import { describe, it, expect } from 'vitest';
import { createObject, rectangleRing } from '../model/defaults.js';
import { snapToGrid, snapToObjects } from './snap.js';

/**
 * The snap rules are pure geometry, so they are pinned here rather than through
 * pointer events: the canvas honestly reports its own size only in a browser,
 * and a test that fakes it would be testing the fake.
 */

const rect = createObject('fill', [rectangleRing(0, 0, 100, 100)]);

describe('snapToObjects', () => {
  it('catches a vertex exactly, within the pixel threshold', () => {
    const hit = snapToObjects({ x: 0.3, y: 0.2 }, [rect], { scale: 10 });
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('node');
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(0);
    expect(hit!.objectId).toBe(rect.id);
  });

  it('catches the nearest point on an edge when no vertex is close', () => {
    const hit = snapToObjects({ x: 50, y: 0.5 }, [rect], { scale: 8 });
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('edge');
    expect(hit!.x).toBe(50);
    expect(hit!.y).toBe(0);
  });

  it('catches the centre of an object', () => {
    const hit = snapToObjects({ x: 50.3, y: 50.2 }, [rect], { scale: 8 });
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('centre');
    expect(hit!.x).toBe(50);
    expect(hit!.y).toBe(50);
  });

  it('prefers a vertex to an edge even when the edge is closer', () => {
    const hit = snapToObjects({ x: 0.6, y: 0.2 }, [rect], { scale: 8 });
    expect(hit!.kind).toBe('node');
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(0);
  });

  it('measures the threshold in pixels, so zooming in tightens it', () => {
    const point = { x: 5, y: 5 };
    expect(snapToObjects(point, [rect], { scale: 1 })?.kind).toBe('node');
    expect(snapToObjects(point, [rect], { scale: 20 })).toBeNull();
  });

  it('leaves a point alone when every feature is out of range', () => {
    // 20 mm from the nearest edge and 30 mm from the centre.
    expect(snapToObjects({ x: 50, y: 20 }, [rect], { scale: 10 })).toBeNull();
  });

  it('ignores hidden objects', () => {
    const hidden = { ...rect, hidden: true };
    expect(snapToObjects({ x: 0.2, y: 0.2 }, [hidden], { scale: 10 })).toBeNull();
  });

  it('does not let an object snap to itself', () => {
    expect(snapToObjects({ x: 0.2, y: 0.2 }, [rect], { scale: 10, excludeId: rect.id })).toBeNull();
  });

  it('does not invent an edge closing an open run', () => {
    const run = createObject('run', [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
    ]);
    // (25, 12.5) lies on the line that would close the ring, but an open run
    // has no such segment and the real edges are far away.
    expect(snapToObjects({ x: 25, y: 12.5 }, [run], { scale: 10 })).toBeNull();
  });

  it('treats a very dense object as a centre target only', () => {
    const ring = Array.from({ length: 4100 }, (_, i) => {
      const angle = (i / 4100) * Math.PI * 2;
      return { x: Math.cos(angle) * 1000, y: Math.sin(angle) * 1000 };
    });
    const dense = createObject('fill', [ring]);

    // Sitting on a node of the dense ring must not catch a node.
    expect(snapToObjects({ x: 1000, y: 0 }, [dense], { scale: 10 })).toBeNull();
    // The centre still works.
    const centre = snapToObjects({ x: 0.2, y: 0 }, [dense], { scale: 10 });
    expect(centre?.kind).toBe('centre');
  });

  it('refuses an unusable zoom instead of dividing by zero', () => {
    expect(snapToObjects({ x: 0, y: 0 }, [rect], { scale: 0 })).toBeNull();
    expect(snapToObjects({ x: 0, y: 0 }, [rect], { scale: Number.NaN })).toBeNull();
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest line', () => {
    expect(snapToGrid({ x: 7.4, y: -2.6 }, 5)).toEqual({ x: 5, y: -5 });
  });

  it('leaves the point alone for a nonsense grid', () => {
    expect(snapToGrid({ x: 7.4, y: -2.6 }, 0)).toEqual({ x: 7.4, y: -2.6 });
    expect(snapToGrid({ x: 7.4, y: -2.6 }, Number.NaN)).toEqual({ x: 7.4, y: -2.6 });
  });
});
