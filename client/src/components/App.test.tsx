/**
 * Application-level tests.
 *
 * These render the real `<App />` - real components, real stores, real engine
 * - against a stubbed HTTP layer. They exist to catch the class of failure
 * unit tests cannot: something that is individually correct but does not mount,
 * does not wire up, or does not update when the state underneath changes.
 *
 * What they do NOT prove is pixel output; see `canvas/render.test.ts` for how
 * drawing is observed and why that stops short of asserting pixels.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeDst, type LetteringSpec, type Stitch } from '@threadworks/engine';
import { App } from '../App.js';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { usePlaybackStore } from '../store/playbackStore.js';
import { createObject, rectangleRing } from '../model/defaults.js';

// --- fixtures ---------------------------------------------------------------

const HOOPS = {
  items: [
    {
      id: 'hoop-180x130',
      name: '180 x 130 mm',
      builtin: true,
      data: { width: 180, height: 130, shape: 'rect', safeMargin: 5 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'hoop-100x100',
      name: '100 x 100 mm',
      builtin: true,
      data: { width: 100, height: 100, shape: 'rect', safeMargin: 4 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 2,
  offset: 0,
  limit: 50,
};

const PALETTES = {
  items: [
    {
      id: 'palette-basic',
      name: 'Basic 18',
      builtin: true,
      data: [
        { id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' },
        { id: 'c2', code: '1002', name: 'Blue', hex: '#003DA5' },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  offset: 0,
  limit: 50,
};

const PRESETS = { items: [], total: 0, offset: 0, limit: 50 };

/**
 * A motif library holding one shape.
 *
 * One entry is enough: it proves a saved shape reaches the picker alongside
 * the built-ins and that picking it carries the shape into the design, which
 * is the whole point of the library. A second would only repeat the same path.
 */
const MOTIFS = {
  items: [
    {
      id: 'motif-crown',
      name: 'Crown',
      builtin: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        points: [
          { x: -0.5, y: -0.5 },
          { x: 0.5, y: -0.5 },
          { x: 0.5, y: 0.2 },
          { x: 0, y: -0.1 },
          { x: -0.5, y: 0.2 },
        ],
      },
    },
  ],
  total: 1,
  offset: 0,
  limit: 50,
};

/** What the motif library currently holds; tests replace it to simulate edits. */
let motifLibrary = MOTIFS;

const SETTINGS = {
  units: 'mm',
  defaultHoopId: null,
  defaultStitchType: 'tatami',
  autosaveIntervalMs: 30_000,
  undoDepth: 60,
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

const HEALTH = {
  status: 'ok',
  name: 'ThreadWorks Studio',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 1,
  database: 'connected',
  databaseMode: 'local',
  serverTime: '2026-01-01T00:00:00.000Z',
};

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown };

/** Overridden per test when the case needs a specific health response. */
let handleHealth: Handler | null = null;

/** Default routing. Individual tests override `handleProject`. */
function route(url: string, init?: RequestInit): { status: number; body?: unknown } {
  if (url.startsWith('/api/health'))
    return handleHealth?.(url, init) ?? { status: 200, body: HEALTH };
  if (url.startsWith('/api/hoops')) return { status: 200, body: HOOPS };
  if (url.startsWith('/api/palettes')) return { status: 200, body: PALETTES };
  if (url.startsWith('/api/presets')) return { status: 200, body: PRESETS };
  if (url.startsWith('/api/motifs')) {
    // Written shapes are posted and renamed through this route, so the list
    // has to reflect what was asked for rather than a frozen fixture.
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        name: string;
        data: { points: { x: number; y: number }[] };
      };
      motifLibrary = {
        ...motifLibrary,
        items: [
          ...motifLibrary.items,
          {
            id: `motif-${body.name}`,
            name: body.name,
            builtin: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            data: body.data,
          },
        ],
        total: motifLibrary.total + 1,
      };
      return { status: 201, body: motifLibrary.items[motifLibrary.items.length - 1] };
    }
    if (init?.method === 'DELETE') {
      const id = url.slice(url.lastIndexOf('/') + 1);
      motifLibrary = {
        ...motifLibrary,
        items: motifLibrary.items.filter((m) => m.id !== id),
        total: motifLibrary.items.filter((m) => m.id !== id).length,
      };
      return { status: 204 };
    }
    return { status: 200, body: motifLibrary };
  }
  if (url.startsWith('/api/settings')) {
    return handleSettings?.(url, init) ?? { status: 200, body: SETTINGS };
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no route' } } };
}

/** Overridden per test when the case needs a specific project response. */
let handleProject: Handler | null = null;

/** Overridden per test when the case needs a specific settings response. */
let handleSettings: Handler | null = null;

function projectRoute(url: string, init?: RequestInit): { status: number; body?: unknown } | null {
  if (!/^\/api\/projects(\/|\?|$)/.test(url)) return null;
  if (!handleProject)
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no project' } } };
  return handleProject(url, init);
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const result = projectRoute(url, init) ?? route(url, init);
      const text = result.body === undefined ? '' : JSON.stringify(result.body);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        statusText: String(result.status),
        text: async () => text,
        json: async () => JSON.parse(text) as unknown,
      } as unknown as Response;
    }),
  );
}

/**
 * Dispatch a pointer-shaped event.
 *
 * `fireEvent.pointerDown(canvas, { clientX, button, ... })` silently drops the
 * coordinates in jsdom: jsdom has no `PointerEvent`, so Testing Library falls
 * back to `new Event(type, init)`, whose constructor only honours the standard
 * `Event` fields. The result is an event where `clientX` is `undefined`, which
 * turns into `NaN` in the canvas maths - the handler runs, but every shape it
 * builds is invalid and no object appears. That failure mode is silent and
 * confusing, so a real `MouseEvent` is constructed instead: it *does* accept
 * coordinates, and React reads the same properties off it either way.
 */
function pointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  button = 0,
  shiftKey = false,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button,
    shiftKey,
    // Down and move report a pressed button; up reports none.
    buttons: type === 'pointerup' ? 0 : 1,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

/**
 * Draw a rectangle by dragging on the canvas.
 *
 * Coordinates are in CSS pixels; the mounted view is fitted to an 800x600
 * box (see the `getBoundingClientRect` stub in `test/setup.ts`), so a drag
 * from (100,100) to (300,300) lands comfortably inside the 180x130 field.
 */
function dragRectangle(from = { x: 100, y: 100 }, to = { x: 300, y: 300 }): void {
  fireEvent.click(screen.getByTestId('tool-rectangle'));
  const canvas = screen.getByTestId('editor-canvas');

  pointer(canvas, 'pointerdown', from.x, from.y, 0);
  pointer(canvas, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, 0);
  pointer(canvas, 'pointerup', to.x, to.y, 0);
}

// --- setup ------------------------------------------------------------------

