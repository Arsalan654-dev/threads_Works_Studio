/**
 * Typed API client.
 *
 * Every call funnels through `request()` so a non-2xx response becomes an
 * `ApiError` carrying the server's structured `{ code, message, details }`.
 * Callers therefore branch on `error.code` instead of parsing strings, and a
 * server-side validation failure surfaces as a readable message in the UI
 * rather than an `undefined is not an object`.
 */

import type { EmbroideryObject, ThreadColor } from '@threadworks/engine';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    if (body.details !== undefined) this.details = body.details;
  }

  /** True when the local API could not be reached at all. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

/**
 * API root.
 *
 * Local development uses the Vite proxy, so a bare `/api` stays on one origin.
 * A deployed editor (Vercel) points at the hosted API (Railway) through
 * `VITE_API_URL`; it is a build-time value, so changing it needs a rebuild.
 * The value is the server origin only - `/api` is appended here.
 */
const API_ROOT = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const BASE = `${API_ROOT}/api`;

/**
 * The editable part of a design that crosses the wire.
 *
 * Not the engine's `DesignDocument`: that type also carries `id`, `createdAt`
 * and `version`, which belong to the *project* record rather than to the
 * document inside it. Conflating the two means sending server-managed fields
 * that the API schema (correctly) rejects.
 */
