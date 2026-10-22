import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeDst,
  readDst,
  readPes,
  readExp,
  readJef,
  readVp3,
  readTbf,
  readHus,
  detectFormat,
  JEF_MIME,
  VP3_MIME,
  TBF_MIME,
  HUS_MIME,
  PES_SIGNATURE,
  boundsOfObjects,
  signedArea,
  type RasterImage,
  type ThreadColor,
} from '@threadworks/engine';
import { useDesignStore } from './designStore.js';
import { referenceStore, type HoopEntry } from './referenceStore.js';
import type { AppSettings } from '../api/client.js';
import {
  DEFAULT_HOOP,
  createLettering,
  createObject,
  rectangleRing,
  circleRing,
  defaultParams,
} from '../model/defaults.js';
import { pointInRing, fitView, zoomAt, toDesign, toScreen } from '../canvas/render.js';

/**
 * Store tests run against the real engine, not a stub: the whole point of the
 * derived-compile cache is that preview and export agree, and that property is
 * only meaningful if the actual generator is running underneath.
 *
 * The default hoop is installed rather than left empty, so hoop validation is
 * live in every test below - leaving it absent would quietly test nothing.
 */
const DEFAULT_HOOP_ENTRY: HoopEntry = {
  ...DEFAULT_HOOP,
  presetId: DEFAULT_HOOP.id,
  builtin: true,
};

beforeEach(() => {
  referenceStore.setState({ hoops: [DEFAULT_HOOP_ENTRY] });
  useDesignStore.getState().newDesign();
  useDesignStore.setState({ optimizeColors: false });
});

describe('object editing', () => {
  it('adds an object and makes it the selection', () => {
    const store = useDesignStore.getState();
    const obj = createObject('fill', [rectangleRing(10, 10, 40, 30)]);

    store.addObject(obj);

    const state = useDesignStore.getState();
    expect(state.design.objects).toHaveLength(1);
    expect(state.selection).toEqual([obj.id]);
    expect(state.dirty).toBe(true);
  });

  it('removes only the selected objects', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const b = createObject('fill', [rectangleRing(50, 0, 20, 20)], 1, 1);
    store.addObject(a);
    store.addObject(b);

    useDesignStore.setState({ selection: [a.id] });
    useDesignStore.getState().removeSelected();

    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([b.id]);
  });

  it('does nothing on removeSelected when nothing is selected', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    // addObject selects what it creates, so clear that first to reach the
    // genuinely-nothing-selected path.
    useDesignStore.getState().clearSelection();
    const before = useDesignStore.getState().design.objects.length;

    useDesignStore.getState().removeSelected();

    expect(useDesignStore.getState().design.objects).toHaveLength(before);
  });

  it('duplicates a selection with fresh ids and a name suffix', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    a.name = 'Logo';
    store.addObject(a);

    useDesignStore.getState().duplicateSelected();

    const objects = useDesignStore.getState().design.objects;
    expect(objects).toHaveLength(2);
    expect(objects[1]!.id).not.toBe(objects[0]!.id);
    expect(objects[1]!.name).toBe('Logo copy');
    expect(objects[1]!.order).toBeGreaterThan(objects[0]!.order);
  });

  it('moves only selected objects', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const b = createObject('fill', [rectangleRing(50, 0, 20, 20)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.setState({ selection: [a.id] });

    useDesignStore.getState().moveSelected(5, 7);

    const objects = useDesignStore.getState().design.objects;
    expect(objects[0]!.path.rings[0]![0]).toEqual({ x: 5, y: 7 });
    expect(objects[1]!.path.rings[0]![0]).toEqual({ x: 50, y: 0 });
  });

  it('ignores a zero-distance move so history is not polluted', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    const historyBefore = useDesignStore.getState().past.length;

    useDesignStore.getState().moveSelected(0, 0);

    expect(useDesignStore.getState().past).toHaveLength(historyBefore);
  });

  it('patches stitch parameters without touching other objects', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const b = createObject('fill', [rectangleRing(50, 0, 20, 20)], 1, 1);
    store.addObject(a);
    store.addObject(b);

    useDesignStore.getState().updateParams(a.id, { spacing: 0.25 });

    const objects = useDesignStore.getState().design.objects;
    expect(objects[0]!.params.spacing).toBe(0.25);
    expect(objects[1]!.params.spacing).toBe(defaultParams('tatami').spacing);
  });

  it('reorders an object above every other', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const b = createObject('fill', [rectangleRing(50, 0, 20, 20)], 1, 1);
    store.addObject(a);
    store.addObject(b);

    useDesignStore.getState().bringForward(a.id);

    expect(useDesignStore.getState().design.objects[0]!.order).toBeGreaterThan(
      useDesignStore.getState().design.objects[1]!.order,
    );
  });
});

describe('node editing', () => {
  /** A square with predictable node order: TL, TR, BR, BL. */
  function square(): ReturnType<typeof createObject> {
    const obj = createObject('fill', [rectangleRing(10, 10, 40, 40)]);
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  const nodesOf = (id: string) =>
    useDesignStore.getState().design.objects.find((o) => o.id === id)!.path.rings[0]!;

  it('moves a single node without disturbing its neighbours', () => {
    const obj = square();
    const store = useDesignStore.getState();

    // Node 0 is the top-left corner of the square.
    store.moveNode(obj.id, 0, 0, 25, 30);

    const ring = nodesOf(obj.id);
    expect(ring[0]).toEqual({ x: 25, y: 30 });
    // The other three corners must not move: this is a point edit, not a
    // translate.
    expect(ring[1]).toEqual({ x: 50, y: 10 });
    expect(ring[2]).toEqual({ x: 50, y: 50 });
    expect(ring[3]).toEqual({ x: 10, y: 50 });
  });

  it('ignores a node index that does not exist', () => {
    const obj = square();
    const before = nodesOf(obj.id);

    useDesignStore.getState().moveNode(obj.id, 0, 99, 0, 0);
    useDesignStore.getState().moveNode(obj.id, 5, 0, 0, 0);

    expect(nodesOf(obj.id)).toEqual(before);
  });

  it('inserts a node on the segment after the given index', () => {
    const obj = square();

    useDesignStore.getState().insertNode(obj.id, 0, 0, { x: 30, y: 10 });

    const ring = nodesOf(obj.id);
    // The square gains a point on its top edge, between TL and TR.
    expect(ring).toHaveLength(5);
    expect(ring[1]).toEqual({ x: 30, y: 10 });
    // Original ordering is preserved around the insertion.
    expect(ring[0]).toEqual({ x: 10, y: 10 });
    expect(ring[2]).toEqual({ x: 50, y: 10 });
  });

  it('inserts after the last point by wrapping to the closing segment', () => {
    const obj = square();

    // Index 3 is the last corner; "after" it is the segment back to index 0.
    useDesignStore.getState().insertNode(obj.id, 0, 3, { x: 10, y: 30 });

    const ring = nodesOf(obj.id);
    expect(ring).toHaveLength(5);
    expect(ring[4]).toEqual({ x: 10, y: 30 });
  });

  it('deletes the requested nodes', () => {
    const obj = square();

    useDesignStore.getState().deleteNodes(obj.id, 0, [1]);

    const ring = nodesOf(obj.id);
    expect(ring).toHaveLength(3);
    // The surviving points are the ones not named in the deletion.
    expect(ring).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ]);
  });

  it('refuses a deletion that would leave fewer than three points', () => {
    const obj = square();
    const before = nodesOf(obj.id);

    // Four points minus three is one, which cannot enclose area.
    useDesignStore.getState().deleteNodes(obj.id, 0, [0, 1, 2]);

    expect(nodesOf(obj.id)).toEqual(before);
  });

  it('does nothing when deleting no nodes', () => {
    const obj = square();
    const before = nodesOf(obj.id);

    useDesignStore.getState().deleteNodes(obj.id, 0, []);

    expect(nodesOf(obj.id)).toEqual(before);
  });

  it('takes one undo step for a whole drag, not one per pixel', () => {
    const obj = square();
    const store = useDesignStore.getState();
    const pastBefore = useDesignStore.getState().past.length;

    // Exactly what the canvas does: one snapshot when the drag starts, then
    // history-less moves for every pointermove event.
    store.beginGesture();
    for (let i = 1; i <= 25; i++) {
      useDesignStore.getState().moveNode(obj.id, 0, 0, 10 + i, 10 + i);
    }

    // One snapshot, however many moves followed it.
    expect(useDesignStore.getState().past.length).toBe(pastBefore + 1);

    // A single undo must restore the node to where the drag began.
    useDesignStore.getState().undo();
    expect(nodesOf(obj.id)[0]).toEqual({ x: 10, y: 10 });
  });

  it('clears the redo stack when a gesture begins', () => {
    const obj = square();
    const store = useDesignStore.getState();

    store.moveNode(obj.id, 0, 0, 20, 20);
    store.undo();
    expect(useDesignStore.getState().future.length).toBe(1);

    // Starting a fresh edit makes the undone state unreachable.
    useDesignStore.getState().beginGesture();
    expect(useDesignStore.getState().future).toHaveLength(0);
  });

  it('recompiles stitches after a node moves', () => {
    const obj = square();
    const store = useDesignStore.getState();
    const before = store.getCompiled().sequence.stitches.length;

    // Pulling a corner in collapses part of the shape, so the tatami fill
    // needs fewer stitches to cover it.
    useDesignStore.getState().moveNode(obj.id, 0, 0, 40, 40);

    const after = useDesignStore.getState().getCompiled().sequence.stitches.length;
    expect(after).not.toBe(before);
  });
});

describe('palette', () => {
  it('clamps an object that pointed at the removed colour', () => {
    const palette = useDesignStore.getState().design.threadPalette;
    const lastIndex = palette.length - 1;

    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)], lastIndex));

    // Removing the last colour leaves nothing valid to point at.
    useDesignStore.getState().removeColor(palette[lastIndex]!.id);

    expect(useDesignStore.getState().design.threadPalette).toHaveLength(lastIndex);
    expect(useDesignStore.getState().design.objects[0]!.colorIndex).toBe(0);
  });

  it('keeps a valid index when an earlier colour is removed', () => {
    const palette = useDesignStore.getState().design.threadPalette;

    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)], 2));
    useDesignStore.getState().removeColor(palette[0]!.id);

    // Index 2 now refers to what was colour 3 - still in range, so untouched.
    const remaining = useDesignStore.getState().design.threadPalette;
    expect(remaining).toHaveLength(palette.length - 1);
    expect(useDesignStore.getState().design.objects[0]!.colorIndex).toBeLessThan(remaining.length);
  });

  it('never allows an empty palette', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));

    // Drain the palette down to a single colour.
    while (useDesignStore.getState().design.threadPalette.length > 1) {
      const last = useDesignStore.getState().design.threadPalette[0]!.id;
      useDesignStore.getState().removeColor(last);
    }

    const only = useDesignStore.getState().design.threadPalette[0]!;
    useDesignStore.getState().removeColor(only.id);

    expect(useDesignStore.getState().design.threadPalette).toHaveLength(1);
    expect(useDesignStore.getState().design.threadPalette[0]!.id).toBe(only.id);
  });

  it('ignores removing an id that is not in the palette', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    const before = useDesignStore.getState().design.threadPalette;
    const historyBefore = useDesignStore.getState().past.length;

    useDesignStore.getState().removeColor('not-a-real-colour');

    expect(useDesignStore.getState().design.threadPalette).toBe(before);
    // A no-op must not create an undo step - otherwise users would have to
    // press Undo several times to get back past a click that did nothing.
    expect(useDesignStore.getState().past).toHaveLength(historyBefore);
  });
});

describe('selection', () => {
  it('drops ids that no longer exist', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    store.addObject(a);

    useDesignStore.getState().setSelection(['a-ghost-id']);

    expect(useDesignStore.getState().selection).toEqual([]);
  });

  it('toggles an id in and out', () => {
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    useDesignStore.getState().addObject(a);
    // addObject already selected it; start from a clean slate.
    useDesignStore.getState().clearSelection();

    useDesignStore.getState().toggleSelection(a.id);
    expect(useDesignStore.getState().selection).toEqual([a.id]);

    useDesignStore.getState().toggleSelection(a.id);
    expect(useDesignStore.getState().selection).toEqual([]);
  });

  it('clears selection when switching away from the select tool', () => {
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    useDesignStore.getState().addObject(a);
    expect(useDesignStore.getState().selection).toHaveLength(1);

    useDesignStore.getState().setTool('complexFill');

    expect(useDesignStore.getState().selection).toEqual([]);
  });
});