/**
 * Captured once so `afterEach` can put the real implementations back; jsdom's
 * originals are not useful to the tests, but leaving fakes installed would
 * make failures in later files hard to explain.
 */
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const originalPrompt = window.prompt;
const originalConfirm = window.confirm;

let anchorClick: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handleHealth = null;
  handleProject = null;
  handleSettings = null;
  // A test that writes to the motif library must not leave its shape behind
  // for the next one; the picker would then offer a shape nobody seeded.
  motifLibrary = MOTIFS;
  stubFetch();

  // jsdom does not implement dialogs; the editor uses them for the design
  // name on first save and for discarding on New.
  window.prompt = vi.fn(() => 'Smoke Design');
  window.confirm = vi.fn(() => true);
  // Anchors are created and clicked for downloads; jsdom would otherwise log
  // an unimplemented-navigation error for each one.
  anchorClick = vi.fn();
  HTMLAnchorElement.prototype.click = anchorClick;

  referenceStore.setState({
    hoops: [],
    palettes: [],
    presets: [],
    motifs: [],
    settings: null,
    server: null,
    status: 'idle',
    error: null,
  });
  usePlaybackStore.setState({ playing: false, position: 0, speed: 1, active: false, totalHint: 0 });
  useDesignStore.getState().newDesign();
});

afterEach(() => {
  cleanup();
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  window.prompt = originalPrompt;
  window.confirm = originalConfirm;
  vi.unstubAllGlobals();
});

// --- tests ------------------------------------------------------------------

describe('application shell', () => {
  it('mounts the whole editor', async () => {
    render(<App />);

    expect(screen.getByText('ThreadWorks Studio')).toBeInTheDocument();
    expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('stitch-count')).toBeInTheDocument();
    expect(screen.getByTestId('stitch-player')).toBeInTheDocument();

    for (const tool of [
      'select',
      'pan',
      'inputA',
      'complexFill',
      'run',
      'bean',
      'rectangle',
      'circle',
    ]) {
      expect(screen.getByTestId(`tool-${tool}`)).toBeInTheDocument();
    }

    // Save must not be permanently disabled at rest.
    expect(screen.getByTestId('save-button')).toBeEnabled();
  });

  it('loads reference data and reports the local database as connected', async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    await waitFor(() => {
      const hoopSelect = screen.getByTestId('hoop-select') as HTMLSelectElement;
      expect(hoopSelect.options.length).toBeGreaterThan(0);
    });

    const hoopSelect = screen.getByTestId('hoop-select') as HTMLSelectElement;
    expect(hoopSelect.value).toBe('hoop-180x130');

    // Reference data is available: no startup warning is shown.
    expect(document.querySelector('.startup-warning')).toBeNull();
  });

  it('labels a hosted Atlas database as cloud', async () => {
    handleHealth = () => ({ status: 200, body: { ...HEALTH, databaseMode: 'remote' } });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Cloud database'),
    );
  });

  it('shows a neutral starting hint while the design is empty', async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    expect(screen.getByTestId('empty-design')).toHaveTextContent(/draw a shape/i);
    expect(screen.queryByTestId('validation-errors')).not.toBeInTheDocument();
  });

  it('shows a warning instead of a blank screen when reference data fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(document.querySelector('.startup-warning')).toHaveTextContent(
        'Reference data could not be loaded',
      ),
    );

    // The editor is still mounted - losing the server must not blank the app.
    expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
  });
});

describe('digitizing through the UI', () => {
  it('draws a rectangle and reports the resulting stitch count', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    expect(screen.getByTestId('stitch-count')).toHaveTextContent('0 stitches');

    dragRectangle();

    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const count = screen.getByTestId('stitch-count').textContent ?? '';
    expect(count).toMatch(/^[1-9][\d,]* stitches$/);

    // A rectangle well inside the hoop should validate cleanly.
    expect(screen.getByTestId('validation-ok')).toBeInTheDocument();
  });

  it('flags a rectangle that leaves the hoop', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // A small square just off the left edge of the field: inside the design
    // space, outside the hoop's 5 mm safe margin. Kept deliberately small -
    // filling the whole viewport would generate hundreds of thousands of
    // stitches and test the time limit rather than the validation rule.
    dragRectangle({ x: -50, y: 100 }, { x: -10, y: 140 });

    await waitFor(() => expect(screen.getByTestId('validation-errors')).toBeInTheDocument());
    expect(screen.getByTestId('validation-errors')).toHaveTextContent(/outside the safe area/i);
  });

  it('starts a new fill at the stitch type the preference asks for', async () => {
    // The preference is read the moment a shape is committed, so it applies to
    // the very next shape drawn. A tool that already means one stitch type -
    // the run tool draws a run - must keep it whatever the preference says.
    handleSettings = () => ({ status: 200, body: { ...SETTINGS, defaultStitchType: 'motif' } });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();

    await waitFor(() => expect(useDesignStore.getState().design.objects).toHaveLength(1));
    const fill = useDesignStore.getState().design.objects[0]!;
    expect(fill.type).toBe('fill');
    expect(fill.params.stitchType).toBe('motif');
    expect(fill.params.fillPattern).toBe('motif');

    // Now the polyline path: three clicks outline a shape, then a double
    // click commits it.
    fireEvent.click(screen.getByTestId('tool-run'));
    const canvas = screen.getByTestId('editor-canvas');
    const outline: [number, number][] = [
      [120, 120],
      [200, 120],
      [220, 180],
    ];
    for (const [x, y] of outline) {
      pointer(canvas, 'pointerdown', x, y, 0);
      pointer(canvas, 'pointerup', x, y, 0);
    }
    fireEvent.doubleClick(canvas);

    await waitFor(() => expect(useDesignStore.getState().design.objects).toHaveLength(2));
    const run = useDesignStore.getState().design.objects[1]!;
    expect(run.type).toBe('run');
    expect(run.params.stitchType).toBe('run');
  });

  it('selects tools from the keyboard', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    const canvas = screen.getByTestId('editor-canvas');
    expect(canvas).toHaveStyle({ cursor: 'default' });

    fireEvent.keyDown(window, { key: 'h' });
    expect(canvas).toHaveStyle({ cursor: 'grab' });

    fireEvent.keyDown(window, { key: 'v' });
    expect(canvas).toHaveStyle({ cursor: 'default' });
  });

  it('zooms the canvas with the plain mouse wheel', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    const canvas = screen.getByTestId('editor-canvas');
    await waitFor(() => expect(Number(canvas.dataset.scale)).toBeGreaterThan(0));
    const before = Number(canvas.dataset.scale);

    // No ctrl/meta: the wheel itself zooms, anchored at the pointer.
    fireEvent.wheel(canvas, { deltaY: -120, clientX: 400, clientY: 300 });

    await waitFor(() => expect(Number(canvas.dataset.scale)).toBeGreaterThan(before));
  });

  it('paints after the StrictMode mount / cleanup / mount cycle', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // A cancelled animation-frame id left in the ref used to make every later
    // schedule() think a paint was already queued, leaving development blank.
    const canvas = screen.getByTestId('editor-canvas');
    await waitFor(() => expect(Number(canvas.dataset.scale)).toBeGreaterThan(0));
  });
});