export interface DesignPayload {
  units: 'mm' | 'cm' | 'in';
  width: number;
  height: number;
  hoopId: string | null;
  objects: EmbroideryObject[];
  threadPalette: ThreadColor[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      // Same origin, so credentials are unnecessary; the loopback origin
      // check on the server is what authorises the request.
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch (err) {
    // Network-level failure: the server is not running. Distinguish it from
    // an HTTP error so the UI can say "start the server" instead of showing
    // a blank failure.
    throw new ApiError(0, {
      code: 'SERVER_UNREACHABLE',
      message:
        'Cannot reach the ThreadWorks API. Check that the server is running and that VITE_API_URL points at it.',
      details: err instanceof Error ? err.message : String(err),
    });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = undefined;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const body = payload as { error?: ApiErrorBody } | undefined;
    throw new ApiError(
      response.status,
      body?.error ?? {
        code: 'HTTP_ERROR',
        message: `Request failed with status ${response.status}`,
      },
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * A row in the project library.
 *
 * The design is not included: the list stays small regardless of how large
 * the saved designs are, and the selected project is fetched in full when it
 * is opened. `ProjectSummary` adds the design for that per-project response.
 */
export interface ProjectListItem {
  id: string;
  name: string;
  version: number;
  summary: {
    objectCount: number;
    colorCount: number;
    width: number;
    height: number;
    hoopId: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends ProjectListItem {
  design: DesignPayload;
}

export interface ProjectList {
  items: ProjectListItem[];
  total: number;
  offset: number;
  limit: number;
}

export const projects = {
  list: (params: { search?: string; limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.search) search.set('search', params.search);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.offset !== undefined) search.set('offset', String(params.offset));
    const qs = search.toString();
    return request<ProjectList>(`/projects${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<ProjectSummary>(`/projects/${id}`),

  create: (name: string, design: DesignPayload) =>
    request<ProjectSummary>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, design }),
    }),

  update: (id: string, patch: { name?: string; design?: DesignPayload; expectedVersion: number }) =>
    request<ProjectSummary>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  remove: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Design history and recent files
// ---------------------------------------------------------------------------

export interface VersionSummary {
  id: string;
  projectId: string;
  /** The project's counter at snapshot time - the state this entry represents. */
  projectVersion: number;
  kind: 'auto' | 'manual' | 'restore';
  summary: {
    objectCount: number;
    colorCount: number;
    width: number;
    height: number;
    hoopId: string | null;
  };
  createdAt: string;
}

/** A summary with the design attached, i.e. a snapshot read in full. */
export interface VersionDetail extends VersionSummary {
  design: DesignPayload;
}

export interface VersionList {
  items: VersionSummary[];
  total: number;
}

export interface RecentFile {
  id: string;
  name: string;
  summary: VersionSummary['summary'];
  openedAt: string;
}

export const versions = {
  list: (projectId: string) => request<VersionList>(`/projects/${projectId}/versions`),

  get: (projectId: string, versionId: string) =>
    request<VersionDetail>(`/projects/${projectId}/versions/${versionId}`),

  checkpoint: (projectId: string) =>
    request<VersionDetail>(`/projects/${projectId}/versions`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Replace the project with a snapshot. Returns the updated project. */
  restore: (projectId: string, versionId: string) =>
    request<ProjectSummary>(`/projects/${projectId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),

  remove: (projectId: string, versionId: string) =>
    request<void>(`/projects/${projectId}/versions/${versionId}`, { method: 'DELETE' }),
};

export const recentFiles = {
  list: () => request<{ items: RecentFile[]; total: number }>('/recent'),

  remove: (projectId?: string) =>
    request<void>(projectId ? `/recent/${projectId}` : '/recent', { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface Preset<T> {
  id: string;
  name: string;
  data: T;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export type HoopPreset = Preset<HoopPayload>;
export type PalettePreset = Preset<ThreadColor[]>;

/** Frame geometry as stored in a hoop preset; `id` and `name` live outside. */
export interface HoopPayload {
  width: number;
  height: number;
  shape: 'rect' | 'round' | 'oval';
  safeMargin: number;
}

/**
 * A motif library entry: one closed outline a motif fill repeats or a carve
 * presses in.
 *
 * `points` is stored in a unit box — recentered on its own centre and sized so
 * its longest side is 1 — which is what lets `scale` mean the same thing
 * whichever motif is picked. A shape drawn by hand and a built-in therefore
 * both measure the same once placed.
 */
export interface MotifPayload {
  points: { x: number; y: number }[];
  note?: string;
}

export type MotifPreset = Preset<MotifPayload>;

export interface DigitizingParams {
  stitchType: 'satin' | 'tatami' | 'run' | 'bean' | 'motif' | 'contour' | 'spiral';
  angle: number;
  spacing: number;
  maxStitchLength: number;
  minStitchLength: number;
  pullCompensation: number;
  /** Per-side satin compensation; absent/null means both use the uniform value. */
  separatePullCompensation?: { left: number; right: number } | null;
  fillPattern:
    | 'tatami'
    | 'motif'
    | 'contour'
    | 'spiral'
    | 'programmedSplit'
    | 'accordion'
    | 'florentine'
    | 'liquid'
    | 'maze'
    | 'string'
    | 'laydown'
    | 'stipple'
    | 'cross'
    | 'shading'
    | 'hand'
    | 'jagged'
    | 'warp'
    | 'flexiSplit';
  underlay: {
    type: 'none' | 'centerRun' | 'edgeRun' | 'zigzag' | 'tatami';
    spacing: number;
    offset: number;
    inset: number;
  };
  tieIn: { enabled: boolean; length: number; count: number };
  tieOff: { enabled: boolean; length: number; count: number };
}

export type DigitizingPreset = Preset<DigitizingParams>;

function presetRoutes<T>(route: string) {
  return {
    list: () => request<{ items: Preset<T>[]; total: number }>(`/${route}`),
    get: (id: string) => request<Preset<T>>(`/${route}/${id}`),
    create: (name: string, data: T) =>
      request<Preset<T>>(`/${route}`, { method: 'POST', body: JSON.stringify({ name, data }) }),
    update: (id: string, patch: { name?: string; data?: T }) =>
      request<Preset<T>>(`/${route}/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    remove: (id: string) => request<void>(`/${route}/${id}`, { method: 'DELETE' }),
  };
}

export const hoops = presetRoutes<HoopPreset['data']>('hoops');
export const palettes = presetRoutes<PalettePreset['data']>('palettes');
export const digitizingPresets = presetRoutes<DigitizingParams>('presets');
export const motifs = presetRoutes<MotifPayload>('motifs');

// ---------------------------------------------------------------------------
// Settings and health
// ---------------------------------------------------------------------------

export interface AppSettings {
  units: 'mm' | 'cm' | 'in';
  defaultHoopId: string | null;
  defaultStitchType: DigitizingParams['stitchType'];
  autosaveIntervalMs: number;
  /** How many undo steps the editor keeps (default 60, 5–500). */
  undoDepth: number;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  /** Snap drawing and node drags to nearby object nodes, edges and centres. */
  snapToObjects: boolean;
  /** Spacing of the minor grid in mm. */
  gridSize: number;
  /** Spacing of the major grid in mm; never smaller than `gridSize`. */
  gridMajorSize: number;
  previewUnderlay: boolean;
  stitchSimulationSpeed: number;
  updatedAt: string | null;
}

export const settings = {
  get: () => request<AppSettings>('/settings'),
  update: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

export interface HealthStatus {
  status: 'ok' | 'degraded';
  name: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  database: 'connected' | 'disconnected';
  /** Local mongod vs Atlas/other hosted MongoDB; absent on older servers. */
  databaseMode?: 'local' | 'remote';
  databaseError?: string;
  serverTime: string;
}

export const health = {
  get: () => request<HealthStatus>('/health'),
};

/** Collect every message from a validation failure for display. */
export function validationMessages(err: unknown): string[] {
  if (err instanceof ApiError) {
    const details = err.details as { fields?: { path: string; message: string }[] } | undefined;
    if (details?.fields?.length) return details.fields.map((f) => `${f.path}: ${f.message}`);
    return [err.message];
  }
  return [err instanceof Error ? err.message : String(err)];
}