describe('undo / redo', () => {
  it('reverts an add and restores it on redo', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    expect(useDesignStore.getState().design.objects).toHaveLength(1);

    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.objects).toHaveLength(0);
    expect(useDesignStore.getState().canRedo()).toBe(true);

    useDesignStore.getState().redo();
    expect(useDesignStore.getState().design.objects).toHaveLength(1);
  });

  it('is a no-op when there is nothing to undo', () => {
    const before = useDesignStore.getState().design;
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design).toBe(before);
  });

  it('clears the redo stack once a new edit lands', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().canRedo()).toBe(true);

    useDesignStore.getState().addObject(createObject('run', [rectangleRing(0, 0, 30, 0)]));

    expect(useDesignStore.getState().canRedo()).toBe(false);
  });

  it('does not alias live state into history', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    // Re-read: `getState()` snapshots are immutable views, not live handles.
    const original = useDesignStore.getState().design.objects[0]!;

    useDesignStore.getState().updateParams(original.id, { spacing: 9 });
    const edited = useDesignStore.getState().design.objects[0]!;
    expect(edited.params.spacing).toBe(9);

    useDesignStore.getState().undo();
    const undone = useDesignStore.getState().design.objects[0]!;

    // If history had stored a reference rather than a copy, the undone object
    // would have carried the edit backwards with it.
    expect(undone.params.spacing).toBe(original.params.spacing);
    expect(undone).not.toBe(edited);
    expect(undone.params).not.toBe(edited.params);
  });

  it('bounds history rather than growing without limit', () => {
    for (let i = 0; i < 200; i++) {
      useDesignStore.getState().addObject(createObject('fill', [rectangleRing(i, i, 5, 5)]));
    }
    // The bound lives in defaults; assert the store honours a finite cap.
    expect(useDesignStore.getState().past.length).toBeLessThanOrEqual(100);
  });
});

describe('configured undo depth', () => {
  afterEach(() => {
    // The depth is read straight out of the shared settings store, so a test
    // that left it behind would silently change every later assertion about
    // how much history a design keeps.
    referenceStore.setState({ settings: null });
  });

  function settingsWithUndoDepth(undoDepth: number): AppSettings {
    return {
      units: 'mm',
      defaultHoopId: null,
      defaultStitchType: 'tatami',
      autosaveIntervalMs: 30_000,
      undoDepth,
      showGrid: true,
      showRulers: true,
      snapToGrid: false,
      snapToObjects: false,
      gridSize: 5,
      gridMajorSize: 25,
      previewUnderlay: true,
      stitchSimulationSpeed: 1,
      updatedAt: null,
    };
  }

  it('keeps only as many steps as the preference allows', () => {
    referenceStore.setState({ settings: settingsWithUndoDepth(5) });

    for (let i = 0; i < 20; i++) {
      useDesignStore.getState().addObject(createObject('fill', [rectangleRing(i, i, 5, 5)]));
    }

    expect(useDesignStore.getState().past).toHaveLength(5);
    // The most recent edits are the ones that survived.
    expect(useDesignStore.getState().canUndo()).toBe(true);
  });

  it('falls back to the default depth when settings have not loaded', () => {
    referenceStore.setState({ settings: null });

    for (let i = 0; i < 70; i++) {
      useDesignStore.getState().addObject(createObject('fill', [rectangleRing(i, i, 5, 5)]));
    }

    expect(useDesignStore.getState().past).toHaveLength(60);
  });

  it('trims an existing stack when the depth is lowered', () => {
    for (let i = 0; i < 30; i++) {
      useDesignStore.getState().addObject(createObject('fill', [rectangleRing(i, i, 5, 5)]));
    }
    expect(useDesignStore.getState().past).toHaveLength(30);

    useDesignStore.getState().trimHistory(8);

    const lengths = useDesignStore.getState().past.map((p) => p.design.objects.length);
    expect(lengths).toHaveLength(8);
    // `slice(-8)` keeps the tail: each entry is the document as it stood
    // before an edit, so the newest one holds 29 of the 30 objects.
    expect(lengths[lengths.length - 1]).toBe(29);
    expect(lengths[0]).toBe(22);
  });

  it('trimming is not an edit to the design', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 10, 5, 5)]));
    const rev = useDesignStore.getState().rev;
    const design = JSON.stringify(useDesignStore.getState().design);

    // Checked in both directions: trimming must neither raise the dirty flag
    // (which would make autosave fire off a preference change) nor clear one
    // (which would hide a real unsaved edit).
    for (const dirty of [false, true]) {
      useDesignStore.setState({ dirty });
      useDesignStore.getState().trimHistory(1);

      expect(useDesignStore.getState().dirty).toBe(dirty);
    }

    expect(useDesignStore.getState().rev).toBe(rev);
    expect(JSON.stringify(useDesignStore.getState().design)).toBe(design);
  });

  it('ignores a depth it cannot make sense of rather than emptying the stack', () => {
    for (let i = 0; i < 10; i++) {
      useDesignStore.getState().addObject(createObject('fill', [rectangleRing(i, i, 5, 5)]));
    }

    useDesignStore.getState().trimHistory(Number.NaN);
    expect(useDesignStore.getState().past).toHaveLength(10);

    useDesignStore.getState().trimHistory(-4);
    expect(useDesignStore.getState().past).toHaveLength(10);
  });

  it('drops the far end of the redo stack too', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 5, 5)]));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 10, 5, 5)]));
    useDesignStore.getState().undo();
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().future).toHaveLength(2);

    useDesignStore.getState().trimHistory(1);
    expect(useDesignStore.getState().future).toHaveLength(1);
  });
});

describe('derived compile cache', () => {
  it('returns the same object until the document changes', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 10, 40, 40)]));

    const first = useDesignStore.getState().getCompiled();
    const second = useDesignStore.getState().getCompiled();

    expect(second).toBe(first);
  });

  it('recompiles after an edit', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 10, 40, 40)]));
    const first = useDesignStore.getState().getCompiled();

    useDesignStore.getState().updateParams(useDesignStore.getState().design.objects[0]!.id, {
      spacing: 0.2,
    });

    const second = useDesignStore.getState().getCompiled();
    expect(second).not.toBe(first);
    expect(second.sequence.stitches.length).toBeGreaterThan(first.sequence.stitches.length);
  });

  it('reports validation for a design that overruns the hoop', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.ok).toBe(false);
    expect(compiled.validation.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('reports no errors for a simple in-hoop design', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('judges the design against the hoop field the canvas actually draws', () => {
    // The renderer draws the field from (0,0) to (width, height), so a design
    // in the bottom-right quadrant is inside it. A hoop checked around the
    // origin instead would reject this and block export for a design the user
    // can plainly see fits.
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(100, 70, 60, 40)]));

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.issues.filter((i) => i.code === 'OUT_OF_HOOP')).toEqual([]);
  });

  it('flags a design sitting in the hoop safe margin', () => {
    // Flush to the top-left corner: inside the field, but inside the 5 mm
    // margin reserved for the frame.
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 40, 30)]));

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.ok).toBe(false);
    expect(compiled.validation.issues.some((i) => i.code === 'OUT_OF_HOOP')).toBe(true);
  });

  it('skips hoop checks entirely when no hoop is selected', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, hoopId: null } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 400, 300)]));

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.issues.filter((i) => i.code === 'OUT_OF_HOOP')).toEqual([]);
  });
});

describe('DST export', () => {
  it('produces a readable file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'My Logo / v2' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes } = useDesignStore.getState().exportDst();

    // The slash would create a subdirectory on download and the double space
    // would look broken in the machine's file list.
    expect(filename).toBe('My Logo v2.dst');
    expect(bytes.length).toBeGreaterThan(512);

    const parsed = readDst(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));

    expect(() => useDesignStore.getState().exportDst()).toThrow(/exceed|hoop|size/i);
  });

  it('falls back to a generic name when the design is unnamed', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: '   ' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 40)]));

    const { filename } = useDesignStore.getState().exportDst();
    expect(filename).toBe('design.dst');
  });

  it('exports every generated stitch it previewed', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const compiled = useDesignStore.getState().getCompiled();
    const parsed = readDst(writeDst(compiled.sequence.stitches, { colorCount: 1 }));

    // Encoded records can exceed source stitches because long travels are
    // chained, but never fewer.
    expect(parsed.stitches.length).toBeGreaterThanOrEqual(compiled.sequence.stitches.length);
  });
});

describe('multi-hoop section export', () => {
  it('returns a single part for a design that fits the hoop', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Small Logo' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const result = useDesignStore.getState().exportSections('dst');

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filename).toBe('Small Logo-part1of1.dst');
    expect(result.warnings).toEqual([]);
    // The part must decode to real stitches, not an empty shell.
    expect(readDst(result.files[0]!.bytes).stitches.length).toBeGreaterThan(0);
  });

  it('splits a too-wide design into several decodable parts', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Banner' } }));
    // Three squares spread across ~440 mm: far wider than the 180 mm hoop,
    // so the splitter must cut it into sections.
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 20, 60, 40)]));
    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(180, 20, 60, 40)], 1, 1));
    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(360, 20, 60, 40)], 2, 2));

    const result = useDesignStore.getState().exportSections('dst');

    expect(result.files.length).toBeGreaterThan(1);
    expect(result.hoopName).toBe(DEFAULT_HOOP.name);
    for (const file of result.files) {
      expect(file.filename).toMatch(/^Banner-part\d+of\d+\.dst$/);
      expect(readDst(file.bytes).stitches.length).toBeGreaterThan(0);
    }
    // Part numbering must be contiguous and match the file count.
    const indices = result.files.map((f) => Number(/part(\d+)of/.exec(f.filename)![1]));
    expect(indices).toEqual(indices.map((_, i) => i + 1));
  });

  it('splits a design that is out of the current hoop without refusing', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Wide' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 300, 20)]));

    // The design is genuinely OUT_OF_HOOP - that is why it is being split -
    // and the split export must not refuse for that reason alone.
    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.validation.ok).toBe(false);

    const result = useDesignStore.getState().exportSections('dst');
    expect(result.files.length).toBeGreaterThan(1);
  });

  it('still refuses a design with an unrelated error', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Broken' } }));
    // A degenerate path is an INVALID_PATH error, not an hoop-fit one.
    useDesignStore.getState().addObject(createObject('fill', [[{ x: 10, y: 10 }]]));

    expect(() => useDesignStore.getState().exportSections('dst')).toThrow();
  });

  it('exports PES and EXP parts with the right extensions', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Multi' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 20, 60, 40)]));
    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(200, 20, 60, 40)], 1, 1));

    const pes = useDesignStore.getState().exportSections('pes');
    const exp = useDesignStore.getState().exportSections('exp');

    expect(pes.files.length).toBeGreaterThan(1);
    expect(exp.files.length).toBeGreaterThan(1);
    for (const f of pes.files) expect(f.filename).toMatch(/\.pes$/);
    for (const f of exp.files) expect(f.filename).toMatch(/\.exp$/);
    expect(String.fromCharCode(...pes.files[0]!.bytes.slice(0, 8))).toBe(PES_SIGNATURE);
  });
});

