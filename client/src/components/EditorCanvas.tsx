/**
 * The design canvas.
 *
 * Handles pointer interaction and delegates all drawing to `canvas/render`.
 * Two things worth noting:
 *
 * - View lives in a ref, not React state: pointermove fires far faster than
 *   React re-renders usefully, and repainting straight from the ref keeps
 *   panning smooth without a state update per pixel.
 * - Preview is debounced through `requestAnimationFrame`, so a burst of
 *   pointer events results in at most one repaint per frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Point, Stitch } from '@threadworks/engine';
import { useDesignStore, type Tool } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { usePlaybackStore } from '../store/playbackStore.js';
import {
  fitView,
  hitTest,
  hitTestNode,
  hitTestSegment,
  render,
  toDesign,
  zoomAt,
  type RenderOptions,
  type View,
} from '../canvas/render.js';
import { snapToGrid, snapToObjects } from '../canvas/snap.js';
import { circleRing, createLettering, createObject, rectangleRing } from '../model/defaults.js';

const RULER = 18;
/** Below this, a click is a click rather than a drag. */
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  kind: 'pan' | 'move' | 'shape' | 'node' | 'none';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  originDesign: Point;
  objectId: string | null;
  shapeStart: Point | null;
  /** Ring + index of the node being dragged, when `kind === 'node'`. */
  node: { ring: number; index: number } | null;
}

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<View>({ scale: 4, offsetX: RULER + 20, offsetY: RULER + 20 });
  const frameRef = useRef<number | null>(null);
  /** Last point the pointer caught on object geometry, for the snap marker. */
  const snapRef = useRef<{ x: number; y: number; kind: 'node' | 'edge' | 'centre' } | null>(null);

  const objects = useDesignStore((s) => s.design.objects);
  const palette = useDesignStore((s) => s.design.threadPalette);
  const designWidth = useDesignStore((s) => s.design.width);
  const designHeight = useDesignStore((s) => s.design.height);
  const hoopId = useDesignStore((s) => s.design.hoopId);
  const selection = useDesignStore((s) => s.selection);
  const tool = useDesignStore((s) => s.tool);
  const continuingId = useDesignStore((s) => s.continuingId);
  const armed = useDesignStore((s) => s.pendingEntryExit);
  const rev = useDesignStore((s) => s.rev);

  const showGrid = referenceStore((s) => s.settings?.showGrid ?? true);
  const showRulers = referenceStore((s) => s.settings?.showRulers ?? true);
  const gridSize = referenceStore((s) => s.settings?.gridSize ?? 5);
  const gridMajorSize = referenceStore(
    (s) => s.settings?.gridMajorSize ?? (s.settings?.gridSize ?? 5) * 5,
  );
  // Underlay preview is a preference, not a constant: turning it off redraws
  // the canvas as the machine will not sew it, which makes dense areas easier
  // to read. It never changes what gets exported.
  const showUnderlay = referenceStore((s) => s.settings?.previewUnderlay ?? true);
  const preview3d = referenceStore((s) => s.settings?.preview3d ?? false);
  const hoopPresets = referenceStore((s) => s.hoops);
  const capWrap = useDesignStore((s) => s.design.capWrap);

  // Playback is read fresh inside `paint` rather than threaded through props,
  // but these two are subscribed so React re-renders and schedules a repaint
  // when the counter moves.
  const playbackPosition = usePlaybackStore((s) => s.position);
  const playbackActive = usePlaybackStore((s) => s.active);

  /** Points clicked so far for the polyline-style tools. */
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursorDesign, setCursorDesign] = useState<Point | null>(null);
  /** Nodes selected within the object under Node Edit. */
  const [editNodes, setEditNodes] = useState<{ ring: number; index: number }[]>([]);

  // Continue Digitizing resumes the object where it stopped: its existing
  // outline becomes the live draft, so the points already drawn are not lost
  // and the next click extends them. Seeding here (rather than in the store)
  // keeps the draft private to the canvas, exactly like a freshly drawn one.
  const continuingRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = continuingRef.current;
    continuingRef.current = continuingId;
    if (!continuingId) {
      // Switching tools while resuming clears the resumed draft rather than
      // leaving it half-live under the new tool.
      if (previous) setDraft([]);
      return;
    }
    const object = useDesignStore.getState().design.objects.find((o) => o.id === continuingId);
    if (!object) {
      useDesignStore.getState().cancelContinueDigitizing();
      return;
    }
    setDraft(object.path.rings[0]?.map((p) => ({ ...p })) ?? []);
  }, [continuingId]);

  const hoop = hoopId ? (hoopPresets.find((h) => h.id === hoopId) ?? null) : null;

  const dragRef = useRef<DragState>({
    kind: 'none',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    originDesign: { x: 0, y: 0 },
    objectId: null,
    shapeStart: null,
    node: null,
  });

  // --- painting ------------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (
      canvas.width !== Math.floor(rect.width * dpr) ||
      canvas.height !== Math.floor(rect.height * dpr)
    ) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Drawing happens in CSS pixels; the backing store is scaled for sharpness.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const store = useDesignStore.getState();
    // Both branches below assign, so an initializer would be dead.
    let stitches: Stitch[] | null;
    try {
      const compiled = store.getCompiled();
      stitches = compiled.sequence.stitches;
    } catch {
      // A compile failure must not blank the editor - the outlines are still
      // editable, and the error surfaces in the status bar instead.
      stitches = null;
    }

    const playback = usePlaybackStore.getState();
    const total = stitches?.length ?? 0;
    // Playback does not own the sequence, so the canvas reports its length.
    // Guarded by the comparison: `set` always notifies, and an unconditional
    // call here would repaint forever.
    if (playback.totalHint !== total) playback.setTotal(total);

    // Node Edit shows handles for the selected object; with nothing selected
    // there is no object to edit, so the handles are simply not drawn.
    const nodeEditTarget =
      tool === 'nodeEdit' && selection.length === 1
        ? { objectId: selection[0]!, nodes: editNodes }
        : null;

    const options: RenderOptions = {
      view: viewRef.current,
      width: rect.width,
      height: rect.height,
      designWidth,
      designHeight,
      hoop,
      objects,
      palette,
      stitches,
      selection,
      showGrid,
      showRulers,
      showUnderlay,
      showStitches: true,
      showOutlines: true,
      render3d: preview3d,
      capWrap: capWrap.enabled ? capWrap : null,
      capCenterX: hoop ? hoop.width / 2 : designWidth / 2,
      gridSize,
      gridMajorSize,
      // Outside playback `active` is false and the full sequence shows.
      stitchLimit: playback.active ? playback.position : undefined,
      nodeEdit: nodeEditTarget,
    };

    render(ctx, options);

    // Snap marker: a ring exactly where the point will land. It is painted
    // after the design but before the in-progress outline so the draft line
    // can be read through it.
    const snap = snapRef.current;
    if (snap) {
      const view = viewRef.current;
      ctx.save();
      ctx.strokeStyle = snap.kind === 'node' ? '#ffd166' : '#7cc4ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(
        snap.x * view.scale + view.offsetX,
        snap.y * view.scale + view.offsetY,
        5,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    // In-progress outline for the active drawing tool.
    if (draft.length > 0) {
      const view = viewRef.current;
      ctx.save();
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const first = draft[0]!;
      ctx.moveTo(first.x * view.scale + view.offsetX, first.y * view.scale + view.offsetY);
      for (let i = 1; i < draft.length; i++) {
        const p = draft[i]!;
        ctx.lineTo(p.x * view.scale + view.offsetX, p.y * view.scale + view.offsetY);
      }
      if (cursorDesign) {
        ctx.lineTo(
          cursorDesign.x * view.scale + view.offsetX,
          cursorDesign.y * view.scale + view.offsetY,
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [
    objects,
    palette,
    designWidth,
    designHeight,
    hoop,
    selection,
    showGrid,
    showRulers,
    showUnderlay,
    preview3d,
    capWrap,
    gridSize,
    gridMajorSize,
    draft,
    cursorDesign,
    tool,
    editNodes,
  ]);

  /** Schedule exactly one paint per animation frame. */
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [paint]);

  useEffect(() => {
    schedule();
  }, [schedule, rev]);

  // Repaint whenever the playback counter moves. While playing, `tick` below
  // moves it once per frame, so this is the single repaint driver.
  useEffect(() => {
    schedule();
  }, [schedule, playbackPosition, playbackActive]);

  // Playback loop.
  const playbackPlaying = usePlaybackStore((s) => s.playing);
  useEffect(() => {
    if (!playbackPlaying) return;

    let raf = 0;
    let last = performance.now();

    const step = (now: number): void => {
      const dtMs = Math.min(250, now - last);
      last = now;
      usePlaybackStore.getState().tick(dtMs, usePlaybackStore.getState().totalHint);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playbackPlaying]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const observer = new ResizeObserver(() => schedule());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [schedule]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Fit the view once the canvas has real dimensions.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    viewRef.current = fitView(designWidth, designHeight, rect.width, rect.height);
    fittedRef.current = true;
    schedule();
  }, [designWidth, designHeight, schedule]);

  // --- helpers -------------------------------------------------------------

  const localPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const toolDraws = (t: Tool): boolean =>
    t === 'inputA' || t === 'complexFill' || t === 'run' || t === 'bean' || t === 'polyline';

  /**
   * Where a point should really land.
   *
   * Object snapping wins over the grid: the grid is a guide, an existing vertex
   * is a fact. The snap marker is kept in a ref and painted with the same
   * frame as the draft, so aiming does not add a React render per pixel.
   */
  const applySnap = useCallback((design: Point, excludeId: string | null = null): Point => {
    const settings = referenceStore.getState().settings;
    if (settings?.snapToObjects) {
      const hit = snapToObjects(design, useDesignStore.getState().design.objects, {
        scale: viewRef.current.scale,
        excludeId,
      });
      if (hit) {
        snapRef.current = { x: hit.x, y: hit.y, kind: hit.kind };
        return { x: hit.x, y: hit.y };
      }
    }
    snapRef.current = null;
    return settings?.snapToGrid ? snapToGrid(design, settings.gridSize) : design;
  }, []);

  /** Close a draft outline into a real object. */
  const commitDraft = useCallback(() => {
    const store = useDesignStore.getState();
    const activeTool = store.tool;
    const pts = draft;
    const continuing = store.continuingId
      ? (store.design.objects.find((o) => o.id === store.continuingId) ?? null)
      : null;

    // A closed shape needs a triangle to enclose area; a resumed run only
    // needs its two ends. Everything else keeps the old two-point floor.
    const minPoints =
      continuing?.type === 'run' || continuing?.type === 'bean' ? 2 : toolDraws(activeTool) ? 3 : 2;

    if (pts.length < minPoints) {
      setDraft([]);
      // A resume that cannot be finished must not leave the toolbar stuck in
      // resume mode with no draft on screen.
      if (continuing) store.cancelContinueDigitizing();
      return;
    }

    if (continuing) {
      // Only the outer ring is resumed; holes and any other rings are kept
      // exactly as they were. The object id, thread and parameters survive,
      // which is the whole point of continuing instead of redrawing.
      store.replacePath(continuing.id, [pts, ...continuing.path.rings.slice(1)]);
      store.setTool('select');
      setDraft([]);
      return;
    }

    const type =
      activeTool === 'inputA' || activeTool === 'polyline'
        ? 'column'
        : activeTool === 'run'
          ? 'run'
          : activeTool === 'bean'
            ? 'bean'
            : 'fill';

    const ring = [...pts];
    // The "default stitch type" preference decides what a newly drawn complex
    // fill starts as; it is read here, at the moment the shape is committed,
    // so a change in Preferences applies to the very next shape drawn.
    const preferred =
      type === 'fill' ? referenceStore.getState().settings?.defaultStitchType : undefined;
    const obj = createObject(type, [ring], 0, store.design.objects.length, preferred);
    store.addObject(obj);
    store.setTool('select');
    setDraft([]);
  }, [draft]);

  // --- pointer events ------------------------------------------------------

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);

    const screen = localPoint(event);
    const design = toDesign(screen.x, screen.y, viewRef.current);
    const store = useDesignStore.getState();

    // Middle button or space+left always pans, whatever tool is active.
    const panning = event.button === 1 || store.tool === 'pan';

    dragRef.current = {
      kind: panning ? 'pan' : 'none',
      startX: screen.x,
      startY: screen.y,
      lastX: screen.x,
      lastY: screen.y,
      moved: false,
      originDesign: design,
      objectId: null,
      shapeStart: null,
      node: null,
    };

    if (panning) return;

    // An armed entry/exit placement takes the click before anything else:
    // the user has already chosen what to place and where the object is, so
    // the click's only job is to say WHERE on the design the needle should
    // start (or stop). Placing it on the nearest path node would be second
    // guessing - a hand-set point is allowed to sit anywhere inside.
    if (store.pendingEntryExit) {
      event.preventDefault();
      store.placeEntryExit(design);
      return;
    }

    if (toolDraws(store.tool)) {
      setDraft((prev) => [...prev, applySnap(design)]);
      return;
    }

    if (store.tool === 'rectangle' || store.tool === 'circle') {
      dragRef.current.kind = 'shape';
      dragRef.current.shapeStart = applySnap(design);
      return;
    }

    // Lettering is placed by a single click: the click is the text's
    // top-left corner, and the words themselves are edited in the right
    // panel. Nothing needs dragging, so this returns immediately rather
    // than arming a drag that would never complete.
    if (store.tool === 'lettering') {
      const anchor = applySnap(design);
      const obj = createLettering(
        { x: anchor.x, y: anchor.y },
        {},
        store.design.objects.length === 0
          ? 0
          : store.design.objects[store.design.objects.length - 1]!.colorIndex,
        store.design.objects.length,
      );
      store.addObject(obj);
      // Drop back to Select so the new object is selected and can be moved
      // or edited straight away; leaving Text armed would place a second
      // copy on the next stray click.
      store.setTool('select');
      return;
    }

    // Node Edit: reshape the selected object's outline by dragging its
    // points. Only one object is edited at a time, so with nothing (or more
    // than one) selected there is no path to show - the click falls through
    // to the normal selection below, which is how the user picks what to
    // edit in the first place.
    if (store.tool === 'nodeEdit' && store.selection.length === 1) {
      const obj = store.design.objects.find((o) => o.id === store.selection[0]);
      if (!obj) return;

      // A locked or lettering object has no editable path: lettering is
      // generated from its text, so its nodes would be stale geometry the
      // moment they were drawn. Refuse rather than edit something the
      // engine will silently overwrite on the next compile.
      if (obj.locked || obj.type === 'lettering') return;

      const node = hitTestNode(obj, design, viewRef.current);
      if (node) {
        // Toggle the node out of the selection when it is already in, so a
        // second click on a highlighted handle clears it rather than
        // re-arming a drag the user meant to cancel.
        const already = editNodes.some((n) => n.ring === node.ring && n.index === node.index);
        const next = event.shiftKey
          ? already
            ? editNodes.filter((n) => !(n.ring === node.ring && n.index === node.index))
            : [...editNodes, node]
          : already && editNodes.length === 1
            ? []
            : [node];
        setEditNodes(next);

        if (next.some((n) => n.ring === node.ring && n.index === node.index)) {
          // One snapshot for the whole drag: without it, undo would step
          // back a single pixel at a time.
          store.beginGesture();
          dragRef.current.kind = 'node';
          dragRef.current.objectId = obj.id;
          dragRef.current.node = node;
        }
        return;
      }

      // Not on a handle: if the click is on an edge, insert a node there.
      // This is how an outline gains detail without first hunting for a
      // vertex to pull apart.
      const segment = hitTestSegment(obj, design, viewRef.current);
      if (segment) {
        store.beginGesture();
        store.insertNode(obj.id, segment.ring, segment.afterIndex, design);
        setEditNodes([{ ring: segment.ring, index: segment.afterIndex + 1 }]);
        return;
      }

      // Clicked empty space: clear the node selection so the next drag
      // starts fresh, but keep the object selected.
      setEditNodes([]);
      return;
    }

    // Select tool: hit test topmost first.
    const hit = hitTest(store.design.objects, design, viewRef.current);
    if (hit) {
      // A grouped object is selected as a unit: clicking one member takes the
      // whole group, because a stitched emblem sews as one piece and moving
      // half of it would tear the design apart.
      const group = hit.groupId
        ? store.design.objects.filter((o) => o.groupId === hit.groupId).map((o) => o.id)
        : [hit.id];
      if (event.shiftKey) {
        for (const id of group) store.toggleSelection(id);
      } else if (!group.every((id) => store.selection.includes(id))) {
        store.setSelection(group);
      }
      dragRef.current.kind = 'move';
      dragRef.current.objectId = hit.id;
    } else if (!event.shiftKey) {
      store.clearSelection();
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const screen = localPoint(event);
    const design = toDesign(screen.x, screen.y, viewRef.current);
    const drawing = toolDraws(useDesignStore.getState().tool);
    const snapped = drawing ? applySnap(design) : design;
    setCursorDesign(drawing ? snapped : null);

    const drag = dragRef.current;
    const dx = screen.x - drag.lastX;
    const dy = screen.y - drag.lastY;

    if (!drag.moved) {
      const dist = Math.hypot(screen.x - drag.startX, screen.y - drag.startY);
      if (dist > DRAG_THRESHOLD_PX) drag.moved = true;
    }

    if (drag.kind === 'pan') {
      viewRef.current = {
        ...viewRef.current,
        offsetX: viewRef.current.offsetX + dx,
        offsetY: viewRef.current.offsetY + dy,
      };
      schedule();
    } else if (drag.kind === 'move' && drag.moved && drag.objectId) {
      // Snap to the grid when enabled - applied to the delta so the shape
      // does not jump on the first pixel of movement.
      const settings = referenceStore.getState().settings;
      let snapDx = dx / viewRef.current.scale;
      let snapDy = dy / viewRef.current.scale;

      if (settings?.snapToGrid || settings?.snapToObjects) {
        const total = useDesignStore.getState();
        const obj = total.design.objects.find((o) => o.id === drag.objectId);
        if (obj) {
          const nodes = obj.path.rings.flat();
          const originX = nodes[0]?.x ?? 0;
          const originY = nodes[0]?.y ?? 0;
          const target = applySnap({ x: originX + snapDx, y: originY + snapDy }, drag.objectId);
          snapDx = target.x - originX;
          snapDy = target.y - originY;
        }
      }

      useDesignStore.getState().moveSelected(snapDx, snapDy, { history: false });
    } else if (drag.kind === 'node' && drag.moved && drag.objectId && drag.node) {
      // Dragging a node moves it to the cursor's design position. Taking the
      // position straight from the cursor (rather than accumulating deltas)
      // means a node cannot drift away from the pointer when the pointer
      // events are coalesced or the frame rate dips.
      const settings = referenceStore.getState().settings;
      let targetX = design.x;
      let targetY = design.y;

      if (settings?.snapToGrid || settings?.snapToObjects) {
        const target = applySnap(design, drag.objectId);
        targetX = target.x;
        targetY = target.y;
      }

      useDesignStore
        .getState()
        .moveNode(drag.objectId, drag.node.ring, drag.node.index, targetX, targetY);
    } else if (drag.kind === 'shape') {
      // Shape preview is driven by cursorDesign on the next paint, snapped so
      // the preview corner is the corner that will actually be committed.
      setCursorDesign(applySnap(design));
      schedule();
    }

    drag.lastX = screen.x;
    drag.lastY = screen.y;

    if (drag.kind === 'shape' && drag.shapeStart) schedule();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(event.pointerId);

    const drag = dragRef.current;
    const store = useDesignStore.getState();

    if (drag.kind === 'shape' && drag.shapeStart && drag.moved) {
      const rawEnd = toDesign(localPoint(event).x, localPoint(event).y, viewRef.current);
      const end = applySnap(rawEnd);
      const start = drag.shapeStart;

      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);

      if (w > 0.5 && h > 0.5) {
        const ring =
          store.tool === 'rectangle'
            ? rectangleRing(x, y, w, h)
            : circleRing(x + w / 2, y + h / 2, Math.min(w, h) / 2);
        // Same rule as the polyline tools: the "default stitch type"
        // preference decides what a freshly drawn complex fill is sewn as.
        const preferred = referenceStore.getState().settings?.defaultStitchType;
        store.addObject(createObject('fill', [ring], 0, store.design.objects.length, preferred));
        store.setTool('select');
      }
    }

    drag.kind = 'none';
    drag.shapeStart = null;
    drag.objectId = null;
    drag.node = null;
    if (snapRef.current) {
      snapRef.current = null;
      schedule();
    }
  };

  const onDoubleClick = (): void => {
    if (toolDraws(useDesignStore.getState().tool)) commitDraft();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    // ctrl/cmd+wheel zooms (trackpad pinch arrives the same way); plain wheel
    // pans vertically so long designs remain navigable without a modifier.
    const screen = localPoint(event);

    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      viewRef.current = zoomAt(viewRef.current, factor, screen.x, screen.y);
    } else {
      viewRef.current = {
        ...viewRef.current,
        offsetX: viewRef.current.offsetX - event.deltaX,
        offsetY: viewRef.current.offsetY - event.deltaY,
      };
    }

    event.preventDefault();
    schedule();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const store = useDesignStore.getState();
      const key = event.key;
      // Ctrl/Cmd/Alt combos: only the ones this editor owns are intercepted,
      // everything else is left to the browser.
      const modified = event.ctrlKey || event.metaKey || event.altKey;

      if (modified) {
        if (key === 'z' || key === 'Z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          return;
        }
        if (key === 'y' || key === 'Y') {
          event.preventDefault();
          store.redo();
          return;
        }
        if (key === 'd' || key === 'D') {
          event.preventDefault();
          store.duplicateSelected();
          return;
        }
        if (key === 'g' || key === 'G') {
          // Ctrl+Shift+G breaks a group apart; Ctrl+G makes one - the same
          // pair every vector editor uses, so it lands under the fingers.
          event.preventDefault();
          if (event.shiftKey) store.ungroupSelected();
          else store.groupSelected();
          return;
        }
        return;
      }

      if (key === 'Escape') {
        // Resuming is a mode of its own: Escape leaves the object exactly as
        // it was and keeps it selected, rather than clearing the selection
        // that the resume was started from.
        if (store.continuingId) {
          store.cancelContinueDigitizing();
          setDraft([]);
          return;
        }
        // Cancelling a pending entry/exit placement should not also throw
        // away the selection the user picked it for.
        if (store.pendingEntryExit) {
          store.cancelEntryExit();
          return;
        }
        setDraft([]);
        store.clearSelection();
        if (store.tool !== 'select') store.setTool('select');
        return;
      }

      // Tool shortcuts, matching the labels shown in the toolbar.
      if (key === 'v' || key === 'V') {
        store.setTool('select');
        return;
      }
      if (key === 'n' || key === 'N') {
        store.setTool('nodeEdit');
        return;
      }
      if (key === 'h' || key === 'H') {
        store.setTool('pan');
        return;
      }

      if ((key === 'Enter' || key === ' ') && toolDraws(store.tool)) {
        event.preventDefault();
        commitDraft();
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        // With nodes selected under Node Edit, the keys delete points rather
        // than the whole object: that is the whole point of the mode, and
        // deleting the object from here would be a surprising way to lose
        // work the user was carefully reshaping.
        if (store.tool === 'nodeEdit' && editNodes.length > 0 && store.selection.length === 1) {
          event.preventDefault();
          const byRing = new Map<number, number[]>();
          for (const n of editNodes) {
            const list = byRing.get(n.ring) ?? [];
            list.push(n.index);
            byRing.set(n.ring, list);
          }
          const objectId = store.selection[0]!;
          store.beginGesture();
          for (const [ring, indices] of byRing) {
            store.deleteNodes(objectId, ring, indices);
          }
          setEditNodes([]);
          return;
        }

        if (store.selection.length > 0) {
          event.preventDefault();
          store.removeSelected();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commitDraft, editNodes]);

  const cursor = armed
    ? 'crosshair'
    : tool === 'pan'
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair';

  return (
    <div ref={wrapRef} className="editor-canvas-wrap" data-testid="canvas-wrap">
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        className="editor-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {draft.length > 0 && (
        <div className="canvas-hint">
          {draft.length} point{draft.length === 1 ? '' : 's'} - double-click or Enter to finish, Esc
          to cancel
        </div>
      )}
      {armed && (
        <div className="canvas-hint" data-testid="entryexit-hint">
          Click to place the {armed === 'entry' ? 'entry' : 'exit'} point - Esc to cancel
        </div>
      )}
      <div className="canvas-coords" data-testid="cursor-coords">
        {cursorDesign ? `${cursorDesign.x.toFixed(1)}, ${cursorDesign.y.toFixed(1)} mm` : '\u00a0'}
      </div>
    </div>
  );
}
