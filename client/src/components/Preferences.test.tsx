import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The Preferences dialog, on the one control whose effect reaches past the
 * dialog itself: Undo steps also has to change the history the editor is
 * already holding.
 *
 * Every other preference here is read by whoever needs it at call time, so
 * saving it is the whole story. The undo depth is different - the stack in
 * memory was built under the old number, so a save that succeeded without
 * touching it would leave Preferences describing a history the editor still
 * was not honouring.
 */

import { Preferences } from './Preferences.js';
import { referenceStore } from '../store/referenceStore.js';
import { useDesignStore } from '../store/designStore.js';
import type { AppSettings } from '../api/client.js';

const SETTINGS: AppSettings = {
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

/** Make the fetch stub answer the settings PUT. `fail` simulates a dead API. */
function stubSettingsFetch(fail = false): { put: string[] } {
  const put: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/api/settings') || init?.method !== 'PUT') {
        return json(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
      }

      const patch = JSON.parse(String(init.body)) as Partial<AppSettings>;
      put.push(url);

      if (fail) {
        return json(500, { error: { code: 'SETTINGS_FAILED', message: 'database unavailable' } });
      }
      const saved = { ...referenceStore.getState().settings!, ...patch };
      return json(200, saved);
    }),
  );

  return { put };
}

function json(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response;
}

/** `n` distinct undo entries built from the current document. */
function seedHistory(n: number): void {
  const { design } = useDesignStore.getState();
  useDesignStore.setState({
    past: Array.from({ length: n }, (_, i) => ({
      design: { ...design, name: `step-${i}` },
      selection: [],
    })),
    future: [],
  });
}

beforeEach(() => {
  useDesignStore.getState().newDesign();
  useDesignStore.setState({ past: [], future: [], dirty: false });
  referenceStore.setState({
    hoops: [],
    palettes: [],
    presets: [],
    settings: { ...SETTINGS },
    server: null,
    status: 'idle',
    error: null,
  });
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('undo depth preference', () => {
  it('shows the depth that is in force', () => {
    render(<Preferences onClose={() => undefined} />);

    const input = screen.getByTestId('pref-undo-depth') as HTMLInputElement;
    expect(input.value).toBe('60');
  });

  it('trims the history the editor is already holding when the depth drops', async () => {
    seedHistory(60);
    render(<Preferences onClose={() => undefined} />);

    fireEvent.change(screen.getByTestId('pref-undo-depth'), { target: { value: '10' } });

    // Optimistic write plus the server round trip both have to have landed
    // before the stack can be cut, so this is a wait, not an assertion.
    await waitFor(() => expect(referenceStore.getState().settings?.undoDepth).toBe(10));
    await waitFor(() => expect(useDesignStore.getState().past).toHaveLength(10));

    // Oldest dropped, newest kept: the steps the operator is most likely to
    // go back to are the ones nearest the present.
    const names = useDesignStore.getState().past.map((p) => p.design.name);
    expect(names[0]).toBe('step-50');
    expect(names[names.length - 1]).toBe('step-59');
  });

  it('does not trim anything when the save fails', async () => {
    referenceStore.setState({ settings: { ...SETTINGS } });
    stubSettingsFetch(true);
    seedHistory(60);

    render(<Preferences onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('pref-undo-depth'), { target: { value: '10' } });

    // The rollback message, and a stack still holding every step: a trim
    // driven by a change that was undone would destroy history the setting
    // never actually took.
    await waitFor(() =>
      expect(screen.getByTestId('pref-status')).toHaveTextContent(/Could not save/),
    );
    expect(useDesignStore.getState().past).toHaveLength(60);
    expect(referenceStore.getState().settings?.undoDepth).toBe(60);
  });

  it('clamps a depth outside what the editor accepts', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.change(screen.getByTestId('pref-undo-depth'), { target: { value: '5000' } });

    await waitFor(() => expect(referenceStore.getState().settings?.undoDepth).toBe(500));
    expect((screen.getByTestId('pref-undo-depth') as HTMLInputElement).value).toBe('500');
  });

  it('leaves the document untouched: this is not an edit to the design', async () => {
    seedHistory(5);
    const before = JSON.stringify(useDesignStore.getState().design);
    const rev = useDesignStore.getState().rev;

    render(<Preferences onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('pref-undo-depth'), { target: { value: '40' } });

    await waitFor(() => expect(useDesignStore.getState().past).toHaveLength(5));
    expect(JSON.stringify(useDesignStore.getState().design)).toBe(before);
    expect(useDesignStore.getState().rev).toBe(rev);
    expect(useDesignStore.getState().dirty).toBe(false);
  });
});

describe('default stitch type preference', () => {
  it('offers only the types a complex fill can be sewn as', () => {
    render(<Preferences onClose={() => undefined} />);

    const select = screen.getByTestId('pref-default-stitch-type') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // A fill is an area: satin, run and bean are outline stitches and have no
    // business here, which is exactly why the list is not the panel's list.
    expect(values).toEqual(['tatami', 'contour', 'spiral', 'motif']);
    expect(select.value).toBe('tatami');
  });

  it('saves a change', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.change(screen.getByTestId('pref-default-stitch-type'), {
      target: { value: 'motif' },
    });

    await waitFor(() =>
      expect(referenceStore.getState().settings?.defaultStitchType).toBe('motif'),
    );
  });
});

describe('major and minor grid', () => {
  it('saves the major spacing independently of the minor one', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.change(screen.getByTestId('pref-grid-major'), { target: { value: '40' } });

    await waitFor(() => expect(referenceStore.getState().settings?.gridMajorSize).toBe(40));
    expect(screen.getByTestId('pref-grid-major')).toHaveValue(40);
    // The minor setting is untouched.
    expect(referenceStore.getState().settings?.gridSize).toBe(5);
  });

  it('pushes the major spacing up when the minor passes it', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.change(screen.getByTestId('pref-grid-size'), { target: { value: '30' } });

    await waitFor(() => expect(referenceStore.getState().settings?.gridSize).toBe(30));
    expect(referenceStore.getState().settings?.gridMajorSize).toBe(30);
    expect(screen.getByTestId('pref-grid-major')).toHaveValue(30);
  });
});

describe('snap to objects preference', () => {
  it('saves the checkbox through the API', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('pref-snap-objects'));

    await waitFor(() => expect(referenceStore.getState().settings?.snapToObjects).toBe(true));
    expect(screen.getByTestId('pref-snap-objects')).toBeChecked();
  });
});

describe('lit preview preference', () => {
  it('saves the screen-only 3D toggle through the API', async () => {
    render(<Preferences onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('pref-preview-3d'));

    await waitFor(() => expect(referenceStore.getState().settings?.preview3d).toBe(true));
    expect(screen.getByTestId('pref-preview-3d')).toBeChecked();
  });
});
