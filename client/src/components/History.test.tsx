import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * Design history and recent files, through their actual dialogs.
 *
 * Both features are lists that come back from the database and then have to
 * DO something - open a file, put a snapshot back, drop a stale row - so the
 * interesting behaviour is in the wiring, not the rendering. Each case drives
 * the real component against a stubbed transport and asserts on what reached
 * the store afterwards.
 */

import { ProjectBrowser } from './ProjectBrowser.js';
import { VersionHistory } from './VersionHistory.js';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import type { DesignPayload, ProjectSummary, RecentFile, VersionSummary } from '../api/client.js';

interface Route {
  status: number;
  body?: unknown;
}

/** What each test wants specific endpoints to answer. */
let handlers: { [pattern: string]: (url: string, init?: RequestInit) => Route } = {};

const calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });

      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) return respond(handler(url, init));
      }
      return respond({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'no route' } } });
    }),
  );
}

function respond(route: Route): Response {
  const text = route.body === undefined ? '' : JSON.stringify(route.body);
  return {
    ok: route.status >= 200 && route.status < 300,
    status: route.status,
    statusText: String(route.status),
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  } as unknown as Response;
}

function design(name: string): DesignPayload {
  return {
    units: 'mm',
    width: 180,
    height: 130,
    hoopId: 'hoop-180x130',
    objects: [
      {
        id: 'o1',
        name,
        type: 'fill',
        path: {
          rings: [
            [
              { x: 10, y: 10 },
              { x: 50, y: 10 },
              { x: 50, y: 40 },
              { x: 10, y: 40 },
            ],
          ],
        },
        transform: { x: 0, y: 0 },
        colorIndex: 0,
        params: {
          stitchType: 'tatami',
          angle: 0,
          spacing: 0.4,
          maxStitchLength: 12.1,
          minStitchLength: 0.3,
          pullCompensation: 0.2,
          fillPattern: 'tatami',
          underlay: { type: 'none', spacing: 3, offset: 1, inset: 1 },
          tieIn: { enabled: false, length: 0.4, count: 3 },
          tieOff: { enabled: false, length: 0.4, count: 3 },
        },
        entryExit: { entry: null, exit: null },
        lettering: null,
        order: 0,
        locked: false,
        hidden: false,
        groupId: null,
        warnings: [],
      },
    ],
    threadPalette: [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }],
  };
}