describe('lettering', () => {
  /** Place lettering with the Text tool by clicking once on the canvas. */
  function placeText(at = { x: 150, y: 150 }): void {
    fireEvent.click(screen.getByTestId('tool-lettering'));
    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', at.x, at.y, 0);
    pointer(canvas, 'pointerup', at.x, at.y, 0);
  }

  it('places a text object on a single click and sews it', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    expect(screen.getByTestId('stitch-count')).toHaveTextContent('0 stitches');

    placeText();

    // The click must produce a real, sewable object straight away: a nonzero
    // stitch count and a clean validation prove the text went through the
    // engine rather than being drawn as decoration.
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    expect(screen.getByTestId('validation-ok')).toBeInTheDocument();

    // The inspector opens on the new object with its text ready to edit.
    expect(screen.getByTestId('lettering-section')).toBeInTheDocument();
    expect(screen.getByTestId('lettering-text')).toHaveValue('TEXT');
  });

  it('falls back to Select after placing, so one click makes one object', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    placeText();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const before = useDesignStore.getState().design.objects.length;
    // A second click with the Text tool still armed would drop another copy;
    // it must not, because the tool disarms itself.
    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', 300, 300, 0);
    pointer(canvas, 'pointerup', 300, 300, 0);

    expect(useDesignStore.getState().design.objects).toHaveLength(before);
  });

  it('resews the letters when the text is edited', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    placeText();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const countOf = (): number =>
      Number((screen.getByTestId('stitch-count').textContent ?? '').replace(/\D/g, ''));

    const shortCount = countOf();

    fireEvent.change(screen.getByTestId('lettering-text'), {
      target: { value: 'HELLO WORLD' },
    });

    // Longer text means more stitches. Waiting rather than reading straight
    // away keeps the test honest about the recompile being asynchronous.
    await waitFor(() => expect(countOf()).toBeGreaterThan(shortCount));
    expect(useDesignStore.getState().design.objects[0]!.name).toContain('HELLO WORLD');
  });

  it('sews nothing and says so while the text is blank', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    placeText();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    fireEvent.change(screen.getByTestId('lettering-text'), { target: { value: '   ' } });

    await waitFor(() => expect(screen.getByTestId('stitch-count')).toHaveTextContent('0 stitches'));
    expect(screen.getByRole('status')).toHaveTextContent(/will not sew anything/i);
  });

  it('changes the sew-out when the size changes', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    placeText();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const countOf = (): number =>
      Number((screen.getByTestId('stitch-count').textContent ?? '').replace(/\D/g, ''));

    const before = countOf();
    fireEvent.change(screen.getByTestId('lettering-height'), { target: { value: '40' } });

    await waitFor(() => expect(countOf()).toBeGreaterThan(before));
  });
});

describe('advanced lettering', () => {
  /** Place text and wait for it to sew; returns the object's id. */
  async function mountWithText(): Promise<string> {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('tool-lettering'));
    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', 150, 150, 0);
    pointer(canvas, 'pointerup', 150, 150, 0);

    await waitFor(() => expect(countOf()).toBeGreaterThan(0));
    return useDesignStore.getState().selection[0]!;
  }

  const countOf = (): number =>
    Number((screen.getByTestId('stitch-count').textContent ?? '').replace(/\D/g, ''));

  /** Needle penetrations only, ignoring the jumps and trims between letters. */
  const sewCountOf = (): number =>
    Number((screen.getByTestId('sew-count').textContent ?? '').replace(/\D/g, ''));

  /** The live lettering spec of the design's only text object. */
  const textSpec = (): LetteringSpec => {
    const object = useDesignStore.getState().design.objects.find((o) => o.type === 'lettering')!;
    return object.lettering!;
  };

  it('resequences the letters without changing the sewn stitch count', async () => {
    await mountWithText();
    const before = sewCountOf();

    fireEvent.change(screen.getByTestId('lettering-order'), { target: { value: 'reverse' } });
    await waitFor(() => expect(textSpec().order).toBe('reverse'));

    // Same strokes, same needle penetrations - only the order changed. The
    // travel between letters may gain a trim (and so the total command count
    // can change), but every glyph is sewn identically.
    expect(sewCountOf()).toBe(before);
  });

  it('composes a monogram and can wrap it in a frame', async () => {
    await mountWithText();

    fireEvent.click(screen.getByTestId('lettering-monogram'));
    await waitFor(() => expect(textSpec().monogram?.enabled).toBe(true));
    const monogramCount = countOf();
    expect(monogramCount).toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId('lettering-monogram-frame'), {
      target: { value: 'oval' },
    });
    await waitFor(() => expect(textSpec().monogram?.frame).toBe('oval'));

    // The frame is real geometry: it adds stitches on top of the initials.
    await waitFor(() => expect(countOf()).toBeGreaterThan(monogramCount));

    fireEvent.click(screen.getByTestId('lettering-monogram-mirror'));
    await waitFor(() => expect(textSpec().monogram?.mirrorSides).toBe(true));
  });

  it('drops a larger letter for team names', async () => {
    await mountWithText();
    const before = countOf();

    fireEvent.click(screen.getByTestId('lettering-drop'));
    await waitFor(() => expect(textSpec().drop?.enabled).toBe(true));
    await waitFor(() => expect(countOf()).toBeGreaterThan(before));

    fireEvent.change(screen.getByTestId('lettering-drop-scale'), { target: { value: '2' } });
    await waitFor(() => expect(textSpec().drop?.scale).toBe(2));
  });

  it('edits the width factor and mirrors from the panel', async () => {
    await mountWithText();

    fireEvent.change(screen.getByTestId('lettering-stretch'), { target: { value: '1.5' } });
    await waitFor(() => expect(textSpec().stretch).toBe(1.5));

    fireEvent.click(screen.getByTestId('lettering-mirror-x'));
    await waitFor(() => expect(textSpec().mirror?.x).toBe(true));

    fireEvent.click(screen.getByTestId('lettering-mirror-y'));
    await waitFor(() => expect(textSpec().mirror?.y).toBe(true));
  });

  it('asks for a shape when text on a path has none to follow', async () => {
    await mountWithText();

    fireEvent.click(screen.getByTestId('lettering-path-enable'));

    expect(screen.getByTestId('lettering-path-message')).toHaveTextContent(/select a shape/i);
    expect(textSpec().onPath ?? null).toBeNull();
  });

  it('can be picked up again by clicking it', async () => {
    const textId = await mountWithText();
    const canvas = screen.getByTestId('editor-canvas');

    // Click empty space well away from the text to deselect it.
    pointer(canvas, 'pointerdown', 750, 570, 0);
    pointer(canvas, 'pointerup', 750, 570, 0);
    await waitFor(() => expect(useDesignStore.getState().selection).toHaveLength(0));

    // Click on the laid-out letters: text has no path rings, so selection
    // works off the box around the glyphs.
    pointer(canvas, 'pointerdown', 155, 155, 0);
    pointer(canvas, 'pointerup', 155, 155, 0);
    await waitFor(() => expect(useDesignStore.getState().selection).toHaveLength(1));
    expect(useDesignStore.getState().selection[0]).toBe(textId);
  });

  it('follows a selected shape as a path and can let it go again', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // A rectangle to follow, then the text that should ride it. The inspector
    // follows the pick order, so listing the text first in the selection
    // keeps the lettering controls up while the shape is selected with it.
    dragRectangle();
    await waitFor(() => expect(useDesignStore.getState().design.objects).toHaveLength(1));
    const rectId = useDesignStore.getState().selection[0]!;

    fireEvent.click(screen.getByTestId('tool-lettering'));
    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', 150, 150, 0);
    pointer(canvas, 'pointerup', 150, 150, 0);
    await waitFor(() => expect(countOf()).toBeGreaterThan(0));
    const textId = useDesignStore.getState().selection[0]!;

    act(() => {
      useDesignStore.setState({ selection: [textId, rectId] });
    });

    fireEvent.click(screen.getByTestId('lettering-path-enable'));
    await waitFor(() => expect(textSpec().onPath).toBeTruthy());

    // A rectangle ring is four points; the path closes the loop with a fifth.
    expect(textSpec().onPath!.points).toHaveLength(5);
    expect(countOf()).toBeGreaterThan(0);

    fireEvent.change(screen.getByTestId('lettering-path-offset'), {
      target: { value: '3' },
    });
    await waitFor(() => expect(textSpec().onPath!.offsetMm).toBe(3));

    fireEvent.click(screen.getByTestId('lettering-path-clear'));
    await waitFor(() => expect(textSpec().onPath ?? null).toBeNull());
  });
});