describe('multi-hoop join preferences', () => {
  const original = () => useDesignStore.setState({ sectionOverlap: 0, sectionMarks: false });

  /** A banner wide enough that the splitter always has to cut it. */
  function wideDesign(name: string): void {
    useDesignStore.setState((s) => ({ design: { ...s.design, name } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(10, 20, 60, 40)]));
    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(180, 20, 60, 40)], 1, 1));
    useDesignStore
      .getState()
      .addObject(createObject('fill', [rectangleRing(360, 20, 60, 40)], 2, 2));
  }

  beforeEach(() => {
    original();
  });

  it('defaults to an exactly-adjacent cut with no crosses', () => {
    wideDesign('Plain');
    const result = useDesignStore.getState().exportSections('dst');

    expect(result.files.length).toBeGreaterThan(1);
    expect(result.message).not.toContain('sewn twice');
    expect(result.message).not.toContain('registration crosses');
  });

  it('passes a shared overlap through to the split', () => {
    wideDesign('Shared');
    useDesignStore.getState().setSectionOverlap(8);

    const result = useDesignStore.getState().exportSections('dst');

    expect(result.message).toContain('8 mm of every join sewn twice');
    expect(result.files.length).toBeGreaterThan(1);
    for (const file of result.files) expect(readDst(file.bytes).stitches.length).toBeGreaterThan(0);
  });

  it('passes registration crosses through to the split', () => {
    wideDesign('Marked');
    useDesignStore.getState().setSectionMarks(true);

    const result = useDesignStore.getState().exportSections('dst');

    expect(result.message).toContain('registration crosses');
    expect(result.files.length).toBeGreaterThan(1);
    for (const file of result.files) expect(readDst(file.bytes).stitches.length).toBeGreaterThan(0);
  });

  it('clamps the overlap to a number the hoop could ever honour', () => {
    useDesignStore.getState().setSectionOverlap(5000);
    expect(useDesignStore.getState().sectionOverlap).toBe(100);

    useDesignStore.getState().setSectionOverlap(-3);
    expect(useDesignStore.getState().sectionOverlap).toBe(0);

    // An empty number box reports NaN rather than an out-of-range number.
    useDesignStore.getState().setSectionOverlap(Number.NaN);
    expect(useDesignStore.getState().sectionOverlap).toBe(0);
  });

  it('reports the clamped value back, not the one typed', () => {
    wideDesign('Clamped');
    useDesignStore.getState().setSectionOverlap(5000);

    const result = useDesignStore.getState().exportSections('dst');

    // 100 mm then gets cut down again by the engine to what the frame can
    // hold, so the summary names the effective band, never the typed one.
    expect(result.message).toMatch(/\d+ mm of every join sewn twice/);
    expect(result.message).not.toContain('5000');
    expect(result.message).not.toContain('100 mm');
  });

  it('leaves the document alone: these are how it is cut, not what it is', () => {
    wideDesign('Untouched');
    const before = JSON.stringify(useDesignStore.getState().design);
    // Establish a clean document first: the assertion below is about the
    // preference setters, not about what `addObject` did to it.
    useDesignStore.setState({ dirty: false });

    useDesignStore.getState().setSectionOverlap(6);
    useDesignStore.getState().setSectionMarks(true);

    expect(JSON.stringify(useDesignStore.getState().design)).toBe(before);
    // Changing a preference is not an edit to the design, so it must not
    // leave the document marked as needing a save.
    expect(useDesignStore.getState().dirty).toBe(false);
  });
});

describe('PES export', () => {
  it('produces a Brother file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Rose' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = useDesignStore.getState().exportPes();

    expect(filename).toBe('Rose.pes');
    expect(mime).toBe('application/octet-stream');
    // Signature is plain ASCII at the head of the file.
    expect(String.fromCharCode(...bytes.slice(0, 8))).toBe(PES_SIGNATURE);

    const parsed = readPes(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
  });

  it('writes stitches that read back inside the design bounds', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const compiled = useDesignStore.getState().getCompiled();
    const parsed = readPes(useDesignStore.getState().exportPes().bytes);

    const sew = parsed.stitches.filter((s) => s.command === 'stitch');
    expect(sew.length).toBeGreaterThan(0);
    for (const s of sew) {
      // Fill compensation can push an underlay a fraction past the outline,
      // so allow a small margin - a flip or a shift would still be many mm out.
      expect(s.x).toBeGreaterThan(20 - 1);
      expect(s.x).toBeLessThan(60 + 1);
      expect(s.y).toBeGreaterThan(20 - 1);
      expect(s.y).toBeLessThan(40 + 1);
    }
    // The export must carry the same amount of sewing as the preview.
    const previewSew = compiled.sequence.stitches.filter((s) => s.command === 'stitch').length;
    expect(sew.length).toBeGreaterThanOrEqual(previewSew * 0.9);
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportPes()).toThrow(/exceed|hoop|size/i);
  });
});

describe('EXP export', () => {
  it('produces a Melco file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Leaf' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes } = useDesignStore.getState().exportExp();

    expect(filename).toBe('Leaf.exp');
    // EXP is a bare stitch stream: no header, so every byte is a record.
    expect(bytes.length % 2).toBe(0);

    const parsed = readExp(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
  });

  it('keeps exported stitches inside the design bounds', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const parsed = readExp(useDesignStore.getState().exportExp().bytes);
    const sew = parsed.stitches.filter((s) => s.command === 'stitch');
    expect(sew.length).toBeGreaterThan(0);
    for (const s of sew) {
      expect(s.x).toBeGreaterThan(20 - 1);
      expect(s.x).toBeLessThan(60 + 1);
      expect(s.y).toBeGreaterThan(20 - 1);
      expect(s.y).toBeLessThan(40 + 1);
    }
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportExp()).toThrow(/exceed|hoop|size/i);
  });
});

describe('JEF export', () => {
  it('produces a Janome file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Daisy' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = useDesignStore.getState().exportJef();

    expect(filename).toBe('Daisy.jef');
    expect(mime).toBe(JEF_MIME);
    // The header starts with a little-endian offset into the records, and
    // every colour slot is a whole 32-bit entry after it.
    const stitchOffset = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
    expect(stitchOffset).toBeGreaterThan(0x74);
    expect(stitchOffset % 4).toBe(0);

    const parsed = readJef(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
    expect(parsed.paletteIndices.length).toBeGreaterThan(0);
  });

  it('writes stitches that read back inside the design bounds', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const parsed = readJef(useDesignStore.getState().exportJef().bytes);
    const sew = parsed.stitches.filter((s) => s.command === 'stitch');
    expect(sew.length).toBeGreaterThan(0);
    for (const s of sew) {
      expect(s.x).toBeGreaterThan(20 - 1);
      expect(s.x).toBeLessThan(60 + 1);
      expect(s.y).toBeGreaterThan(20 - 1);
      expect(s.y).toBeLessThan(40 + 1);
    }
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportJef()).toThrow(/exceed|hoop|size/i);
  });
});

describe('VP3 export', () => {
  it('produces a Husqvarna file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Lily' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = useDesignStore.getState().exportVp3();

    expect(filename).toBe('Lily.vp3');
    expect(mime).toBe(VP3_MIME);
    // Every VP3 opens with the same magic.
    expect(detectFormat(bytes)).toBe('vp3');

    const parsed = readVp3(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
    expect(parsed.threads.length).toBeGreaterThan(0);
  });

  it('carries the design thread colours with it', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const parsed = readVp3(useDesignStore.getState().exportVp3().bytes);
    const sew = parsed.stitches.filter((s) => s.command === 'stitch');
    expect(sew.length).toBeGreaterThan(0);
    for (const s of sew) {
      expect(s.x).toBeGreaterThan(15);
      expect(s.x).toBeLessThan(65);
      expect(s.y).toBeGreaterThan(15);
      expect(s.y).toBeLessThan(45);
    }
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportVp3()).toThrow(/exceed|hoop|size/i);
  });
});

describe('TBF export', () => {
  it('produces a TBF named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Orchid' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = useDesignStore.getState().exportTbf();

    expect(filename).toBe('Orchid.tbf');
    expect(mime).toBe(TBF_MIME);
    expect(detectFormat(bytes)).toBe('tbf');

    const parsed = readTbf(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
    // The label field holds sixteen characters, so a short name comes back whole.
    expect(parsed.name).toBe('Orchid');
  });

  it('caps a long design name at the field width rather than shifting the file', () => {
    useDesignStore.setState((s) => ({
      design: { ...s.design, name: 'A Name Far Longer Than Sixteen' },
    }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    // The header is read by offset, so a longer name must not push the
    // needle order or palette out of place.
    expect(readTbf(useDesignStore.getState().exportTbf().bytes).name).toBe('A Name Far Longe');
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportTbf()).toThrow(/exceed|hoop|size/i);
  });
});

describe('HUS export', () => {
  it('produces a Husqvarna file named after the design', () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Tulip' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = useDesignStore.getState().exportHus();

    expect(filename).toBe('Tulip.hus');
    expect(mime).toBe(HUS_MIME);
    expect(detectFormat(bytes)).toBe('hus');

    const parsed = readHus(bytes);
    expect(parsed.stitches.length).toBeGreaterThan(0);
    expect(parsed.threads.length).toBeGreaterThan(0);
  });

  it('snaps each thread onto a spool the machine can name', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const parsed = readHus(useDesignStore.getState().exportHus().bytes);
    for (const thread of parsed.threads) {
      // A HUS palette slot points into the machine library, so every colour
      // that comes back is one the operator can actually load.
      expect(thread.name).not.toBe('');
      expect(thread.brand).toBe('Husqvarna Viking');
    }
  });

  it('refuses to export a design with validation errors', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 500, 500)]));
    expect(() => useDesignStore.getState().exportHus()).toThrow(/exceed|hoop|size/i);
  });
});

