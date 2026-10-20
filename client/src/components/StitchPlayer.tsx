/**
 * Stitch player: watch the design sew out.
 *
 * The player only moves a pointer through the already-compiled sequence - it
 * never regenerates stitches - so what you see here is the same order the
 * machine will execute, including trims, jumps and colour changes. That is the
 * point of the feature: it is a check of the real output, not an artist's
 * impression of it.
 */

import { useEffect } from 'react';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { usePlaybackStore } from '../store/playbackStore.js';

/** Fixed steps rather than a continuous slider: these are easy to hit. */
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

export function StitchPlayer(): React.ReactElement {
  const playing = usePlaybackStore((s) => s.playing);
  const active = usePlaybackStore((s) => s.active);
  const position = usePlaybackStore((s) => s.position);
  const speed = usePlaybackStore((s) => s.speed);
  const total = usePlaybackStore((s) => s.totalHint);

  // Recompute the readout when the design changes underneath playback; the
  // canvas keeps `totalHint` in sync, but a compile error can take it to 0.
  const rev = useDesignStore((s) => s.rev);
  void rev;

  // Start from the saved preference. The guard matters: settings arrive
  // asynchronously, so a speed chosen during the opening second of a session
  // must not be silently overwritten by the stored value. Leaving the speed
  // alone once it differs from the default is what makes "the user's choice
  // wins" true without another flag to maintain.
  const preferredSpeed = referenceStore((s) => s.settings?.stitchSimulationSpeed);
  useEffect(() => {
    if (preferredSpeed === undefined) return;
    if (!SPEEDS.some((option) => option === preferredSpeed)) return;
    const store = usePlaybackStore.getState();
    if (store.speed !== 1) return;
    store.setSpeed(preferredSpeed);
  }, [preferredSpeed]);

  const revealed = Math.min(total, Math.max(0, Math.floor(position)));
  const atEnd = total > 0 && revealed >= total;

  // Space toggles playback. Deliberately ignored while a text field has focus
  // (the browser's own space handling matters there) and while a drawing tool
  // is mid-outline, where space already finishes the shape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (useDesignStore.getState().tool !== 'select') return;
      event.preventDefault();
      usePlaybackStore.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="stitch-player"
      role="group"
      aria-label="Stitch player"
      data-testid="stitch-player"
      data-playing={playing ? 'true' : 'false'}
    >
      <button
        type="button"
        className="player-btn"
        data-testid="player-reset"
        title="Rewind to the start (stops playback)"
        aria-label="Rewind"
        disabled={!active}
        onClick={() => usePlaybackStore.getState().reset()}
      >
        ⏮
      </button>

      <button
        type="button"
        className="player-btn player-btn-primary"
        data-testid="player-toggle"
        title={playing ? 'Pause (Space)' : 'Play stitch-out (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => usePlaybackStore.getState().toggle()}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <input
        type="range"
        className="player-scrub"
        data-testid="player-scrub"
        min={0}
        max={Math.max(1, total)}
        step={1}
        value={revealed}
        disabled={total === 0}
        aria-label="Stitch position"
        title="Scrub through the stitch sequence"
        onChange={(e) => {
          const value = Number(e.target.value);
          usePlaybackStore.getState().setPosition(value);
        }}
      />

      <span className="player-count" data-testid="player-count">
        {revealed.toLocaleString()} / {total.toLocaleString()}
      </span>

      <label className="player-speed">
        <span className="player-speed-label">Speed</span>
        <select
          data-testid="player-speed"
          value={speed}
          aria-label="Playback speed"
          onChange={(e) => usePlaybackStore.getState().setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </label>

      {atEnd && (
        <span className="player-end" data-testid="player-end" role="status">
          complete
        </span>
      )}
    </div>
  );
}