describe('node editing through the UI', () => {
  /** Draw a rectangle, then switch to Node Edit with it selected. */
  async function startNodeEdit(): Promise<string> {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    fireEvent.keyDown(window, { key: 'n' });
    const id = useDesignStore.getState().selection[0]!;
    // Node Edit keeps the selection it was given, so the object under edit is
    // still the one that was just drawn.
    expect(useDesignStore.getState().tool).toBe('nodeEdit');
    expect(useDesignStore.getState().selection).toEqual([id]);
    return id;
  }

  const ringOf = (id: string) =>
    useDesignStore.getState().design.objects.find((o) => o.id === id)!.path.rings[0]!;

  it('activates from the keyboard and keeps the selection', async () => {
    const id = await startNodeEdit();
    // The rectangle has four corners to edit.
    expect(ringOf(id)).toHaveLength(4);
  });

  it('drags a node on the canvas and reshapes the outline', async () => {
    const id = await startNodeEdit();
    const original = ringOf(id)[0]!;

    const canvas = screen.getByTestId('editor-canvas');
    // The drawn rectangle spans screen (100,100)-(300,300); its top-left node
    // sits at (100,100). Dragging it inward must move that one point.
    pointer(canvas, 'pointerdown', 100, 100, 0);
    pointer(canvas, 'pointermove', 160, 140, 0);
    pointer(canvas, 'pointerup', 160, 140, 0);

    const ring = ringOf(id);
    // The dragged node must actually leave its original position - asserting
    // only that the others stayed would pass even if the click missed the
    // handle entirely and nothing moved at all.
    expect(ring[0]).not.toEqual(original);
    expect(ring[0]!.x).toBeGreaterThan(original.x);
    expect(ring[0]!.y).toBeGreaterThan(original.y);
    // The other three corners must not move: this is a point edit, not a
    // translate of the whole shape.
    expect(ring[1]).toEqual({ x: 65, y: 15 });
    expect(ring[3]).toEqual({ x: 15, y: 65 });
  });

  it('undoes a whole node drag in one step', async () => {
    const id = await startNodeEdit();
    const before = ringOf(id)[0];

    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', 100, 100, 0);
    pointer(canvas, 'pointermove', 140, 130, 0);
    pointer(canvas, 'pointermove', 180, 160, 0);
    pointer(canvas, 'pointerup', 180, 160, 0);

    expect(ringOf(id)[0]).not.toEqual(before);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    // One undo restores the node the drag started from, not the last frame
    // of it - which is what per-pixel history would leave behind.
    expect(ringOf(id)[0]).toEqual(before);
  });

  it('adds a node by clicking an edge', async () => {
    const id = await startNodeEdit();
    const before = ringOf(id).length;

    const canvas = screen.getByTestId('editor-canvas');
    // Midpoint of the rectangle's top edge, between its two top corners.
    pointer(canvas, 'pointerdown', 200, 100, 0);
    pointer(canvas, 'pointerup', 200, 100, 0);

    expect(ringOf(id)).toHaveLength(before + 1);
  });

  it('deletes the selected node with the Delete key', async () => {
    const id = await startNodeEdit();
    const before = ringOf(id).length;

    const canvas = screen.getByTestId('editor-canvas');
    // Select a corner, then delete it.
    pointer(canvas, 'pointerdown', 100, 100, 0);
    pointer(canvas, 'pointerup', 100, 100, 0);
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(ringOf(id)).toHaveLength(before - 1);
  });

  it('leaves the object selected rather than deleting it', async () => {
    const id = await startNodeEdit();

    // Selecting a node and pressing Delete must remove the POINT, not the
    // whole object - losing a shape mid-reshape would be a nasty surprise.
    const canvas = screen.getByTestId('editor-canvas');
    pointer(canvas, 'pointerdown', 100, 100, 0);
    pointer(canvas, 'pointerup', 100, 100, 0);
    fireEvent.keyDown(window, { key: 'Delete' });

    expect(useDesignStore.getState().design.objects.some((o) => o.id === id)).toBe(true);
    expect(useDesignStore.getState().selection).toEqual([id]);
  });
});

describe('auto-hooping through the UI', () => {
  it('reports that an empty design cannot be hooped', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('autohoop-button'));

    expect(screen.getByTestId('autohoop-message')).toHaveTextContent(/no stitches/i);
  });

  it('picks a hoop for a drawn design and says which one', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    const before = useDesignStore.getState().design.hoopId;

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    fireEvent.click(screen.getByTestId('autohoop-button'));

    expect(screen.getByTestId('autohoop-message')).toHaveTextContent(/Hoop set to/i);
    // The store's hoop must have actually moved off the starting frame.
    expect(useDesignStore.getState().design.hoopId).not.toBe(before);
  });
});