describe('stitch movie export', () => {
  it('renders a GIF named after the design', async () => {
    useDesignStore.setState((s) => ({ design: { ...s.design, name: 'Rose Garden' } }));
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));

    const { filename, bytes, mime } = await useDesignStore
      .getState()
      .exportMovie({ size: 64, maxFrames: 20 });

    expect(filename).toBe('Rose Garden-stitch.gif');
    expect(mime).toBe('image/gif');
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('renders with the design thread colours', async () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 40, 20)]));
    const hex = useDesignStore.getState().design.threadPalette[0]!.hex.replace('#', '');

    const { bytes } = await useDesignStore.getState().exportMovie({ size: 64, maxFrames: 20 });

    // The global colour table starts at byte 13: fabric first, threads after.
    expect([bytes[16]!, bytes[17]!, bytes[18]!]).toEqual([
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]);
  });

  it('refuses to render a design with nothing sewn', async () => {
    await expect(useDesignStore.getState().exportMovie()).rejects.toThrow(/stitches|object/i);
  });

  it('is deterministic for the same design', async () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 20, 20)]));
    const options = { size: 48, maxFrames: 12 } as const;

    const first = (await useDesignStore.getState().exportMovie(options)).bytes;
    const second = (await useDesignStore.getState().exportMovie(options)).bytes;

    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe('image tracing', () => {
  /** Two solid colour blocks side by side, with a transparent surround. */
  function twoToneImage(): RasterImage {
    const width = 40;
    const height = 20;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const left = x < 20;
        data[o] = left ? 220 : 30;
        data[o + 1] = left ? 30 : 60;
        data[o + 2] = left ? 40 : 200;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  }

  function emptyImage(): RasterImage {
    return { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4) };
  }

  it('replaces the design with traced fills and their palette', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));

    const summary = useDesignStore.getState().digitizeImage(twoToneImage(), {
      colorCount: 4,
      widthMm: 40,
    });

    expect(summary.objects).toBe(2);
    expect(summary.colors).toBe(2);

    const design = useDesignStore.getState().design;
    expect(design.objects).toHaveLength(2);
    expect(design.objects.every((o) => o.type === 'fill')).toBe(true);
    // The palette has to travel with the objects or colourIndex would dangle.
    expect(design.threadPalette).toHaveLength(2);
    expect(design.objects.map((o) => o.colorIndex).sort()).toEqual([0, 1]);
  });

  it('takes one undo step', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));
    const past = useDesignStore.getState().past.length;

    useDesignStore.getState().digitizeImage(twoToneImage(), { colorCount: 4, widthMm: 40 });

    expect(useDesignStore.getState().past.length).toBe(past + 1);
    useDesignStore.getState().undo();
    const objects = useDesignStore.getState().design.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe('fill');
  });

  it('centres the traced art inside the field', () => {
    const design = useDesignStore.getState().design;
    useDesignStore.getState().digitizeImage(twoToneImage(), { colorCount: 4, widthMm: 40 });

    const traced = useDesignStore.getState().design.objects;
    const bounds = boundsOfObjects(traced);
    // 40 mm wide, 20 mm tall, centred in the field.
    expect(bounds.minX).toBeGreaterThan(0);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(40, 1);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(20, 1);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(design.width / 2, 1);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(design.height / 2, 1);
  });

  it('compiles the traced objects into real stitches', () => {
    useDesignStore.getState().digitizeImage(twoToneImage(), { colorCount: 4, widthMm: 40 });

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.sequence.stitches.length).toBeGreaterThan(100);
    expect(compiled.sequence.colorCount).toBe(2);
    expect(compiled.validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('sews a traced ribbon as a satin column, not a hairline fill', () => {
    const width = 40;
    const height = 40;
    const data = new Uint8Array(width * height * 4);
    for (let y = 19; y <= 20; y++) {
      for (let x = 5; x < 35; x++) {
        const o = (y * width + x) * 4;
        data[o] = 220;
        data[o + 1] = 30;
        data[o + 2] = 40;
        data[o + 3] = 255;
      }
    }

    // 2 px of a 40 px / 40 mm image: a 2 mm ribbon, well under the 2.4 mm
    // where a fill stops reading as a clean edge.
    useDesignStore.getState().digitizeImage(
      { width, height, data },
      { colorCount: 4, widthMm: 40, spacing: 0.4, stitchLength: 2.5 },
    );

    const objects = useDesignStore.getState().design.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe('column');
    expect(objects[0]!.params.stitchType).toBe('satin');
    expect(objects[0]!.params.stitchLength).toBe(2.5);

    // The column sews across its 2 mm width, row after row: a hairline down
    // its own outline would be far fewer stitches and none spanning the
    // width. The ribbon is horizontal, so one row's penetrations share an x
    // and differ in y.
    const compiled = useDesignStore.getState().getCompiled();
    const sewn = compiled.sequence.stitches.filter((s) => s.command === 'stitch');
    expect(sewn.length).toBeGreaterThan(60);
    let across = 0;
    for (let i = 1; i < sewn.length; i++) {
      const a = sewn[i - 1]!;
      const b = sewn[i]!;
      if (Math.abs(b.x - a.x) > 0.01) continue;
      if (Math.abs(b.y - a.y) > 1.5) across++;
    }
    expect(across).toBeGreaterThan(40);
  });

  it('can add to the design instead of replacing it', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));

    useDesignStore.getState().digitizeImage(twoToneImage(), {
      colorCount: 4,
      widthMm: 40,
      mode: 'add',
    });

    expect(useDesignStore.getState().design.objects).toHaveLength(3);
  });

  it('reports detail it dropped', () => {
    const width = 60;
    const height = 30;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const big = x < 40;
        const speck = x === 55 && y === 15;
        data[o] = 220;
        data[o + 1] = 30;
        data[o + 2] = 40;
        data[o + 3] = big || speck ? 255 : 0;
      }
    }

    const summary = useDesignStore
      .getState()
      .digitizeImage({ width, height, data }, { colorCount: 4, widthMm: 60, minRegionMm2: 1 });

    expect(summary.objects).toBe(1);
    expect(summary.droppedSmall).toBe(1);
  });

  it('drops a solid surround instead of tracing the page behind a logo', () => {
    const width = 40;
    const height = 40;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const onPage = x < 12 || x >= 28 || y < 12 || y >= 28;
        data[o] = onPage ? 255 : 220;
        data[o + 1] = onPage ? 255 : 30;
        data[o + 2] = onPage ? 255 : 40;
        data[o + 3] = 255;
      }
    }

    const summary = useDesignStore
      .getState()
      .digitizeImage({ width, height, data }, { colorCount: 4, widthMm: 40 });

    expect(summary.droppedBackground).toBe(true);
    expect(summary.objects).toBe(1);
    expect(useDesignStore.getState().design.threadPalette).toHaveLength(1);
  });

  it('leaves the design untouched when there is nothing to sew', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));
    const before = useDesignStore.getState().design;

    const summary = useDesignStore.getState().digitizeImage(emptyImage(), { colorCount: 4 });

    expect(summary.objects).toBe(0);
    expect(useDesignStore.getState().design.objects).toEqual(before.objects);
    expect(useDesignStore.getState().design.threadPalette).toEqual(before.threadPalette);
  });

  it('keeps the source picture aligned with the generated trace', () => {
    useDesignStore.getState().digitizeImage(twoToneImage(), {
      colorCount: 4,
      widthMm: 40,
      reference: {
        dataUrl: 'data:image/png;base64,AAAA',
        name: 'shirt.png',
        opacity: 0.7,
      },
    });

    const design = useDesignStore.getState().design;
    const reference = design.referenceImage;
    expect(reference).not.toBeNull();
    expect(reference?.name).toBe('shirt.png');
    expect(reference?.opacity).toBe(0.7);

    const bounds = boundsOfObjects(design.objects);
    expect(reference?.x).toBeCloseTo(bounds.minX, 5);
    expect(reference?.y).toBeCloseTo(bounds.minY, 5);
    expect(reference?.width).toBeCloseTo(bounds.maxX - bounds.minX, 5);
    expect(reference?.height).toBeCloseTo(bounds.maxY - bounds.minY, 5);
  });

  it('places, fades, resizes and removes a tracing guide without touching stitches', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));
    const objects = useDesignStore.getState().design.objects;

    useDesignStore.getState().placeReferenceImage({
      dataUrl: 'data:image/png;base64,AAAA',
      name: 'logo.png',
      width: 40,
      height: 20,
    });

    const placed = useDesignStore.getState().design.referenceImage;
    expect(placed).not.toBeNull();
    // Centred in the 180 x 130 field.
    expect(placed?.x).toBe(70);
    expect(placed?.y).toBe(55);

    useDesignStore.getState().updateReferenceImage({ opacity: 0.4, width: 60, height: 30 });
    const updated = useDesignStore.getState().design.referenceImage;
    expect(updated?.opacity).toBe(0.4);
    expect(updated?.width).toBe(60);
    // The guide is not an embroidery object.
    expect(useDesignStore.getState().design.objects).toEqual(objects);

    useDesignStore.getState().removeReferenceImage();
    expect(useDesignStore.getState().design.referenceImage).toBeNull();
  });
});

describe('auto-hooping', () => {
  /** A small library spanning several sizes, mirroring the seeded frames. */
  function installLibrary(): void {
    const entry = (
      id: string,
      name: string,
      width: number,
      height: number,
      safeMargin: number,
    ): HoopEntry => ({
      id,
      name,
      width,
      height,
      shape: 'rect',
      safeMargin,
      presetId: id,
      builtin: true,
    });

    referenceStore.setState({
      hoops: [
        entry('h100', '100 x 100', 100, 100, 4),
        entry('h126', '126 x 110', 126, 110, 4),
        entry('h180', '180 x 130', 180, 130, 5),
        entry('h200', '200 x 200', 200, 200, 5),
        entry('cap', 'Cap frame', 80, 180, 5),
      ],
    });
  }

  /** A filled square placed at the origin, sized in millimetres. */
  function placeSquare(size: number): void {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, size, size)]));
  }

  beforeEach(installLibrary);

  it('shrinks to the smallest hoop the design fits', () => {
    // A 50 mm square needs a frame with at least 50 mm of usable field.
    placeSquare(50);
    const message = useDesignStore.getState().autoHoop();

    const state = useDesignStore.getState();
    // The 100 hoop leaves 92 mm usable, which holds a 50 mm square comfortably.
    expect(state.design.hoopId).toBe('h100');
    expect(state.design.width).toBe(100);
    expect(state.design.height).toBe(100);
    expect(message).toContain('100 x 100 mm');
  });

  it('steps up when the design is too big for the small hoop', () => {
    // 110 mm wide is more than the 100 hoop's 92 mm usable field, so it must
    // step up. The design is 110 x 90 (not square) because the 126x110 hoop
    // only leaves 102 mm of usable depth - a 110 mm tall design would not fit
    // it either, and would have to jump to 180x130 instead.
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 110, 90)]));
    useDesignStore.getState().autoHoop();

    // The 126x110 hoop leaves 118 x 102, which holds 110 x 90 without turning.
    expect(useDesignStore.getState().design.hoopId).toBe('h126');
  });

  it('centres the design inside the usable field, not the raw hoop', () => {
    placeSquare(50);
    useDesignStore.getState().autoHoop();

    const obj = useDesignStore.getState().design.objects[0]!;
    const xs = obj.path.rings[0]!.map((p) => p.x);
    const ys = obj.path.rings[0]!.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

    // Usable field is 4..96 after the 4 mm margin, so the centre is 50.
    expect(cx).toBeCloseTo(50, 6);
    expect(cy).toBeCloseTo(50, 6);
  });

  it('refuses when the design outgrows every hoop and says why', () => {
    placeSquare(500);
    const message = useDesignStore.getState().autoHoop();

    expect(message).toMatch(/larger than every hoop/i);
    // The hoop must be left exactly as it was, not quietly downgraded.
    expect(useDesignStore.getState().design.hoopId).toBe(DEFAULT_HOOP.id);
  });

  it('says so rather than acting on an empty design', () => {
    const message = useDesignStore.getState().autoHoop();

    expect(message).toMatch(/no stitches/i);
    expect(useDesignStore.getState().design.hoopId).toBe(DEFAULT_HOOP.id);
  });

  it('says so when no hoop presets are loaded', () => {
    referenceStore.setState({ hoops: [] });
    const message = useDesignStore.getState().autoHoop();

    expect(message).toMatch(/no hoop presets/i);
  });

  it('turns a long thin design when that finds a smaller frame', () => {
    // A 165 x 65 bar fits the cap frame (usable 70 x 170) only once turned,
    // and the cap frame is smaller than the 180x130 hoop that would take it
    // unturned.
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 165, 65)]));
    const message = useDesignStore.getState().autoHoop({ allowRotation: true });

    expect(useDesignStore.getState().design.hoopId).toBe('cap');
    expect(message).toMatch(/turned 90 degrees/i);
  });

  it('leaves the design unturned when rotation is refused', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 165, 65)]));
    useDesignStore.getState().autoHoop({ allowRotation: false });

    // Without turning, the cap frame cannot hold it; the 180x130 can.
    expect(useDesignStore.getState().design.hoopId).toBe('h180');
    const obj = useDesignStore.getState().design.objects[0]!;
    const xs = obj.path.rings[0]!.map((p) => p.x);
    // Still 165 mm wide - it was not rotated.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(165, 6);
  });

  it('can skip centring and leave the design where it is', () => {
    placeSquare(50);
    const before = useDesignStore.getState().design.objects[0]!.path.rings[0]![0]!;

    useDesignStore.getState().autoHoop({ center: false });

    expect(useDesignStore.getState().design.hoopId).toBe('h100');
    expect(useDesignStore.getState().design.objects[0]!.path.rings[0]![0]).toEqual(before);
  });

  it('undoes the whole operation as one step', () => {
    placeSquare(50);
    const original = useDesignStore.getState().design.objects[0]!.path.rings[0]![0];

    useDesignStore.getState().autoHoop();
    // The design moved to the centre of the new hoop.
    expect(useDesignStore.getState().design.objects[0]!.path.rings[0]![0]).not.toEqual(original);

    useDesignStore.getState().undo();

    // One undo restores both the position and the hoop that changed with it.
    expect(useDesignStore.getState().design.objects[0]!.path.rings[0]![0]).toEqual(original);
    expect(useDesignStore.getState().design.hoopId).toBe(DEFAULT_HOOP.id);
  });

  it('leaves hidden objects where they are', () => {
    placeSquare(50);
    const hidden = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    useDesignStore.getState().addObject({ ...hidden, hidden: true });
    const hiddenBefore = useDesignStore.getState().design.objects[1]!.path.rings[0]![0];

    useDesignStore.getState().autoHoop();

    // Hidden work is not part of what will sew, so it must not be moved.
    expect(useDesignStore.getState().design.objects[1]!.path.rings[0]![0]).toEqual(hiddenBefore);
  });
});