function project(id: string, name: string, version = 3): ProjectSummary {
  const d = design(name);
  return {
    id,
    name,
    version,
    design: d,
    summary: { objectCount: 1, colorCount: 1, width: d.width, height: d.height, hoopId: d.hoopId },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function version(id: string, kind: VersionSummary['kind'], createdAt: string): VersionSummary {
  return {
    id,
    projectId: 'p1',
    projectVersion: 2,
    kind,
    summary: { objectCount: 1, colorCount: 1, width: 180, height: 130, hoopId: 'hoop-180x130' },
    createdAt,
  };
}

const recent: RecentFile = {
  id: 'p1',
  name: 'Client Logo',
  summary: { objectCount: 1, colorCount: 1, width: 180, height: 130, hoopId: 'hoop-180x130' },
  openedAt: '2026-01-03T09:00:00.000Z',
};

const originalConfirm = window.confirm;

beforeEach(() => {
  handlers = {};
  calls.length = 0;
  stubFetch();
  window.confirm = vi.fn(() => true);

  referenceStore.setState({
    hoops: [],
    palettes: [],
    presets: [],
    settings: null,
    server: null,
    status: 'idle',
    error: null,
  });
  useDesignStore.getState().newDesign();
});

afterEach(() => {
  window.confirm = originalConfirm;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('recent files', () => {
  it('lists what was opened and can be opened straight back', async () => {
    handlers['/api/recent'] = () => ({ status: 200, body: { items: [recent], total: 1 } });
    handlers['/api/projects/p1'] = () => ({ status: 200, body: project('p1', 'Client Logo') });

    render(<ProjectBrowser onClose={() => undefined} onOpened={() => undefined} />);

    const section = await screen.findByTestId('recent-files');
    expect(section).toHaveTextContent('Client Logo');

    // The Forget button's accessible name also contains "Client Logo", so the
    // open button is picked out by the accessible name starting with it.
    fireEvent.click(screen.getByRole('button', { name: /^Client Logo/ }));

    await waitFor(() => expect(useDesignStore.getState().design.projectId).toBe('p1'));
    expect(useDesignStore.getState().design.name).toBe('Client Logo');
  });

  it('drops a row whose project has since been deleted, and says so', async () => {
    handlers['/api/recent'] = () => ({ status: 200, body: { items: [recent], total: 1 } });
    handlers['/api/projects/p1'] = () => ({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Project not found' } },
    });

    render(<ProjectBrowser onClose={() => undefined} onOpened={() => undefined} />);
    await screen.findByTestId('recent-files');

    fireEvent.click(screen.getByRole('button', { name: /^Client Logo/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('no longer in the library'),
    );
    // The dead entry is gone rather than sitting there to be clicked again.
    await waitFor(() => expect(screen.queryByTestId('recent-files')).toBeNull());
  });

  it('clears the whole list on request', async () => {
    handlers['/api/recent'] = (url, init) => {
      if (init?.method === 'DELETE') return { status: 204 };
      return { status: 200, body: { items: [recent], total: 1 } };
    };

    render(<ProjectBrowser onClose={() => undefined} onOpened={() => undefined} />);
    await screen.findByTestId('recent-files');

    fireEvent.click(screen.getByTestId('clear-recent'));

    await waitFor(() => expect(screen.queryByTestId('recent-files')).toBeNull());
    expect(calls.some((c) => c.url.includes('/api/recent') && c.init?.method === 'DELETE')).toBe(
      true,
    );
  });

  it('hides recent files while searching, so the results are all from the search', async () => {
    handlers['/api/recent'] = () => ({ status: 200, body: { items: [recent], total: 1 } });
    handlers['/api/projects'] = () => ({
      status: 200,
      body: { items: [], total: 0, offset: 0, limit: 20 },
    });

    render(<ProjectBrowser onClose={() => undefined} onOpened={() => undefined} />);
    await screen.findByTestId('recent-files');

    fireEvent.change(screen.getByTestId('project-search'), { target: { value: 'logo' } });

    await waitFor(() => expect(screen.queryByTestId('recent-files')).toBeNull());
  });

  it('still shows the library when the recent list cannot be read', async () => {
    handlers['/api/recent'] = () => ({
      status: 500,
      body: { error: { code: 'BOOM', message: 'nope' } },
    });
    handlers['/api/projects'] = () => ({
      status: 200,
      body: { items: [project('p9', 'Library')], total: 1, offset: 0, limit: 20 },
    });

    render(<ProjectBrowser onClose={() => undefined} onOpened={() => undefined} />);

    expect(await screen.findByText('Library')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-files')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('version history', () => {
  it('lists checkpoints newest first with their kind', async () => {
    handlers['/api/projects/p1/versions'] = () => ({
      status: 200,
      body: {
        items: [
          version('v3', 'restore', '2026-01-04T00:00:00.000Z'),
          version('v2', 'manual', '2026-01-03T00:00:00.000Z'),
          version('v1', 'auto', '2026-01-02T00:00:00.000Z'),
        ],
        total: 3,
      },
    });

    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );

    const list = await screen.findByTestId('history-list');
    expect(list).toHaveTextContent('Before a restore');
    expect(list).toHaveTextContent('Checkpoint');
    expect(list).toHaveTextContent('Auto save');
  });

  it('restores a snapshot into the store and closes', async () => {
    handlers['/api/projects/p1/versions'] = (url, init) => {
      if (url.endsWith('/versions') && !init?.method) {
        return {
          status: 200,
          body: { items: [version('v1', 'auto', '2026-01-02T00:00:00.000Z')], total: 1 },
        };
      }
      if (url.endsWith('/versions/v1/restore') && init?.method === 'POST') {
        return { status: 200, body: project('p1', 'Logo', 4) };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no route' } } };
    };

    const onClose = vi.fn();
    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={onClose}
        notify={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByText('Restore'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const state = useDesignStore.getState();
    expect(state.design.projectId).toBe('p1');
    expect(state.design.version).toBe(4);
    // The design that came back is the snapshot, not whatever was loaded.
    expect(state.design.objects[0]?.name).toBe('Logo');
    expect(state.dirty).toBe(false);
  });

  it('warns that unsaved work will be discarded before restoring', async () => {
    handlers['/api/projects/p1/versions'] = () => ({
      status: 200,
      body: { items: [version('v1', 'auto', '2026-01-02T00:00:00.000Z')], total: 1 },
    });

    // Make the document dirty without going through the API.
    useDesignStore.setState({ dirty: true });
    // Decline: this case is about what the prompt SAYS, not what happens next.
    window.confirm = vi.fn(() => false);

    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByText('Restore'));

    const prompt = (window.confirm as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(prompt).toContain('UNSAVED changes');
    // And nothing reached the restore endpoint, because the user has not
    // answered yet.
    expect(calls.filter((c) => c.url.includes('/restore'))).toHaveLength(0);
  });

  it('does not restore when the confirmation is declined', async () => {
    handlers['/api/projects/p1/versions'] = () => ({
      status: 200,
      body: { items: [version('v1', 'auto', '2026-01-02T00:00:00.000Z')], total: 1 },
    });
    window.confirm = vi.fn(() => false);

    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByText('Restore'));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/restore'))).toBe(false));
  });

  it('takes a manual checkpoint and refreshes the list', async () => {
    let checked = false;
    handlers['/api/projects/p1/versions'] = (url, init) => {
      if (url.endsWith('/versions') && init?.method === 'POST') {
        checked = true;
        return { status: 201, body: version('v2', 'manual', '2026-01-05T00:00:00.000Z') };
      }
      const items = checked
        ? [version('v2', 'manual', '2026-01-05T00:00:00.000Z')]
        : [version('v1', 'auto', '2026-01-02T00:00:00.000Z')];
      return { status: 200, body: { items, total: items.length } };
    };

    const notify = vi.fn();
    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={notify}
      />,
    );

    const list = await screen.findByTestId('history-list');
    await waitFor(() => expect(list).toHaveTextContent('Auto save'));

    fireEvent.click(screen.getByTestId('history-checkpoint'));

    await waitFor(() => expect(screen.getByTestId('history-list')).toHaveTextContent('Checkpoint'));
    expect(notify).toHaveBeenCalledWith('Checkpoint saved');
  });

  it('forgets a checkpoint only after the user confirms', async () => {
    handlers['/api/projects/p1/versions'] = (url, init) => {
      if (url.includes('/versions/v1') && init?.method === 'DELETE') return { status: 204 };
      return {
        status: 200,
        body: { items: [version('v1', 'auto', '2026-01-02T00:00:00.000Z')], total: 1 },
      };
    };

    window.confirm = vi.fn(() => false);
    const { rerender } = render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Forget this checkpoint'));
    await waitFor(() => expect(calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0));

    // Now agree, and it goes through.
    window.confirm = vi.fn(() => true);
    rerender(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByLabelText('Forget this checkpoint'));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/versions/v1') && c.init?.method === 'DELETE')).toBe(
        true,
      ),
    );
  });

  it('reports a failed history read instead of showing an empty timeline', async () => {
    handlers['/api/projects/p1/versions'] = () => ({
      status: 500,
      body: { error: { code: 'BOOM', message: 'database unavailable' } },
    });

    render(
      <VersionHistory
        projectId="p1"
        projectName="Logo"
        onClose={() => undefined}
        notify={() => undefined}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable');
    // "No checkpoints yet" would be a lie - there might be plenty, we just
    // could not read them - and so would a bare timeline.
    expect(screen.getByTestId('history-list')).toHaveTextContent('could not be loaded');
    expect(screen.getByTestId('history-list')).not.toHaveTextContent('No checkpoints yet');
  });
});