describe('colour blending through the UI', () => {
  it('appears only once several objects are selected', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // One object selected: a blend has no partner, so the section stays away.
    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    expect(screen.queryByTestId('blend-section')).not.toBeInTheDocument();

    // A second fill, then both selected: now a blend is meaningful.
    const store = useDesignStore.getState();
    const second = { ...store.design.objects[0]!, id: 'second' };
    act(() => {
      useDesignStore.getState().addObject(second);
      useDesignStore.getState().setSelection([store.design.objects[0]!.id, 'second']);
    });

    expect(screen.getByTestId('blend-section')).toBeInTheDocument();
  });

  it('blends the selection and reports what it did', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const store = useDesignStore.getState();
    const first = store.design.objects[0]!;
    const second = { ...first, id: 'second', colorIndex: 1 };
    act(() => {
      useDesignStore.getState().addObject(second);
      useDesignStore.getState().setSelection([first.id, 'second']);
    });

    const spacingBefore = first.params.spacing;

    fireEvent.click(screen.getByTestId('blend-button'));

    expect(screen.getByTestId('blend-message')).toHaveTextContent(/Blended 2 fills/i);
    // The selected fills must actually have been thinned.
    const after = useDesignStore.getState().design.objects.find((o) => o.id === first.id)!;
    expect(after.params.spacing).toBeCloseTo(spacingBefore * 2, 6);
  });
});

describe('3D foam through the UI', () => {
  it('offers foam only for a satin column, not for a flat fill', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    // A tatami fill has no foam technique behind it, so the section stays away.
    expect(screen.queryByTestId('foam-enabled')).not.toBeInTheDocument();

    // Switch to satin: now a column is exactly what foam is sewn on.
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });
    expect(screen.getByTestId('foam-enabled')).toBeInTheDocument();
  });

  it('toggles foam and shows the thickness control', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });

    const before = useDesignStore.getState().design.objects[0]!.params.foam?.enabled ?? false;
    expect(before).toBe(false);

    fireEvent.click(screen.getByTestId('foam-enabled'));

    const after = useDesignStore.getState().design.objects[0]!.params.foam;
    expect(after?.enabled).toBe(true);
    // Thickness appears once foam is on, since it drives the extra width.
    expect(screen.getByTestId('foam-thickness')).toBeInTheDocument();
    expect(screen.getByTestId('foam-tack')).toBeInTheDocument();
  });

  it('stores the thickness the user types', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });
    fireEvent.click(screen.getByTestId('foam-enabled'));

    fireEvent.change(screen.getByTestId('foam-thickness'), { target: { value: '3.5' } });

    const foam = useDesignStore.getState().design.objects[0]!.params.foam;
    expect(foam?.thicknessMm).toBe(3.5);
    expect(foam?.enabled).toBe(true);
  });

  it('makes the column sew denser, which is the whole point of foam', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });

    const countText = (): number =>
      Number((screen.getByTestId('stitch-count').textContent ?? '').replace(/\D/g, ''));

    const flat = countText();
    fireEvent.click(screen.getByTestId('foam-enabled'));

    await waitFor(() => expect(countText()).toBeGreaterThan(flat));
  });
});

describe('carving stamp through the UI', () => {
  it('offers carve only for a tatami fill, not for satin', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // The rectangle draws as a tatami fill, where a carve belongs.
    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    expect(screen.getByTestId('carve-enabled')).toBeInTheDocument();

    // Satin has no fill to carve; the section stays away.
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });
    expect(screen.queryByTestId('carve-enabled')).not.toBeInTheDocument();
  });

  it('toggles carve and reveals the stamp controls', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    expect(useDesignStore.getState().design.objects[0]!.params.carve?.enabled ?? false).toBe(false);

    fireEvent.click(screen.getByTestId('carve-enabled'));

    const carve = useDesignStore.getState().design.objects[0]!.params.carve;
    expect(carve?.enabled).toBe(true);
    expect(screen.getByTestId('carve-motif-picker')).toBeInTheDocument();
    expect(screen.getByTestId('carve-spacing')).toBeInTheDocument();
    expect(screen.getByTestId('carve-scale')).toBeInTheDocument();
    expect(screen.getByTestId('carve-outline')).toBeInTheDocument();
  });

  it('stores the stamp shape the user picks', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.click(screen.getByTestId('carve-enabled'));

    fireEvent.click(screen.getByTestId('motif-option-star'));

    const carve = useDesignStore.getState().design.objects[0]!.params.carve;
    // A built-in is named rather than carried: the engine owns its geometry,
    // so a saved design picks up fixes to it instead of freezing a copy.
    expect(carve?.pattern).toBe('star');
    expect(carve?.motif).toBeUndefined();
    expect(carve?.enabled).toBe(true);
  });

  it('keeps a chosen stamp when an unrelated stamp control is touched', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.click(screen.getByTestId('carve-enabled'));
    fireEvent.click(screen.getByTestId('motif-option-cross'));

    // Moving the spacing must not throw the shape away: every control merges
    // into the existing carve rather than rebuilding it from its own fields.
    fireEvent.change(screen.getByTestId('carve-spacing'), { target: { value: '9' } });

    const carve = useDesignStore.getState().design.objects[0]!.params.carve;
    expect(carve?.pattern).toBe('cross');
    expect(carve?.spacing).toBe(9);
  });

  it('stores the spacing the user types', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.click(screen.getByTestId('carve-enabled'));

    fireEvent.change(screen.getByTestId('carve-spacing'), { target: { value: '4' } });

    const carve = useDesignStore.getState().design.objects[0]!.params.carve;
    expect(carve?.spacing).toBe(4);
  });

  it('removes fill stitches, which is what carving actually does', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const countText = (): number =>
      Number((screen.getByTestId('sew-count').textContent ?? '').replace(/\D/g, ''));

    const plain = countText();
    fireEvent.click(screen.getByTestId('carve-enabled'));
    // The stamp outline is new thread around every stamp: turn it off so the
    // count measures the fill stitches carving removes rather than the
    // outline it adds. Sewn stitches, not the total: the re-entry after a
    // carved hole becomes a jump, which keeps the command count level.
    fireEvent.click(screen.getByTestId('carve-outline'));

    await waitFor(() => expect(countText()).toBeLessThan(plain));
  });
});

/**
 * The motif library.
 *
 * A motif is just a closed outline, so what is being tested here is not the
 * geometry — the engine tests cover that — but that a shape an operator saved
 * actually reaches the design, and that a shape which could not be sewn is
 * refused at the door rather than accepted and failing on export.
 */