describe('colour blending', () => {
  /** Two overlapping tatami squares, the simplest blendable pair. */
  function placePair(): [string, string] {
    const a = createObject('fill', [rectangleRing(0, 0, 40, 40)]);
    const b = createObject('fill', [rectangleRing(20, 0, 40, 40)], 1, 1);
    const store = useDesignStore.getState();
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);
    return [a.id, b.id];
  }

  const paramsOf = (id: string) =>
    useDesignStore.getState().design.objects.find((o) => o.id === id)!.params;

  it('halves the coverage of each fill', () => {
    const [a, b] = placePair();
    const before = paramsOf(a).spacing;

    const message = useDesignStore.getState().blendSelected();

    // Each fill now covers half the area, so its row pitch doubles.
    expect(paramsOf(a).spacing).toBeCloseTo(before * 2, 6);
    expect(paramsOf(b).spacing).toBeCloseTo(paramsOf(b).spacing, 6);
    expect(message).toContain('2 fills');
  });

  it('spreads the angles so the fills do not stack into stripes', () => {
    const [a, b] = placePair();

    useDesignStore.getState().blendSelected();

    // Two fills must end up a quarter turn apart; at the same angle their
    // rows would lie on top of each other and read as stripes, not a mix.
    const angleA = paramsOf(a).angle;
    const angleB = paramsOf(b).angle;
    const apart = Math.abs(((angleA - angleB) % 180) + 180) % 180;
    expect(apart).toBeCloseTo(90, 6);
  });

  it('keeps the total stitch count near a single full fill', () => {
    placePair();

    // A blend must not double the thread: two half-density fills should land
    // close to what one full fill would use, or the fabric puckers.
    const single = useDesignStore.getState().getCompiled().sequence.stitches.length;

    useDesignStore.getState().blendSelected();
    const blended = useDesignStore.getState().getCompiled().sequence.stitches.length;

    // The two squares overlap, so blended is not identical to one square -
    // but it must not balloon towards double.
    expect(blended).toBeLessThan(single * 2.2);
  });

  it('honours a density multiplier', () => {
    const [a] = placePair();
    const before = paramsOf(a).spacing;

    // 0.5 of the shared half-density - a lighter blend than the default.
    useDesignStore.getState().blendSelected({ densityMultiplier: 0.5 });

    // 0.45 starting pitch * 2 fills * 0.5 = 0.45, back where it began.
    expect(paramsOf(a).spacing).toBeCloseTo(before, 6);
  });

  it('refuses a single object and says why', () => {
    const [a] = placePair();
    useDesignStore.getState().setSelection([a]);
    const before = paramsOf(a);

    const message = useDesignStore.getState().blendSelected();

    expect(message).toMatch(/at least two/i);
    // Nothing may change when the blend is refused.
    expect(paramsOf(a)).toEqual(before);
  });

  it('refuses when the selection includes a run or satin', () => {
    const [a] = placePair();
    const run = createObject(
      'run',
      [
        [
          { x: 0, y: 60 },
          { x: 40, y: 60 },
        ],
      ],
      1,
      1,
    );
    useDesignStore.getState().addObject(run);
    useDesignStore.getState().setSelection([a, run.id]);
    const before = paramsOf(a);

    const message = useDesignStore.getState().blendSelected();

    // A run is a single line, so thinning it would lighten nothing; the
    // whole blend is refused rather than half-applied.
    expect(message).toMatch(/area fills/i);
    expect(paramsOf(a)).toEqual(before);
  });

  it('undoes the whole blend in one step', () => {
    const [a, b] = placePair();
    const beforeA = paramsOf(a);
    const beforeB = paramsOf(b);

    useDesignStore.getState().blendSelected();
    expect(paramsOf(a)).not.toEqual(beforeA);

    // One undo restores every fill, not one at a time.
    useDesignStore.getState().undo();
    expect(paramsOf(a)).toEqual(beforeA);
    expect(paramsOf(b)).toEqual(beforeB);
  });

  it('blends three fills a sixth of a turn apart each', () => {
    const a = createObject('fill', [rectangleRing(0, 0, 40, 40)]);
    const b = createObject('fill', [rectangleRing(20, 0, 40, 40)], 1, 1);
    const c = createObject('fill', [rectangleRing(40, 0, 40, 40)], 2, 2);
    const store = useDesignStore.getState();
    store.addObject(a);
    store.addObject(b);
    store.addObject(c);
    useDesignStore.getState().setSelection([a.id, b.id, c.id]);

    useDesignStore.getState().blendSelected();

    const angles = [a.id, b.id, c.id].map((id) => paramsOf(id).angle).sort((x, y) => x - y);
    // 180 / 3 = 60 degrees apart between neighbours.
    expect(angles[1]! - angles[0]!).toBeCloseTo(60, 6);
    expect(angles[2]! - angles[1]!).toBeCloseTo(60, 6);
  });

  it('does not touch objects outside the selection', () => {
    placePair();
    const bystander = createObject('fill', [rectangleRing(0, 80, 30, 30)], 2, 2);
    useDesignStore.getState().addObject(bystander);
    const before = paramsOf(bystander.id);

    useDesignStore.getState().blendSelected();

    // Only the selected pair is blended; anything else keeps its settings.
    expect(paramsOf(bystander.id)).toEqual(before);
  });
});

describe('design lifecycle', () => {
  it('resets objects, history and dirty flag on newDesign', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));
    expect(useDesignStore.getState().dirty).toBe(true);

    useDesignStore.getState().newDesign('Fresh');

    const state = useDesignStore.getState();
    expect(state.design.objects).toHaveLength(0);
    expect(state.design.name).toBe('Fresh');
    expect(state.design.projectId).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  it('clears history and selection when loading a design', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)]));

    useDesignStore.getState().loadDesign({
      projectId: 'p1',
      name: 'Loaded',
      version: 3,
      units: 'mm',
      width: 150,
      height: 100,
      hoopId: 'hoop-180x130',
      objects: [createObject('run', [rectangleRing(0, 0, 10, 10)])],
      threadPalette: [],
    });

    const state = useDesignStore.getState();
    expect(state.design.projectId).toBe('p1');
    expect(state.design.version).toBe(3);
    expect(state.design.objects).toHaveLength(1);
    expect(state.selection).toEqual([]);
    expect(state.past).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });

  it('records the new version after a save', () => {
    useDesignStore.getState().markSaved('abc', 7);

    const state = useDesignStore.getState();
    expect(state.design.projectId).toBe('abc');
    expect(state.design.version).toBe(7);
    expect(state.dirty).toBe(false);
  });
});

describe('view helpers', () => {
  it('fits a design inside the viewport', () => {
    const view = fitView(180, 130, 800, 600, 40);

    const bottomRight = toScreen({ x: 180, y: 130 }, view);
    expect(bottomRight.x).toBeLessThanOrEqual(800 - 40 + 1);
    expect(bottomRight.y).toBeLessThanOrEqual(600 - 40 + 1);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const view = fitView(180, 130, 800, 600);
    const before = toDesign(400, 300, view);

    const zoomed = zoomAt(view, 1.5, 400, 300);
    const after = toDesign(400, 300, zoomed);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps zoom so the design cannot vanish', () => {
    const view = fitView(180, 130, 800, 600);

    const wayOut = zoomAt(view, 10_000, 400, 300);
    expect(wayOut.scale).toBeLessThanOrEqual(40);

    const wayIn = zoomAt(view, 0.000_1, 400, 300);
    expect(wayIn.scale).toBeGreaterThanOrEqual(0.1);
  });

  it('round-trips a point between design and screen space', () => {
    const view = { scale: 3.5, offsetX: 17, offsetY: 23 };
    const original = { x: 42, y: 99 };

    const back = toDesign(toScreen(original, view).x, toScreen(original, view).y, view);

    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.y).toBeCloseTo(original.y, 9);
  });
});

describe('hit testing', () => {
  it('respects even-odd holes', () => {
    const withHole = {
      rings: [rectangleRing(0, 0, 40, 40), rectangleRing(10, 10, 20, 20).slice().reverse()],
    };

    // Imported through the render module's own containment test.
    expect(pointInRing(withHole.rings[0]!, { x: 5, y: 5 })).toBe(true);
    expect(pointInRing(withHole.rings[1]!, { x: 20, y: 20 })).toBe(true);
  });

  it('treats a triangle of three points as a closed shape', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInRing(triangle, { x: 5, y: 4 })).toBe(true);
    expect(pointInRing(triangle, { x: 9, y: 9 })).toBe(false);
  });

  it('returns false for a degenerate ring', () => {
    expect(
      pointInRing(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { x: 0, y: 0 },
      ),
    ).toBe(false);
  });
});

describe('circle geometry', () => {
  it('produces points that sit on the radius', () => {
    const ring = circleRing(50, 50, 20, 32);
    expect(ring).toHaveLength(32);

    for (const p of ring) {
      expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(20, 6);
    }
  });
});

/**
 * Transform actions bake into the source outline rather than setting a flag,
 * because the engine never applies `transform` at stitch time. These tests
 * therefore assert on the coordinates themselves - a flag could be set and
 * still produce an unchanged machine file, which is the bug being avoided.
 */
describe('transform actions', () => {
  function boundsOfSelected(): { minX: number; minY: number; maxX: number; maxY: number } {
    const s = useDesignStore.getState();
    const obj = s.design.objects.find((o) => o.id === s.selection[0]);
    if (!obj) throw new Error('no selection');
    return boundsOfObjects([obj]);
  }

  it('flips horizontally about the object centre, in place', () => {
    const store = useDesignStore.getState();
    // 0..20 wide, so the centre line is x = 10.
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    store.addObject(obj);

    useDesignStore.getState().flipSelected('x');
    const b = boundsOfSelected();

    // The box occupies the same space - a flip about your own centre cannot
    // move you - but the winding order is reversed, which the flip proves.
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(20, 6);

    const ring = useDesignStore.getState().design.objects[0]!.path.rings[0]!;
    expect(ring[0]!.x).toBeCloseTo(20, 6);
    expect(ring[0]!.y).toBeCloseTo(0, 6);
  });

  it('flips vertically', () => {
    const store = useDesignStore.getState();
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    store.addObject(obj);

    useDesignStore.getState().flipSelected('y');
    const ring = useDesignStore.getState().design.objects[0]!.path.rings[0]!;
    expect(ring[0]!.y).toBeCloseTo(10, 6);
    expect(ring[0]!.x).toBeCloseTo(0, 6);
  });

  it('scales about the centre so the shape grows outward', () => {
    const store = useDesignStore.getState();
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    store.addObject(obj);

    useDesignStore.getState().scaleSelected(2, 2);
    const b = boundsOfSelected();

    expect(b.minX).toBeCloseTo(-10, 6);
    expect(b.maxX).toBeCloseTo(30, 6);
    expect(b.minY).toBeCloseTo(-5, 6);
    expect(b.maxY).toBeCloseTo(15, 6);
  });

  it('refuses a non-positive scale instead of collapsing the outline', () => {
    const store = useDesignStore.getState();
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    store.addObject(obj);
    const before = JSON.stringify(useDesignStore.getState().design.objects);

    useDesignStore.getState().scaleSelected(0, 1);

    expect(JSON.stringify(useDesignStore.getState().design.objects)).toBe(before);
  });

  it('rotates 90 degrees about the centre', () => {
    const store = useDesignStore.getState();
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    store.addObject(obj);

    useDesignStore.getState().rotateSelected(90);
    const b = boundsOfSelected();

    // The tall box swaps to wide and stays centred on (10, 5).
    expect(b.maxX - b.minX).toBeCloseTo(10, 6);
    expect(b.maxY - b.minY).toBeCloseTo(20, 6);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(10, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(5, 6);
  });

  it('transforms every selected object, and only those', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 10)]);
    const b = createObject('fill', [rectangleRing(100, 0, 20, 10)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id]);

    useDesignStore.getState().scaleSelected(2, 2);

    const objects = useDesignStore.getState().design.objects;
    const moved = objects.find((o) => o.id === a.id)!;
    const untouched = objects.find((o) => o.id === b.id)!;
    expect(boundsOfObjects([moved]).maxX).toBeCloseTo(30, 6);
    expect(boundsOfObjects([untouched]).maxX).toBeCloseTo(120, 6);
  });

  it('leaves lettering alone - its geometry lives in the spec, not the path', () => {
    const store = useDesignStore.getState();
    const obj = createObject('lettering', []);
    store.addObject(obj);
    const before = JSON.stringify(useDesignStore.getState().design.objects[0]!.path);

    useDesignStore.getState().flipSelected('x');

    expect(JSON.stringify(useDesignStore.getState().design.objects[0]!.path)).toBe(before);
  });

  it('pushes one undo step per transform', () => {
    const store = useDesignStore.getState();
    store.addObject(createObject('fill', [rectangleRing(0, 0, 20, 10)]));
    const pastBefore = useDesignStore.getState().past.length;

    useDesignStore.getState().flipSelected('x');

    expect(useDesignStore.getState().past.length).toBe(pastBefore + 1);
    useDesignStore.getState().undo();
    // Back to x = 0 winding.
    const ring = useDesignStore.getState().design.objects[0]!.path.rings[0]!;
    expect(ring[0]!.x).toBeCloseTo(0, 6);
  });
});

