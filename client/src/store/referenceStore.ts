/**
 * Reference data: hoops, palettes, digitizing presets, settings and server
 * health.
 *
 * Loaded once at startup and read by the design store when it needs a hoop.
 * Kept separate from the design document because none of it is part of what
 * the user is editing - a hoop preset appearing in undo history would be
 * actively wrong.
 */

import { create } from 'zustand';
import type { Hoop, ThreadColor } from '@threadworks/engine';
import {
  ApiError,
  digitizingPresets,
  health,
  hoops,
  motifs,
  palettes,
  settings,
  type AppSettings,
  type DigitizingParams,
  type HealthStatus,
  type MotifPreset,
} from '../api/client.js';

/** Map a stored motif preset onto the shape the editor reads. */
function toMotifEntry(p: MotifPreset): MotifEntry {
  return {
    presetId: p.id,
    name: p.name,
    points: p.data.points,
    note: p.data.note ?? '',
    builtin: p.builtin,
  };
}

export interface HoopEntry extends Hoop {
  /** Preset key: readable for seeded frames, hex for user frames. */
  presetId: string;
  builtin: boolean;
}

export interface PaletteEntry {
  presetId: string;
  name: string;
  colors: ThreadColor[];
  builtin: boolean;
}

export interface PresetEntry {
  presetId: string;
  name: string;
  params: DigitizingParams;
  builtin: boolean;
}

/**
 * One shape in the motif library.
 *
 * `points` is what the design will carry, so it is resolved once here and used
 * by both the picker and the compile path. A shape stored in a unit box is
 * scaled by `scale` when placed, which is what keeps one number meaning the
 * same thing whichever motif is picked.
 */
export interface MotifEntry {
  presetId: string;
  name: string;
  points: { x: number; y: number }[];
  note: string;
  builtin: boolean;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface ReferenceStore {
  hoops: HoopEntry[];
  palettes: PaletteEntry[];
  presets: PresetEntry[];
  motifs: MotifEntry[];
  settings: AppSettings | null;
  server: HealthStatus | null;

  status: LoadState;
  error: string | null;

  loadAll: () => Promise<void>;
  loadHealth: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  reloadMotifs: () => Promise<void>;
}

export const referenceStore = create<ReferenceStore>()((set, get) => ({
  hoops: [],
  palettes: [],
  presets: [],
  motifs: [],
  settings: null,
  server: null,

  status: 'idle',
  error: null,

  loadAll: async () => {
    set({ status: 'loading', error: null });
    try {
      // `Promise.all` would fail the whole load if a single optional
      // collection were unavailable, so each is fetched independently and
      // partial success is still usable.
      const [hoopRes, paletteRes, presetRes, settingsRes, healthRes, motifRes] =
        await Promise.allSettled([
          hoops.list(),
          palettes.list(),
          digitizingPresets.list(),
          settings.get(),
          health.get(),
          motifs.list(),
        ]);

      const failures: string[] = [];

      if (hoopRes.status === 'fulfilled') {
        set({
          hoops: hoopRes.value.items.map((p) => ({
            presetId: p.id,
            name: p.name,
            builtin: p.builtin,
            id: p.id,
            width: p.data.width,
            height: p.data.height,
            shape: p.data.shape,
            safeMargin: p.data.safeMargin,
            cap: p.data.cap === true,
          })),
        });
      } else {
        failures.push(describe(hoopRes.reason));
      }

      if (paletteRes.status === 'fulfilled') {
        set({
          palettes: paletteRes.value.items.map((p) => ({
            presetId: p.id,
            name: p.name,
            colors: p.data,
            builtin: p.builtin,
          })),
        });
      } else {
        failures.push(describe(paletteRes.reason));
      }

      if (presetRes.status === 'fulfilled') {
        set({
          presets: presetRes.value.items.map((p) => ({
            presetId: p.id,
            name: p.name,
            params: p.data,
            builtin: p.builtin,
          })),
        });
      } else {
        failures.push(describe(presetRes.reason));
      }

      // The motif library is what a motif fill and a carve both draw their
      // shape from. Loading it separately means the rest of the editor is
      // still usable if the collection is missing — the picker simply falls
      // back to the built-ins, which never come from the database.
      if (motifRes.status === 'fulfilled') {
        set({ motifs: motifRes.value.items.map(toMotifEntry) });
      } else {
        set({ motifs: [] });
      }

      if (settingsRes.status === 'fulfilled') set({ settings: settingsRes.value });
      else failures.push(describe(settingsRes.reason));

      if (healthRes.status === 'fulfilled') set({ server: healthRes.value });
      else set({ server: null });

      if (failures.length > 0) {
        set({ status: 'error', error: failures.join(' | ') });
        return;
      }

      set({ status: 'ready', error: null });
    } catch (err) {
      set({ status: 'error', error: describe(err) });
    }
  },

  loadHealth: async () => {
    try {
      set({ server: await health.get() });
    } catch {
      set({ server: null });
    }
  },

  saveSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    // Optimistically apply so toggling a checkbox feels instant; reconcile
    // with the server's copy when it responds.
    set({ settings: { ...current, ...patch } });
    try {
      const saved = await settings.update(patch);
      set({ settings: saved });
    } catch (err) {
      set({ settings: current, error: describe(err) });
      throw err;
    }
  },

  reloadMotifs: async () => {
    try {
      const res = await motifs.list();
      set({ motifs: res.items.map(toMotifEntry) });
    } catch (err) {
      // A failed refresh keeps the shapes already loaded: the library is a
      // convenience, and losing it mid-edit would be worse than showing a
      // stale list.
      set({ error: describe(err) });
    }
  },
}));

function describe(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isOffline) return 'Server is not running';
    return `${err.code}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