describe('motif library through the UI', () => {
  /** Draw a fill and open the motif picker for it. */
  async function openMotifPicker(): Promise<void> {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    // A motif fill is the direct route to the picker; a carve reaches it the
    // same way once carving is switched on.
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'motif' } });
    await waitFor(() => expect(screen.getByTestId('motif-picker')).toBeInTheDocument());
  }

  it('offers the built-in shapes and any saved in the library', async () => {
    await openMotifPicker();

    // Built-ins ship with the app, so at least one is always on offer.
    expect(screen.getByTestId('motif-option-star')).toBeInTheDocument();
    expect(screen.getByTestId('motif-option-hexagon')).toBeInTheDocument();
    // The library entry seeded by the server is listed with them.
    expect(screen.getByTestId('motif-option-motif-crown')).toBeInTheDocument();
  });

  it('starts on the default motif rather than on nothing', async () => {
    await openMotifPicker();

    expect(useDesignStore.getState().design.objects[0]!.params.motif).toBeUndefined();
    expect(screen.getByTestId('motif-option-star')).toHaveAttribute('aria-selected', 'true');
  });

  it('names a built-in rather than carrying a copy of it', async () => {
    await openMotifPicker();

    fireEvent.click(screen.getByTestId('motif-option-hexagon'));

    const motif = useDesignStore.getState().design.objects[0]!.params.motif;
    expect(motif?.id).toBe('hexagon');
    // No points: the engine owns the built-in's geometry, so a design picks up
    // fixes to it instead of sewing a frozen copy forever.
    expect(motif?.points).toBeUndefined();
  });

  it('carries a library shape so the design survives the library changing', async () => {
    await openMotifPicker();

    fireEvent.click(screen.getByTestId('motif-option-motif-crown'));

    const motif = useDesignStore.getState().design.objects[0]!.params.motif;
    expect(motif?.id).toBe('motif-crown');
    // The shape travels with the id. Without it the design would fall back to
    // the default the moment the library entry was renamed or deleted.
    expect(motif?.points).toHaveLength(5);
  });

  it('opens the library editor from the picker', async () => {
    await openMotifPicker();

    fireEvent.click(screen.getByTestId('motif-edit-library'));

    expect(screen.getByText('Motif library')).toBeInTheDocument();
    // Built-ins are listed too, marked so it is clear they are not deletable.
    // Every built-in row carries the mark, so check the set rather than one.
    expect(screen.getAllByText('built-in').length).toBeGreaterThan(1);
    expect(screen.getByTestId('motif-name')).toBeInTheDocument();
  });

  it('saves a shape drawn on the canvas into the library', async () => {
    await openMotifPicker();
    fireEvent.click(screen.getByTestId('motif-edit-library'));

    // The rectangle just drawn is still selected, so it is what gets captured.
    fireEvent.change(screen.getByTestId('motif-name'), { target: { value: 'Shop badge' } });
    fireEvent.click(screen.getByTestId('motif-add'));

    // It lands as a row in the library, not only in the box it was typed into.
    await waitFor(() => expect(screen.getByTestId('motif-delete-Shop badge')).toBeInTheDocument());

    // It is in the library, and therefore back in the picker as something to
    // choose rather than something to redraw each time.
    fireEvent.click(screen.getByTestId('motif-library-close'));
    await waitFor(() =>
      expect(screen.getByTestId('motif-option-motif-Shop badge')).toBeInTheDocument(),
    );
  });

  it('refuses a shape that crosses itself, and says why', async () => {
    await openMotifPicker();
    fireEvent.click(screen.getByTestId('motif-edit-library'));

    fireEvent.change(screen.getByTestId('motif-name'), { target: { value: 'Bow tie' } });
    fireEvent.change(screen.getByTestId('motif-source'), { target: { value: 'points' } });
    // A bow tie: the first and third edges cross, so the outline would sew a
    // knot rather than a shape.
    fireEvent.change(screen.getByTestId('motif-points'), {
      target: { value: '-5,-5  5,5  5,-5  -5,5' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('motif-problem')).toHaveTextContent(/cross itself/i),
    );
    expect(screen.getByTestId('motif-add')).toBeDisabled();
  });

  it('reads a pasted SVG path', async () => {
    await openMotifPicker();
    fireEvent.click(screen.getByTestId('motif-edit-library'));

    fireEvent.change(screen.getByTestId('motif-name'), { target: { value: 'Pasted diamond' } });
    fireEvent.change(screen.getByTestId('motif-source'), { target: { value: 'path' } });
    fireEvent.change(screen.getByTestId('motif-path'), {
      target: { value: 'M 0 0 L 10 0 L 5 8 Z' },
    });

    fireEvent.click(screen.getByTestId('motif-add'));
    // The row appearing is the proof it was stored, not just typed.
    await waitFor(() =>
      expect(screen.getByTestId('motif-delete-Pasted diamond')).toBeInTheDocument(),
    );
  });

  it('deletes a shape it saved, but leaves the built-ins alone', async () => {
    await openMotifPicker();
    fireEvent.click(screen.getByTestId('motif-edit-library'));

    // The seeded library entry is deletable because it is not a built-in.
    expect(screen.getByTestId('motif-delete-Crown')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('motif-delete-Crown'));

    await waitFor(() => expect(screen.queryByTestId('motif-delete-Crown')).not.toBeInTheDocument());
    // Built-ins stay: they are part of the app, not of the library. The label
    // also appears on the picker behind the dialog, so scope to the list.
    const list = screen.getByTestId('motif-library-list');
    expect(list).toHaveTextContent('Star');
    expect(screen.queryByTestId('motif-delete-Star')).not.toBeInTheDocument();
  });

  it('shows the motif picker only where a motif is sewn', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    // A tatami fill lays plain rows, so there is no motif to choose.
    expect(screen.queryByTestId('motif-picker')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('fill-pattern'), { target: { value: 'motif' } });
    expect(screen.getByTestId('motif-picker')).toBeInTheDocument();

    // Satin columns are made of stitches across the column, not of motifs.
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'satin' } });
    expect(screen.queryByTestId('motif-picker')).not.toBeInTheDocument();
  });

  it('lays every advanced fill pattern as its own texture', async () => {
    // The pattern list is only honest if each entry changes the stitches. This
    // drives the real pipeline - panel to store to engine - and insists every
    // pattern compiles to something different from plain tatami.
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );

    const select = screen.getByTestId('fill-pattern');
    expect(select.querySelectorAll('option').length).toBeGreaterThanOrEqual(18);

    const fillId = useDesignStore.getState().design.objects[0]!.id;
    const tatami = JSON.stringify(useDesignStore.getState().getCompiled().sequence.stitches);

    const patterns = [
      'accordion',
      'florentine',
      'liquid',
      'maze',
      'string',
      'laydown',
      'stipple',
      'cross',
      'shading',
      'hand',
      'jagged',
      'warp',
      'flexiSplit',
    ];
    for (const pattern of patterns) {
      fireEvent.change(select, { target: { value: pattern } });
      const obj = useDesignStore.getState().design.objects.find((o) => o.id === fillId)!;
      expect(obj.params.fillPattern, pattern).toBe(pattern);

      const stitched = JSON.stringify(useDesignStore.getState().getCompiled().sequence.stitches);
      expect(stitched, pattern).not.toBe(tatami);
    }
  });

  it('changes how a motif is laid: fill, run, single or column', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'motif' } });

    const fillId = useDesignStore.getState().design.objects[0]!.id;
    const obj = () => useDesignStore.getState().design.objects.find((o) => o.id === fillId)!;
    const count = () =>
      useDesignStore
        .getState()
        .getCompiled()
        .sequence.stitches.filter((s) => s.command === 'stitch').length;

    // A gridded fill stamps many motifs; one stamp is a single motif.
    const fillCount = count();
    expect(fillCount).toBeGreaterThan(100);

    fireEvent.change(screen.getByTestId('motif-mode'), { target: { value: 'single' } });
    expect(obj().params.motifMode).toBe('single');
    expect(count()).toBeLessThan(fillCount / 5);

    fireEvent.change(screen.getByTestId('motif-mode'), { target: { value: 'run' } });
    expect(obj().params.motifMode).toBe('run');
    expect(count()).toBeGreaterThan(10);

    fireEvent.change(screen.getByTestId('motif-mode'), { target: { value: 'column' } });
    expect(obj().params.motifMode).toBe('column');
    expect(count()).toBeGreaterThan(10);
  });

  it('fades motif size or rotation with the gradient controls', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('stitch-type'), { target: { value: 'motif' } });

    const fillId = useDesignStore.getState().design.objects[0]!.id;
    const obj = () => useDesignStore.getState().design.objects.find((o) => o.id === fillId)!;

    fireEvent.change(screen.getByTestId('motif-gradient-scale-to'), { target: { value: '1.8' } });
    expect(obj().params.motifGradient).toEqual({
      scaleFrom: 1,
      scaleTo: 1.8,
      angleFrom: 0,
      angleTo: 0,
    });

    fireEvent.change(screen.getByTestId('motif-gradient-angle-to'), { target: { value: '45' } });
    expect(obj().params.motifGradient).toEqual({
      scaleFrom: 1,
      scaleTo: 1.8,
      angleFrom: 0,
      angleTo: 45,
    });

    fireEvent.click(screen.getByTestId('motif-gradient-clear'));
    expect(obj().params.motifGradient).toBeNull();
  });

  it('edits the split fill block, break and stagger and resets to the built-in', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('stitch-count')).not.toHaveTextContent('0 stitches'),
    );
    fireEvent.change(screen.getByTestId('fill-pattern'), { target: { value: 'programmedSplit' } });

    const fillId = useDesignStore.getState().design.objects[0]!.id;
    const obj = () => useDesignStore.getState().design.objects.find((o) => o.id === fillId)!;

    // The fields start at the numbers the engine uses when no custom split
    // is stored, so opening the block never changes the sew-out by itself.
    expect(screen.getByTestId('custom-split-length')).toHaveValue(12);
    expect(screen.getByTestId('custom-split-gap')).toHaveValue(1.5);
    expect(screen.getByTestId('custom-split-stagger')).toHaveValue(50);

    fireEvent.change(screen.getByTestId('custom-split-length'), { target: { value: '6' } });
    expect(obj().params.customSplit).toEqual({ segmentLength: 6, gap: 1.5, stagger: 0.5 });

    fireEvent.change(screen.getByTestId('custom-split-stagger'), { target: { value: '25' } });
    expect(obj().params.customSplit).toEqual({ segmentLength: 6, gap: 1.5, stagger: 0.25 });

    fireEvent.click(screen.getByTestId('custom-split-reset'));
    expect(obj().params.customSplit).toBeNull();
  });
});