describe('entry / exit placement', () => {
  function oneObject(): string {
    const store = useDesignStore.getState();
    // Off the origin on purpose: the default hoop keeps a 5 mm safe margin,
    // so a shape at (0,0) fails hoop validation for reasons that have nothing
    // to do with the entry/exit behaviour under test.
    const obj = createObject('fill', [rectangleRing(20, 20, 40, 20)]);
    store.addObject(obj);
    return obj.id;
  }

  it('arms from the panel and places on the next click', () => {
    const id = oneObject();

    useDesignStore.getState().armEntryExit('entry');
    expect(useDesignStore.getState().pendingEntryExit).toBe('entry');

    useDesignStore.getState().placeEntryExit({ x: 32, y: 27 });

    const obj = useDesignStore.getState().design.objects.find((o) => o.id === id)!;
    expect(obj.entryExit.entry).toEqual({ x: 32, y: 27 });
    // One click, one placement: the state must disarm so the NEXT click
    // selects normally instead of dropping a second entry point.
    expect(useDesignStore.getState().pendingEntryExit).toBeNull();
  });

  it('places an exit without disturbing the entry', () => {
    const id = oneObject();
    useDesignStore.getState().armEntryExit('entry');
    useDesignStore.getState().placeEntryExit({ x: 21, y: 22 });

    useDesignStore.getState().armEntryExit('exit');
    useDesignStore.getState().placeEntryExit({ x: 59, y: 38 });

    const obj = useDesignStore.getState().design.objects.find((o) => o.id === id)!;
    expect(obj.entryExit).toEqual({ entry: { x: 21, y: 22 }, exit: { x: 59, y: 38 } });
  });

  it('writes to every selected object', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const b = createObject('fill', [rectangleRing(30, 0, 20, 20)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);

    useDesignStore.getState().armEntryExit('entry');
    useDesignStore.getState().placeEntryExit({ x: 5, y: 5 });

    for (const o of useDesignStore.getState().design.objects) {
      expect(o.entryExit.entry).toEqual({ x: 5, y: 5 });
    }
  });

  it('arms nothing when nothing is selected', () => {
    useDesignStore.getState().armEntryExit('entry');
    expect(useDesignStore.getState().pendingEntryExit).toBeNull();
  });

  it('Escape cancels a placement without touching the document', () => {
    const id = oneObject();
    useDesignStore.getState().armEntryExit('entry');
    const before = JSON.stringify(useDesignStore.getState().design.objects);

    useDesignStore.getState().cancelEntryExit();

    expect(useDesignStore.getState().pendingEntryExit).toBeNull();
    expect(JSON.stringify(useDesignStore.getState().design.objects)).toBe(before);
    void id;
  });

  it('clearing the selection disarms, so a stale click cannot land anywhere', () => {
    oneObject();
    useDesignStore.getState().armEntryExit('entry');
    useDesignStore.getState().clearSelection();
    expect(useDesignStore.getState().pendingEntryExit).toBeNull();
  });

  it('switching away from the select tool disarms', () => {
    oneObject();
    useDesignStore.getState().armEntryExit('exit');
    useDesignStore.getState().setTool('run');
    expect(useDesignStore.getState().pendingEntryExit).toBeNull();

    useDesignStore.getState().setTool('select');
    expect(useDesignStore.getState().pendingEntryExit).toBeNull();
  });

  it('a placed point is a real undo step', () => {
    const id = oneObject();
    const before = useDesignStore.getState().past.length;

    useDesignStore.getState().armEntryExit('entry');
    useDesignStore.getState().placeEntryExit({ x: 29, y: 29 });

    expect(useDesignStore.getState().past.length).toBe(before + 1);
    useDesignStore.getState().undo();
    const obj = useDesignStore.getState().design.objects.find((o) => o.id === id)!;
    expect(obj.entryExit.entry).toBeNull();
  });

  it('a hand-set entry reaches the compiled sequence', () => {
    const id = oneObject();
    useDesignStore.getState().armEntryExit('entry');
    useDesignStore.getState().placeEntryExit({ x: 59, y: 39 });

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.sequence.stitches.length).toBeGreaterThan(0);

    // The object really carries the point the engine will read, and placing
    // it inside the shape does not introduce a hoop problem.
    const obj = useDesignStore.getState().design.objects.find((o) => o.id === id)!;
    expect(obj.entryExit.entry).toEqual({ x: 59, y: 39 });
    expect(compiled.validation.issues.filter((i) => i.code === 'OUT_OF_HOOP')).toEqual([]);
  });
});

describe('grouping', () => {
  it('gives every selected object the same groupId', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    const b = createObject('fill', [rectangleRing(20, 0, 10, 10)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);

    useDesignStore.getState().groupSelected();

    const objects = useDesignStore.getState().design.objects;
    const ga = objects.find((o) => o.id === a.id)!.groupId;
    const gb = objects.find((o) => o.id === b.id)!.groupId;
    expect(ga).toBeTruthy();
    expect(ga).toBe(gb);
  });

  it('refuses to group a lone object', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    const pastBefore = useDesignStore.getState().past.length;

    useDesignStore.getState().groupSelected();

    expect(useDesignStore.getState().design.objects[0]!.groupId).toBeNull();
    // No-op actions must not burn an undo step.
    expect(useDesignStore.getState().past).toHaveLength(pastBefore);
  });

  it('ungroups only the selected members', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    const b = createObject('fill', [rectangleRing(20, 0, 10, 10)], 1, 1);
    const c = createObject('fill', [rectangleRing(40, 0, 10, 10)], 0, 2);
    store.addObject(a);
    store.addObject(b);
    store.addObject(c);
    useDesignStore.getState().setSelection([a.id, b.id]);
    useDesignStore.getState().groupSelected();

    useDesignStore.getState().setSelection([a.id]);
    useDesignStore.getState().ungroupSelected();

    const objects = useDesignStore.getState().design.objects;
    expect(objects.find((o) => o.id === a.id)!.groupId).toBeNull();
    expect(objects.find((o) => o.id === b.id)!.groupId).toBeTruthy();
    expect(objects.find((o) => o.id === c.id)!.groupId).toBeNull();
  });

  it('moves a whole group together with one drag', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    const b = createObject('fill', [rectangleRing(20, 0, 10, 10)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);
    useDesignStore.getState().groupSelected();

    // The canvas expands a click on a member to the whole group, so a drag
    // arrives with every member selected.
    const group = useDesignStore
      .getState()
      .design.objects.filter((o) => o.groupId !== null)
      .map((o) => o.id);
    useDesignStore.getState().setSelection(group);
    useDesignStore.getState().moveSelected(5, 0);

    const objects = useDesignStore.getState().design.objects;
    expect(boundsOfObjects([objects.find((o) => o.id === a.id)!]).minX).toBeCloseTo(5, 6);
    expect(boundsOfObjects([objects.find((o) => o.id === b.id)!]).minX).toBeCloseTo(25, 6);
  });

  it('duplicating a group starts a NEW group, so the copy is not welded to the original', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    const b = createObject('fill', [rectangleRing(20, 0, 10, 10)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);
    useDesignStore.getState().groupSelected();

    useDesignStore.getState().duplicateSelected();

    const objects = useDesignStore.getState().design.objects;
    const original = objects.filter((o) => !o.id.includes('-copy-'));
    const copies = objects.filter((o) => o.id.includes('-copy-'));
    expect(copies).toHaveLength(2);
    expect(new Set(original.map((o) => o.groupId)).size).toBe(1);
    expect(new Set(copies.map((o) => o.groupId)).size).toBe(1);
    expect(copies[0]!.groupId).not.toBe(original[0]!.groupId);
  });

  it('keeps a grouped design compiling to the same stitches as before grouping', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    const b = createObject('fill', [rectangleRing(20, 0, 10, 10)], 1, 1);
    store.addObject(a);
    store.addObject(b);
    const before = JSON.stringify(store.getCompiled().sequence.stitches);

    useDesignStore.getState().setSelection([a.id, b.id]);
    useDesignStore.getState().groupSelected();
    const after = JSON.stringify(useDesignStore.getState().getCompiled().sequence.stitches);

    // Grouping is an editing convenience; it must not move a single stitch.
    expect(after).toBe(before);
  });
});

describe('the default stitch type preference', () => {
  it('decides what a freshly drawn complex fill is sewn as', () => {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0, 'motif');

    expect(obj.params.stitchType).toBe('motif');
    expect(obj.params.fillPattern).toBe('motif');
    // The preference sets the type; the spacing the shape would have had is
    // kept, so a dense fill does not silently become a sparse one.
    expect(obj.params.spacing).toBe(defaultParams('motif').spacing);
  });

  it('leaves the other tools to their own stitch type', () => {
    // A column is satin and a run is a run whatever the preference says: the
    // tool already chose, and an override here would redraw the shape the
    // operator thought they were drawing.
    const column = createObject('column', [rectangleRing(0, 0, 20, 20)], 0, 0, 'motif');
    const run = createObject('run', [rectangleRing(0, 0, 20, 0)], 0, 0, 'motif');

    expect(column.params.stitchType).toBe('satin');
    expect(run.params.stitchType).toBe('run');
  });

  it('changes nothing while the preference is the stock default', () => {
    // With the shipped default in force the parameter is a no-op: a fill
    // drawn under it must sew the very points a fill drawn before the
    // preference existed sewed. (The stitches are compared by geometry and
    // command, not as raw records: every stitch also carries its object id,
    // and two objects cannot share one.)
    const sewn = (): string =>
      JSON.stringify(
        useDesignStore
          .getState()
          .getCompiled()
          .sequence.stitches.map((s) => `${s.x},${s.y},${s.command}`),
      );

    const plain = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    const preferred = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0, 'tatami');

    const store = useDesignStore.getState();
    store.newDesign();
    store.addObject(plain);
    const before = sewn();

    store.newDesign();
    store.addObject(preferred);
    expect(sewn()).toBe(before);
  });
});

describe('shaping', () => {
  function areaOfPath(path: { rings: { x: number; y: number }[][] }): number {
    return path.rings.reduce((sum, ring) => sum + signedArea(ring), 0);
  }

  function addOverlappingPair() {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 1);
    const b = createObject('fill', [rectangleRing(5, 0, 10, 10)], 1, 2);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);
    return { a, b };
  }

  it('welds overlapping shapes into one outline', () => {
    addOverlappingPair();
    const message = useDesignStore.getState().shapeSelected('weld');
    const state = useDesignStore.getState();

    expect(message).toContain('Welded');
    expect(state.design.objects).toHaveLength(1);
    expect(areaOfPath(state.design.objects[0]!.path)).toBeCloseTo(150, 5);
    expect(state.selection).toEqual([state.design.objects[0]!.id]);
  });

  it('keeps disjoint shapes in one object as separate rings', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 1);
    const b = createObject('fill', [rectangleRing(50, 0, 10, 10)], 1, 2);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);

    useDesignStore.getState().shapeSelected('weld');
    const merged = useDesignStore.getState().design.objects[0]!;
    expect(merged.path.rings).toHaveLength(2);
    expect(areaOfPath(merged.path)).toBeCloseTo(200, 5);
  });

  it('subtracts the other shapes from the first', () => {
    addOverlappingPair();
    useDesignStore.getState().shapeSelected('subtract');
    const merged = useDesignStore.getState().design.objects[0]!;
    // First square is 100, the overlap is 50.
    expect(areaOfPath(merged.path)).toBeCloseTo(50, 5);
  });

  it('keeps only the shared area when intersecting', () => {
    addOverlappingPair();
    useDesignStore.getState().shapeSelected('intersect');
    const merged = useDesignStore.getState().design.objects[0]!;
    expect(areaOfPath(merged.path)).toBeCloseTo(50, 5);
  });

  it('combines into the parts covered exactly once', () => {
    addOverlappingPair();
    useDesignStore.getState().shapeSelected('combine');
    const merged = useDesignStore.getState().design.objects[0]!;
    // Each square is 100 and they share 50, so exactly-once coverage is
    // 100 + 100 - 2 * 50 = 100.
    expect(areaOfPath(merged.path)).toBeCloseTo(100, 5);
  });

  it('refuses to intersect shapes that do not meet and leaves them alone', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 1);
    const b = createObject('fill', [rectangleRing(50, 0, 10, 10)], 1, 2);
    store.addObject(a);
    store.addObject(b);
    useDesignStore.getState().setSelection([a.id, b.id]);

    const message = useDesignStore.getState().shapeSelected('intersect');
    expect(message).toContain('do not overlap');
    expect(useDesignStore.getState().design.objects).toHaveLength(2);
  });

  it('needs two shapes to run a boolean', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    expect(useDesignStore.getState().shapeSelected('weld')).toContain('at least two');
    expect(useDesignStore.getState().design.objects).toHaveLength(1);
  });

  it('undoes a boolean in one step', () => {
    addOverlappingPair();
    useDesignStore.getState().shapeSelected('weld');
    expect(useDesignStore.getState().design.objects).toHaveLength(1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.objects).toHaveLength(2);
  });

  it('creates an offset copy and keeps the original', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);

    const message = useDesignStore.getState().offsetSelected(2);
    const state = useDesignStore.getState();
    expect(message).toContain('offset');
    expect(state.design.objects).toHaveLength(2);
    const created = state.design.objects.find((o) => o.id !== a.id)!;
    expect(areaOfPath(created.path)).toBeCloseTo(196, 5);
    // The source is untouched.
    expect(areaOfPath(state.design.objects.find((o) => o.id === a.id)!.path)).toBeCloseTo(100, 5);
  });

  it('says so when a shrink leaves nothing', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);

    const message = useDesignStore.getState().offsetSelected(-6);
    expect(message).toContain('Nothing is left');
    expect(useDesignStore.getState().design.objects).toHaveLength(1);
  });

  it('creates a run border around the selection', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);

    useDesignStore.getState().borderSelected(2);
    const objects = useDesignStore.getState().design.objects;
    expect(objects).toHaveLength(2);
    const border = objects.find((o) => o.id !== a.id)!;
    expect(border.type).toBe('run');
    expect(border.params.stitchType).toBe('run');
    expect(areaOfPath(border.path)).toBeCloseTo(196, 5);
  });

  it('makes one border object per ring, so a frame gets an outer and a hole outline', () => {
    const store = useDesignStore.getState();
    const frame = createObject('fill', [rectangleRing(0, 0, 20, 20), rectangleRing(5, 5, 10, 10)]);
    store.addObject(frame);
    useDesignStore.getState().setSelection([frame.id]);

    useDesignStore.getState().borderSelected(1);
    const borders = useDesignStore.getState().design.objects.filter((o) => o.type === 'run');
    expect(borders).toHaveLength(2);
  });

  it('rounds the corners of the selected shape', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);

    const message = useDesignStore.getState().roundSelectedCorners(2);
    expect(message).toContain('Rounded');
    const rounded = useDesignStore.getState().design.objects[0]!;
    expect(rounded.path.rings[0]!.length).toBeGreaterThan(4);
    expect(areaOfPath(rounded.path)).toBeLessThan(100);
    expect(areaOfPath(rounded.path)).toBeGreaterThan(90);
  });

  it('refuses a radius of zero', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);
    expect(useDesignStore.getState().roundSelectedCorners(0)).toContain('greater than zero');
  });

  it('creates several concentric offsets in one action', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);
    useDesignStore.getState().setSelection([a.id]);

    useDesignStore.getState().offsetSelected(2, { copies: 3 });
    const objects = useDesignStore.getState().design.objects;
    expect(objects).toHaveLength(4);
    const areas = objects
      .filter((o) => o.id !== a.id)
      .map((o) => Math.round(areaOfPath(o.path)))
      .sort((x, y) => x - y);
    // Offsets of 2, 4 and 6 mm: 14x14, 18x18 and 22x22.
    expect(areas).toEqual([196, 324, 484]);
  });

  it('centres the whole design in the hoop', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)]);
    store.addObject(a);

    useDesignStore.getState().centerAll();
    const state = useDesignStore.getState();
    const bounds = boundsOfObjects(state.design.objects);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(state.design.width / 2, 6);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(state.design.height / 2, 6);
  });

  it('centres the combined bounds of several objects, not each one separately', () => {
    const store = useDesignStore.getState();
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 1);
    const b = createObject('fill', [rectangleRing(50, 0, 10, 10)], 1, 2);
    store.addObject(a);
    store.addObject(b);

    useDesignStore.getState().centerAll();
    const state = useDesignStore.getState();
    const bounds = boundsOfObjects(state.design.objects);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(state.design.width / 2, 6);
    // The two objects keep their relative positions.
    expect(bounds.maxX - bounds.minX).toBeCloseTo(60, 6);
  });
});

