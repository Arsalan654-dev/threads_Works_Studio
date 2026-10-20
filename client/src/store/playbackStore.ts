/**
 * Stitch playback.
 *
 * Kept in its own store rather than folded into `designStore` for two
 * reasons: playback is transient UI state that must never appear in undo
 * history, and the design store's mutations all bump `rev`, which would
 * invalidate the compiled-stitch cache on every animation frame.
 *
 * Playback advances a *pointer* into the already-compiled sequence. It never
 * regenerates stitches, so playing a design costs nothing beyond the redraw.
 */

import { create } from 'zustand';

/** Multiplier bounds for the speed control. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 8;

/**
 * Nominal rate, in stitches per second, at speed 1.
 *
 * A real machine sews roughly 600-1000 stitches per minute; this sits near the
 * slow end so the animation stays followable, and the speed control covers
 * the rest.
 */
export const BASE_STITCHES_PER_SECOND = 400;

interface PlaybackStore {
  playing: boolean;
  /** How many stitches of the sequence are currently revealed (fractional). */
  position: number;
  speed: number;
  /** True once playback has been started or scrubbed at least once. */
  active: boolean;
  /**
   * Total stitch count of the current sequence, written by the canvas each
   * frame.
   *
   * Playback does not own the compiled design, but `play()` still needs to
   * distinguish "at the end" from "not started" so that pressing play always
   * moves forward. Rather than reaching across stores for the sequence, the
   * canvas reports the length it is drawing.
   */
  totalHint: number;

  play: () => void;
  pause: () => void;
  /** Stop and rewind, leaving playback mode entirely. */
  reset: () => void;
  toggle: () => void;
  setSpeed: (speed: number) => void;
  setPosition: (position: number) => void;
  setTotal: (total: number) => void;

  /** Advance by `dtMs`. Returns true when playback reached the end. */
  tick: (dtMs: number, total: number) => boolean;
}

export const usePlaybackStore = create<PlaybackStore>()((set, get) => ({
  playing: false,
  position: 0,
  speed: 1,
  active: false,
  totalHint: 0,

  play: () => {
    const state = get();
    // Pressing play at the end restarts, so the button is always a forward
    // action rather than one that appears to do nothing.
    const position = state.totalHint > 0 && state.position >= state.totalHint ? 0 : state.position;
    set({ playing: true, active: true, position });
  },

  pause: () => set({ playing: false }),

  reset: () => set({ playing: false, active: false, position: 0 }),

  toggle: () => {
    if (get().playing) set({ playing: false });
    else get().play();
  },

  setSpeed: (speed) => set({ speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) }),

  setPosition: (position) => {
    const clamped = Math.max(0, position);
    set({
      position: clamped,
      active: true,
      // Scrubbing past the end should stop the animation rather than sit
      // there looping with nothing left to reveal.
      playing: get().playing && clamped < get().totalHint,
    });
  },

  setTotal: (total) => {
    const state = get();
    // A shorter sequence (the user deleted something) must not leave the
    // pointer past the end, which would freeze playback on a blank canvas.
    if (state.position > total) set({ totalHint: total, position: total, playing: false });
    else set({ totalHint: total });
  },

  tick: (dtMs, total) => {
    const state = get();
    const rate = BASE_STITCHES_PER_SECOND * state.speed;
    const next = state.position + (rate * dtMs) / 1000;

    if (next >= total) {
      set({ position: total, playing: false });
      return true;
    }

    set({ position: next });
    return false;
  },
}));