describe('stitch player', () => {
  it('plays and pauses the sew-out', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() =>
      expect(screen.getByTestId('player-count')).not.toHaveTextContent(/^0 \/ 0$/),
    );

    const player = screen.getByTestId('stitch-player');
    expect(player).toHaveAttribute('data-playing', 'false');

    fireEvent.click(screen.getByTestId('player-toggle'));
    expect(player).toHaveAttribute('data-playing', 'true');

    fireEvent.click(screen.getByTestId('player-toggle'));
    expect(player).toHaveAttribute('data-playing', 'false');

    // Rewinding leaves playback mode entirely rather than parking at 0.
    fireEvent.click(screen.getByTestId('player-toggle'));
    fireEvent.click(screen.getByTestId('player-reset'));
    expect(player).toHaveAttribute('data-playing', 'false');
    expect(screen.getByTestId('player-count')).toHaveTextContent(/^0 \/ /);
  });

  it('cannot play an empty design', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // The scrubber is disabled with nothing to scrub; the counter shows 0/0.
    expect(screen.getByTestId('player-scrub')).toBeDisabled();
    expect(screen.getByTestId('player-count')).toHaveTextContent('0 / 0');
  });
});

describe('export', () => {
  it('refuses an empty design and says why', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('export-dst'));

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveTextContent(/stitches|object/i);
    // Nothing was handed to the browser.
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('exports a DST for a design that validates', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('export-dst'));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Exported .*\.dst$/),
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('exports a PES when that format is chosen', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'pes' } });
    fireEvent.click(screen.getByTestId('export-dst'));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Exported .*\.pes$/),
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('exports an EXP when that format is chosen', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'exp' } });
    fireEvent.click(screen.getByTestId('export-dst'));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Exported .*\.exp$/),
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('exports a JEF when that format is chosen', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'jef' } });
    fireEvent.click(screen.getByTestId('export-dst'));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Exported .*\.jef$/),
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});

describe('multi-hoop export through the UI', () => {
  it('exports a single part for a design that fits', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('export-sections'));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/Exported 1 file/));
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('splits a too-wide design and downloads one file per part', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // Three squares spread well past the 180 mm hoop: the split is required,
    // not optional, so the button must still produce files.
    act(() => {
      const store = useDesignStore.getState();
      store.addObject(createObject('fill', [rectangleRing(10, 20, 50, 30)]));
      store.addObject(createObject('fill', [rectangleRing(200, 20, 50, 30)], 1, 1));
      store.addObject(createObject('fill', [rectangleRing(400, 20, 50, 30)], 2, 2));
    });

    fireEvent.click(screen.getByTestId('export-sections'));

    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/Split into \d+ hooping/),
    );
    const downloads = anchorClick.mock.calls.length;
    expect(downloads).toBeGreaterThan(1);
  });
});