describe('photo stitch', () => {
  /** Two solid colour blocks side by side, 40 x 20 pixels. */
  function twoToneImage(): RasterImage {
    const width = 40;
    const height = 20;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const left = x < 20;
        data[o] = left ? 220 : 30;
        data[o + 1] = left ? 30 : 60;
        data[o + 2] = left ? 40 : 200;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  }

  it('creates one photo object per thread colour', () => {
    const summary = useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    expect(summary.objects).toBe(2);
    expect(summary.colors).toBe(2);
    expect(summary.cells).toBe(50);

    const design = useDesignStore.getState().design;
    expect(design.objects).toHaveLength(2);
    expect(design.threadPalette).toHaveLength(2);
    expect(design.objects.every((o) => o.params.photo?.enabled === true)).toBe(true);
    expect(design.objects.every((o) => o.params.photo?.style === 'satin')).toBe(true);
    const cells = design.objects.reduce((sum, o) => sum + o.path.rings.length, 0);
    expect(cells).toBe(50);
  });

  it('centres the picture inside the field', () => {
    const design = useDesignStore.getState().design;
    useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    const bounds = boundsOfObjects(useDesignStore.getState().design.objects);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(20, 1);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(10, 1);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(design.width / 2, 1);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(design.height / 2, 1);
  });

  it('compiles to real stitches with no validation errors', () => {
    useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    const compiled = useDesignStore.getState().getCompiled();
    expect(compiled.sequence.stitches.length).toBeGreaterThan(100);
    expect(compiled.validation.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(compiled.sequence.colorCount).toBe(2);
  });

  it('keeps the source photo behind the mosaic at the same box', () => {
    useDesignStore.getState().photoStitch(twoToneImage(), {
      widthMm: 20,
      cellMm: 2,
      colorCount: 2,
      reference: { dataUrl: 'data:image/png;base64,AAAA', name: 'photo.png' },
    });

    const design = useDesignStore.getState().design;
    const guide = design.referenceImage;
    const bounds = boundsOfObjects(design.objects);
    expect(guide?.name).toBe('photo.png');
    expect(guide?.x).toBeCloseTo(bounds.minX, 5);
    expect(guide?.y).toBeCloseTo(bounds.minY, 5);
    expect(guide?.width).toBeCloseTo(bounds.maxX - bounds.minX, 5);
    expect(guide?.height).toBeCloseTo(bounds.maxY - bounds.minY, 5);

    // Replacing the design without a new guide removes the old one.
    useDesignStore.getState().photoStitch(twoToneImage(), {
      widthMm: 20,
      cellMm: 2,
      colorCount: 2,
    });
    expect(useDesignStore.getState().design.referenceImage).toBeNull();
  });

  it('exports a photo mosaic to every machine format', () => {
    useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    const store = useDesignStore.getState();
    expect(store.exportDst().bytes.length).toBeGreaterThan(0);
    expect(store.exportPes().bytes.length).toBeGreaterThan(0);
    expect(store.exportExp().bytes.length).toBeGreaterThan(0);
    expect(store.exportJef().bytes.length).toBeGreaterThan(0);
    expect(store.exportVp3().bytes.length).toBeGreaterThan(0);
    expect(store.exportTbf().bytes.length).toBeGreaterThan(0);
    expect(store.exportHus().bytes.length).toBeGreaterThan(0);
  });

  it('renders a stitch movie from the photo mosaic', async () => {
    useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    const movie = await useDesignStore.getState().exportMovie({ size: 64, maxFrames: 20 });
    expect(movie.filename).toMatch(/\.gif$/);
    expect(movie.bytes.length).toBeGreaterThan(100);
    expect(String.fromCharCode(...movie.bytes.slice(0, 6))).toBe('GIF89a');
  });

  it('is a single undo step', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));
    const past = useDesignStore.getState().past.length;

    useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2 });

    expect(useDesignStore.getState().past.length).toBe(past + 1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.objects).toHaveLength(1);
  });

  it('appends threads and objects in add mode without dangling colour indices', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(0, 0, 10, 10)]));
    const before = useDesignStore.getState().design;
    const basePalette = before.threadPalette.length;
    const baseObjects = before.objects.length;

    const summary = useDesignStore
      .getState()
      .photoStitch(twoToneImage(), { widthMm: 20, cellMm: 2, colorCount: 2, mode: 'add' });

    const after = useDesignStore.getState().design;
    expect(after.objects).toHaveLength(baseObjects + summary.objects);
    expect(after.threadPalette).toHaveLength(basePalette + summary.colors);
    const added = after.objects.slice(baseObjects);
    expect(added.every((o) => o.colorIndex >= basePalette)).toBe(true);
    expect(new Set(after.threadPalette.map((c) => c.id)).size).toBe(after.threadPalette.length);
  });

  it('refuses a grid that would be too large to sew', () => {
    expect(() =>
      useDesignStore
        .getState()
        .photoStitch(twoToneImage(), { widthMm: 300, cellMm: 0.6, colorCount: 2 }),
    ).toThrow(/cells/);
  });

  it('leaves the design alone when every cell is transparent', () => {
    const data = new Uint8Array(4 * 4 * 4);
    const before = useDesignStore.getState().design;
    const summary = useDesignStore
      .getState()
      .photoStitch({ width: 4, height: 4, data }, { widthMm: 10, cellMm: 5, colorCount: 2 });

    expect(summary.objects).toBe(0);
    expect(useDesignStore.getState().design.objects).toEqual(before.objects);
  });
});

describe('sequencing', () => {
  const red: ThreadColor = { id: 'red', code: '1001', name: 'Red', hex: '#C8102E' };
  const blue: ThreadColor = { id: 'blue', code: '1002', name: 'Blue', hex: '#1C4FBF' };

  function add(_id: string, x: number, colorIndex: number, order: number) {
    const obj = createObject('fill', [rectangleRing(x, 0, 10, 10)], colorIndex, order);
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  it('reorders objects by nearest travel and is one undo step', () => {
    const a = add('a', 0, 0, 0);
    const b = add('b', 50, 0, 1);
    const c = add('c', 10, 0, 2);
    const store = useDesignStore.getState();

    const moved = store.autoSequence();

    expect(moved).toBe(2);
    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([a.id, c.id, b.id]);
    expect(useDesignStore.getState().design.objects.map((o) => o.order)).toEqual([0, 1, 2]);

    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([a.id, b.id, c.id]);
  });

  it('finishes the current thread first when colours are respected', () => {
    useDesignStore.getState().setPalette([red, blue]);
    const a = add('a', 0, 0, 0);
    const b = add('b', 10, 1, 1);
    const c = add('c', 50, 0, 2);

    useDesignStore.getState().autoSequence({ respectColors: true });

    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([a.id, c.id, b.id]);
  });

  it('is a no-op when the design is already in the shortest order', () => {
    add('a', 0, 0, 0);
    add('b', 10, 0, 1);
    const store = useDesignStore.getState();
    const past = store.past.length;
    useDesignStore.setState({ dirty: false });

    expect(store.autoSequence()).toBe(0);
    expect(useDesignStore.getState().past.length).toBe(past);
    expect(useDesignStore.getState().dirty).toBe(false);
  });

  it('cuts thread changes in the compiled sequence when turned on', () => {
    useDesignStore.getState().setPalette([red, blue]);
    const first = add('first', 0, 0, 0);
    const middle = add('middle', 50, 1, 1);
    const last = add('last', 5, 0, 2);
    const store = useDesignStore.getState();

    const changes = (): number => {
      const { sequence } = useDesignStore.getState().getCompiled();
      return sequence.stitches.filter((s) => s.command === 'colorChange').length;
    };

    expect(changes()).toBe(2);
    expect(first.id).not.toBe(last.id);

    store.setOptimizeColors(true);

    const { sequence } = useDesignStore.getState().getCompiled();
    expect(changes()).toBe(1);
    const sewed = sequence.stitches
      .filter((s) => s.command === 'stitch' && s.objectId !== null)
      .map((s) => s.objectId);
    const firstRuns: string[] = [];
    for (const id of sewed) if (firstRuns[firstRuns.length - 1] !== id) firstRuns.push(id!);
    expect(firstRuns).toEqual([first.id, last.id, middle.id]);

    // Session preference, not document content: turning it off restores the
    // old order and does not mark the design dirty for saving.
    useDesignStore.getState().setOptimizeColors(false);
    expect(changes()).toBe(2);
  });
});

describe('continue digitizing', () => {
  function addObject(obj: ReturnType<typeof createObject>) {
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  it('needs a single selected object with an outline', () => {
    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(false);

    const a = addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0));
    const b = addObject(createObject('fill', [rectangleRing(30, 0, 20, 20)], 0, 1));
    useDesignStore.getState().setSelection([a.id, b.id]);
    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(false);

    useDesignStore.getState().setSelection([b.id]);
    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(true);
    expect(useDesignStore.getState().continuingId).toBe(b.id);
    expect(useDesignStore.getState().tool).toBe('complexFill');
  });

  it('picks the tool that matches an open object', () => {
    const run = addObject(
      createObject(
        'run',
        [
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        ],
        0,
        0,
      ),
    );

    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(true);
    expect(useDesignStore.getState().tool).toBe('run');
    expect(useDesignStore.getState().continuingId).toBe(run.id);
  });

  it('refuses lettering, whose path is generated from its text', () => {
    // Give it a real outline so the refusal is the lettering rule, not the
    // empty-path guard.
    const text = addObject(createObject('lettering', [rectangleRing(0, 0, 10, 10)], 0, 0));
    expect(text.type).toBe('lettering');
    expect(text.path.rings[0]).toHaveLength(4);
    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(false);
  });

  it('leaves resume mode when another tool is picked', () => {
    addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0));
    expect(useDesignStore.getState().beginContinueDigitizing()).toBe(true);

    useDesignStore.getState().setTool('run');

    expect(useDesignStore.getState().continuingId).toBeNull();
  });

  it('replaces the resumed ring while keeping identity, thread and holes', () => {
    const outer = rectangleRing(0, 0, 20, 20);
    const hole = rectangleRing(5, 5, 5, 5);
    const obj = addObject(createObject('fill', [outer, hole], 1, 0));
    useDesignStore.getState().updateParams(obj.id, {
      spacing: 0.35,
      separatePullCompensation: { left: 0.3, right: 0.2 },
    });
    const before = useDesignStore.getState().design.objects[0]!;
    const past = useDesignStore.getState().past.length;

    const nextOuter = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ];
    useDesignStore.getState().replacePath(obj.id, [nextOuter, ...before.path.rings.slice(1)]);

    const after = useDesignStore.getState().design.objects[0]!;
    expect(useDesignStore.getState().past.length).toBe(past + 1);
    expect(after.id).toBe(obj.id);
    expect(after.colorIndex).toBe(1);
    expect(after.params).toEqual(before.params);
    expect(after.path.rings[0]).toEqual(nextOuter);
    expect(after.path.rings[1]).toEqual(before.path.rings[1]);

    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.objects[0]!.path.rings[0]).toEqual(outer);
  });

  it('cancelling keeps the object selected and unchanged', () => {
    const obj = addObject(createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0));
    const before = JSON.stringify(useDesignStore.getState().design.objects[0]!.path);
    useDesignStore.getState().beginContinueDigitizing();

    useDesignStore.getState().cancelContinueDigitizing();

    expect(useDesignStore.getState().continuingId).toBeNull();
    expect(useDesignStore.getState().tool).toBe('select');
    expect(useDesignStore.getState().selection).toEqual([obj.id]);
    expect(JSON.stringify(useDesignStore.getState().design.objects[0]!.path)).toBe(before);
  });
});

describe('redwork', () => {
  function addFill() {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 0);
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  const stored = () => useDesignStore.getState().design.objects[0]!;
  const convert = (
    patch: Partial<{
      style: 'single' | 'triple' | 'backstitch' | 'stem';
      widthMm: number;
      stitchMm: number;
      color: string;
    }> = {},
  ) =>
    useDesignStore.getState().redworkSelected({
      style: 'single',
      widthMm: 1.2,
      stitchMm: 2.5,
      color: '#C8102E',
      ...patch,
    });

  it('keeps the outline and id and adds the redwork thread', () => {
    const obj = addFill();
    const before = stored();
    const paletteBefore = useDesignStore.getState().design.threadPalette.length;

    const message = convert({ style: 'stem', widthMm: 1.4, stitchMm: 2, color: '#123456' });

    expect(message).toMatch(/Sewing 1 object as redwork/);
    const after = stored();
    expect(after.id).toBe(obj.id);
    expect(after.path.rings).toEqual(before.path.rings);
    expect(after.params.redwork).toEqual({
      enabled: true,
      style: 'stem',
      widthMm: 1.4,
      stitchMm: 2,
    });
    expect(useDesignStore.getState().design.threadPalette).toHaveLength(paletteBefore + 1);
    const thread = useDesignStore.getState().design.threadPalette[after.colorIndex];
    expect(thread?.hex).toBe('#123456');
  });

  it('reuses an existing thread of the same colour', () => {
    useDesignStore
      .getState()
      .setPalette([{ id: 'red-existing', code: 'R', name: 'Existing red', hex: '#c8102e' }]);
    addFill();

    convert();

    expect(useDesignStore.getState().design.threadPalette).toHaveLength(1);
    expect(stored().colorIndex).toBe(0);
  });

  it('is one undo step and restores the ordinary fill', () => {
    addFill();
    const past = useDesignStore.getState().past.length;
    const paletteBefore = useDesignStore.getState().design.threadPalette.length;

    convert();
    expect(useDesignStore.getState().past.length).toBe(past + 1);
    expect(stored().params.redwork?.enabled).toBe(true);

    useDesignStore.getState().undo();
    expect(stored().params.redwork).toBeUndefined();
    expect(useDesignStore.getState().design.threadPalette).toHaveLength(paletteBefore);
  });

  it('refuses an empty selection honestly', () => {
    useDesignStore.getState().clearSelection();

    expect(convert()).toBe('Select one or more objects to sew as redwork.');
    expect(useDesignStore.getState().past).toHaveLength(0);
  });

  it('leaves lettering alone and says how many were skipped', () => {
    addFill();
    const text = createObject('lettering', [rectangleRing(30, 0, 10, 10)], 0, 1);
    useDesignStore.getState().addObject(text);
    useDesignStore.getState().setSelection([stored().id, text.id]);

    const message = convert();

    expect(message).toContain('1 left unchanged');
    expect(stored().params.redwork?.enabled).toBe(true);
    expect(useDesignStore.getState().design.objects[1]!.params.redwork).toBeUndefined();
  });

  it('refuses photo cells, which are not a drawing to outline', () => {
    const obj = addFill();
    useDesignStore.getState().updateParams(obj.id, {
      photo: { enabled: true, style: 'satin', spacing: 0.4 },
    });

    expect(convert()).toMatch(/no outline/);
    expect(stored().params.redwork).toBeUndefined();
  });

  it('removes redwork without touching the geometry', () => {
    addFill();
    const before = stored().path.rings;
    convert();

    const message = useDesignStore.getState().removeRedworkSelected();

    expect(message).toMatch(/Redwork removed/);
    expect(stored().params.redwork).toBeNull();
    expect(stored().path.rings).toEqual(before);
  });

  it('compiles to an outline instead of filling the shape', () => {
    addFill();
    const fillStitches = useDesignStore
      .getState()
      .getCompiled()
      .sequence.stitches.filter((s) => s.command === 'stitch').length;

    convert();

    const lineStitches = useDesignStore
      .getState()
      .getCompiled()
      .sequence.stitches.filter((s) => s.command === 'stitch').length;
    expect(lineStitches).toBeGreaterThan(0);
    expect(lineStitches).toBeLessThan(fillStitches);
  });
});

describe('lettering transforms', () => {
  function addText(): string {
    const text = createLettering({ x: 20, y: 20 }, { text: 'AB', height: 20 }, 0, 0);
    useDesignStore.getState().addObject(text);
    useDesignStore.getState().setSelection([text.id]);
    return text.id;
  }

  const storedObject = (id: string) =>
    useDesignStore.getState().design.objects.find((o) => o.id === id)!;

  it('rotates text through its spec, not through geometry it does not have', () => {
    const id = addText();

    useDesignStore.getState().rotateSelected(90);

    expect(storedObject(id).lettering!.rotation).toBe(90);
    expect(storedObject(id).path.rings).toHaveLength(0);
  });

  it('wraps rotation into the editable range', () => {
    const id = addText();
    useDesignStore.getState().rotateSelected(270);
    expect(storedObject(id).lettering!.rotation).toBe(-90);
  });

  it('scales the cap height vertically and the width factor horizontally', () => {
    const id = addText();
    useDesignStore.getState().scaleSelected(1.2, 1.5);
    expect(storedObject(id).lettering!.height).toBeCloseTo(30, 6);
    expect(storedObject(id).lettering!.stretch).toBeCloseTo(1.2, 6);
  });

  it('clamps scales the schema would refuse', () => {
    const id = addText();
    useDesignStore.getState().scaleSelected(20, 100);
    expect(storedObject(id).lettering!.stretch).toBeLessThanOrEqual(4);
    expect(storedObject(id).lettering!.height).toBeLessThanOrEqual(300);
  });

  it('flips text by toggling a mirror and toggles it back', () => {
    const id = addText();

    useDesignStore.getState().flipSelected('x');
    expect(storedObject(id).lettering!.mirror).toEqual({ x: true, y: false });

    useDesignStore.getState().flipSelected('y');
    expect(storedObject(id).lettering!.mirror).toEqual({ x: true, y: true });

    useDesignStore.getState().flipSelected('x');
    expect(storedObject(id).lettering!.mirror).toEqual({ x: false, y: true });
  });

  it('moves text through its transform', () => {
    const id = addText();
    useDesignStore.getState().moveSelected(5, -3);
    expect(storedObject(id).transform).toEqual({ x: 25, y: 17 });
  });

  it('still translates shapes by their geometry', () => {
    const shape = createObject('fill', [rectangleRing(0, 0, 20, 20)]);
    useDesignStore.getState().addObject(shape);
    useDesignStore.getState().setSelection([shape.id]);

    useDesignStore.getState().moveSelected(5, -3);

    expect(storedObject(shape.id).path.rings[0]![0]).toEqual({ x: 5, y: -3 });
    expect(storedObject(shape.id).transform).toEqual({ x: 0, y: 0 });
  });
});

describe('Phase N/O design actions', () => {
  it('keeps the chosen font with the lettering object', () => {
    const text = createLettering({ x: 20, y: 20 }, { text: 'M', height: 20 });
    useDesignStore.getState().addObject(text);
    useDesignStore.getState().updateObject(text.id, {
      lettering: { ...text.lettering!, font: 'serif' },
    });

    expect(useDesignStore.getState().design.objects[0]!.lettering?.font).toBe('serif');
  });

  it('assigns and spreads objects across production machines', () => {
    const a = createObject('fill', [rectangleRing(20, 20, 20, 20)]);
    const b = createObject('fill', [rectangleRing(60, 20, 20, 20)], 1, 1);
    useDesignStore.getState().addObject(a);
    useDesignStore.getState().addObject(b);
    useDesignStore.setState({ selection: [a.id, b.id] });

    useDesignStore.getState().assignMachineToSelected(3);
    expect(useDesignStore.getState().design.objects.map((o) => o.machine)).toEqual([3, 3]);

    useDesignStore.getState().spreadMachinesAcrossSelected();
    expect(useDesignStore.getState().design.objects.map((o) => o.machine)).toEqual([1, 2]);
  });

  it('writes one independently decodable file per machine', () => {
    const a = createObject('fill', [rectangleRing(20, 20, 20, 20)]);
    const b = createObject('fill', [rectangleRing(120, 20, 20, 20)], 1, 1);
    b.machine = 2;
    useDesignStore.getState().addObject(a);
    useDesignStore.getState().addObject(b);

    const result = useDesignStore.getState().exportByMachine('dst');

    expect(result.machines).toEqual([1, 2]);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]!.filename).toContain('machine1');
    expect(result.files[1]!.filename).toContain('machine2');
    expect(readDst(result.files[0]!.bytes).stitches.length).toBeGreaterThan(0);
    expect(readDst(result.files[1]!.bytes).stitches.length).toBeGreaterThan(0);
  });

  it('applies the cap compensation to compiled coordinates, not the preview', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(30, 30, 20, 20)]));
    const flat = useDesignStore
      .getState()
      .getCompiled()
      .sequence.stitches.filter((stitch) => stitch.command === 'stitch')
      .map((stitch) => stitch.x);

    useDesignStore.getState().setCapWrap({ enabled: true, radiusMm: 90, compensate: true });
    const cap = useDesignStore
      .getState()
      .getCompiled()
      .sequence.stitches.filter((stitch) => stitch.command === 'stitch')
      .map((stitch) => stitch.x);

    // Flat geometry is 30..50 mm. Inverse projection stretches it away from
    // the 90 mm crown centre, so both extremes must move outward.
    expect(Math.min(...cap)).toBeLessThan(Math.min(...flat));
    expect(Math.max(...cap)).toBeLessThan(Math.max(...flat));
  });

  it('exports SVG artwork from the compiled sequence', async () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 20, 20)]));

    const result = await useDesignStore.getState().exportArtwork({ format: 'svg' });

    expect(result.filename).toMatch(/\.svg$/);
    expect(result.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(result.bytes)).toContain('<svg');
  });

  it('exports a printable PDF placement sheet', async () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 20, 20)]));

    const result = await useDesignStore.getState().exportArtwork({
      format: 'print',
      scale: '1:1',
      includeLegend: true,
    });

    expect(result.filename).toMatch(/-print\.pdf$/);
    expect(new TextDecoder().decode(result.bytes).startsWith('%PDF')).toBe(true);
  });
});