describe('stitch video', () => {
  it('renders a GIF from the top bar', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    dragRectangle();
    await waitFor(() => expect(screen.getByTestId('validation-ok')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('export-movie'));

    // Rendering an eleven-thousand stitch design takes about a second, so the
    // wait here is generous on purpose.
    await waitFor(
      () => expect(screen.getByTestId('toast')).toHaveTextContent(/^Exported .*\.gif$/),
      { timeout: 20_000 },
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('image tracing', () => {
  it('opens the trace dialog from the top bar', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('trace-open'));

    expect(screen.getByTestId('trace-file')).toBeInTheDocument();
    // Nothing to trace until an image is picked.
    expect(screen.getByTestId('trace-apply')).toBeDisabled();
  });

  it('closes again without touching the design', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('trace-open'));
    fireEvent.click(screen.getByLabelText('Close'));

    expect(screen.queryByTestId('trace-file')).not.toBeInTheDocument();
  });

  it('opens the photo stitch dialog with both presets', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('photo-open'));

    expect(screen.getByTestId('photo-file')).toBeInTheDocument();
    expect(screen.getByTestId('photo-preset-colour')).toHaveTextContent('Colour Photo Stitch');
    expect(screen.getByTestId('photo-preset-flash')).toHaveTextContent('Photo Flash');
    // Nothing to stitch until an image is picked.
    expect(screen.getByTestId('photo-apply')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByTestId('photo-file')).not.toBeInTheDocument();
  });
});

describe('machine file import', () => {
  /** A tiny valid DST, so the test exercises the real reader. */
  function dstBytes(): Uint8Array {
    const stitches: Stitch[] = [];
    for (let i = 0; i <= 20; i++) {
      stitches.push({
        x: i,
        y: i % 2,
        command: 'stitch',
        colorIndex: 0,
        objectId: null,
        sequence: i,
      });
    }
    return writeDst(stitches, { name: 'CLIENTLOGO', colorCount: 1 });
  }

  it('opens the import dialog from the top bar', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('import-open'));

    expect(screen.getByTestId('import-file')).toBeInTheDocument();
    // Nothing to save until a file is picked.
    expect(screen.getByTestId('import-save')).toBeDisabled();
  });

  it('reads a DST and offers it back as another format', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('import-open'));
    // `writeDst` declares `Uint8Array` (i.e. `ArrayBufferLike`); TS wants a
    // definite `ArrayBuffer` view for BlobPart. The buffer it allocates is
    // exactly the view, so the cast changes no bytes.
    const file = new File([dstBytes() as BlobPart], 'client-logo.dst', {
      type: 'application/octet-stream',
    });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByTestId('import-summary')).toHaveTextContent(/Tajima DST/),
    );
    const summary = screen.getByTestId('import-summary');
    expect(summary).toHaveTextContent(/CLIENTLOGO/);
    expect(summary).toHaveTextContent(/Colours1/);
    expect(screen.getByTestId('import-save')).toBeEnabled();

    // The file is named after the design's own name, not the file it came in.
    fireEvent.click(screen.getByTestId('import-save'));
    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/^Saved CLIENTLOGO\.dst$/),
    );
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that is not a machine file, and says why', async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('import-open'));
    const file = new File([Uint8Array.from([1, 2, 3, 4, 5])], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/recognises/i)).toBeInTheDocument());
    expect(screen.getByTestId('import-save')).toBeDisabled();
  });
});

describe('saving', () => {
  it('creates a project under the prompted name', async () => {
    handleProject = (url, init) => {
      if (init?.method === 'POST' && url.startsWith('/api/projects')) {
        return {
          status: 201,
          body: {
            id: 'proj-1',
            name: 'Smoke Design',
            version: 0,
            design: {
              units: 'mm',
              width: 180,
              height: 130,
              hoopId: 'hoop-180x130',
              objects: [],
              threadPalette: [],
            },
            summary: {
              objectCount: 0,
              colorCount: 6,
              width: 180,
              height: 130,
              hoopId: 'hoop-180x130',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no' } } };
    };

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // An untouched document is not dirty, so draw something first - otherwise
    // "the dirty marker cleared" would be true before the save ever ran.
    dragRectangle();
    await waitFor(() => expect(document.querySelector('.dirty-dot')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('Saved'));
    expect(window.prompt).toHaveBeenCalledWith('Save design as:', 'Untitled design');

    // The dirty marker clears once the server has accepted the document.
    await waitFor(() => expect(document.querySelector('.dirty-dot')).not.toBeInTheDocument());
    expect(useDesignStore.getState().design.projectId).toBe('proj-1');
    expect(useDesignStore.getState().dirty).toBe(false);
  });

  it('surfaces a conflict instead of overwriting newer work', async () => {
    // First save succeeds, so the design has a version to be stale against.
    let calls = 0;
    handleProject = (url, init) => {
      if (init?.method === 'POST' && url.startsWith('/api/projects')) {
        calls++;
        return {
          status: 201,
          body: {
            id: 'proj-2',
            name: 'Smoke Design',
            version: 0,
            design: {
              units: 'mm',
              width: 180,
              height: 130,
              hoopId: 'hoop-180x130',
              objects: [],
              threadPalette: [],
            },
            summary: {
              objectCount: 0,
              colorCount: 6,
              width: 180,
              height: 130,
              hoopId: 'hoop-180x130',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        };
      }
      if (init?.method === 'PUT') {
        return {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'This project was changed elsewhere. Reload before saving again.',
              details: { expectedVersion: 0, currentVersion: 3 },
            },
          },
        };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no' } } };
    };

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(useDesignStore.getState().design.projectId).toBe('proj-2'));

    // Decline the overwrite: the app must leave the newer copy alone.
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('save-button'));

    // Declining used to produce no feedback at all, which reads as a dead
    // button; the message must say plainly that the changes were not saved.
    await waitFor(() =>
      expect(screen.getByTestId('toast')).toHaveTextContent(/Not saved - the newer copy was kept/),
    );
    expect(window.confirm).toHaveBeenCalledTimes(1);
    // Only the original create reached the server - no PUT was allowed through.
    expect(calls).toBe(1);
    expect(useDesignStore.getState().design.version).toBe(0);
  });

  it('reports a save failure rather than pretending it worked', async () => {
    handleProject = () => ({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Invalid request: design: Required' } },
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent('Local database'),
    );

    // Make the document dirty first: an untouched design is not dirty, and
    // asserting "still dirty after a failed save" against a clean document
    // would pass without exercising anything.
    dragRectangle();
    await waitFor(() => expect(document.querySelector('.dirty-dot')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/Invalid request/));
    // The failure must not be dressed up as success: no id, still dirty.
    expect(useDesignStore.getState().dirty).toBe(true);
    expect(useDesignStore.getState().design.projectId).toBeNull();
  });
});
