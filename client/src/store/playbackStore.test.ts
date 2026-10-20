import { describe, it, expect, beforeEach } from 'vitest';
import {
  BASE_STITCHES_PER_SECOND,
  MAX_SPEED,
  MIN_SPEED,
  usePlaybackStore,
} from './playbackStore.js';

/**
 * Playback state is module-level, so every test starts from an explicit
 * baseline rather than assuming another test left it clean.
 */
beforeEach(() => {
  usePlaybackStore.setState({
    playing: false,
    position: 0,
    speed: 1,
    active: false,
    totalHint: 0,
  });
});

describe('transport', () => {
  it('starts at the beginning and is inactive until first used', () => {
    const s = usePlaybackStore.getState();
    expect(s.playing).toBe(false);
    expect(s.active).toBe(false);
    expect(s.position).toBe(0);
  });

  it('play marks playback active and running', () => {
    usePlaybackStore.getState().setTotal(1000);
    usePlaybackStore.getState().play();

    const s = usePlaybackStore.getState();
    expect(s.playing).toBe(true);
    expect(s.active).toBe(true);
  });

  it('pause keeps the position so playback resumes where it stopped', () => {
    usePlaybackStore.getState().setTotal(1000);
    usePlaybackStore.getState().play();
    usePlaybackStore.getState().setPosition(400);
    usePlaybackStore.getState().pause();

    expect(usePlaybackStore.getState().playing).toBe(false);
    expect(usePlaybackStore.getState().position).toBe(400);

    usePlaybackStore.getState().play();
    expect(usePlaybackStore.getState().position).toBe(400);
  });

  it('play at the very end restarts from zero', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().setPosition(100);

    usePlaybackStore.getState().play();

    expect(usePlaybackStore.getState().position).toBe(0);
    expect(usePlaybackStore.getState().playing).toBe(true);
  });

  it('reset rewinds and leaves playback mode entirely', () => {
    usePlaybackStore.getState().setTotal(500);
    usePlaybackStore.getState().play();
    usePlaybackStore.getState().setPosition(200);

    usePlaybackStore.getState().reset();

    const s = usePlaybackStore.getState();
    expect(s.position).toBe(0);
    expect(s.active).toBe(false);
    expect(s.playing).toBe(false);
  });

  it('toggle round-trips between play and pause', () => {
    usePlaybackStore.getState().toggle();
    expect(usePlaybackStore.getState().playing).toBe(true);

    usePlaybackStore.getState().toggle();
    expect(usePlaybackStore.getState().playing).toBe(false);

    // Position is untouched by pausing, so the second play does not rewind.
    usePlaybackStore.getState().toggle();
    expect(usePlaybackStore.getState().playing).toBe(true);
  });
});

describe('ticking', () => {
  it('advances by the base rate at speed 1', () => {
    usePlaybackStore.getState().setTotal(10_000);
    usePlaybackStore.getState().play();

    usePlaybackStore.getState().tick(1000, 10_000);

    expect(usePlaybackStore.getState().position).toBeCloseTo(BASE_STITCHES_PER_SECOND, 6);
  });

  it('advances at double rate at speed 2', () => {
    usePlaybackStore.getState().setSpeed(2);
    usePlaybackStore.getState().setTotal(10_000);
    usePlaybackStore.getState().play();

    usePlaybackStore.getState().tick(500, 10_000);

    expect(usePlaybackStore.getState().position).toBeCloseTo(
      (BASE_STITCHES_PER_SECOND * 2 * 500) / 1000,
      6,
    );
  });

  it('returns false while there is more to reveal', () => {
    usePlaybackStore.getState().setTotal(10_000);
    usePlaybackStore.getState().play();

    expect(usePlaybackStore.getState().tick(16, 10_000)).toBe(false);
    expect(usePlaybackStore.getState().playing).toBe(true);
  });

  it('lands exactly on the end and stops', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().play();

    expect(usePlaybackStore.getState().tick(60_000, 100)).toBe(true);

    const s = usePlaybackStore.getState();
    expect(s.position).toBe(100);
    expect(s.playing).toBe(false);
  });

  it('does not overshoot the sequence', () => {
    usePlaybackStore.getState().setTotal(50);
    usePlaybackStore.getState().play();

    usePlaybackStore.getState().tick(60_000, 50);

    expect(usePlaybackStore.getState().position).toBe(50);
  });
});

describe('scrubbing', () => {
  it('clamps a negative position to zero', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().setPosition(-40);

    expect(usePlaybackStore.getState().position).toBe(0);
    expect(usePlaybackStore.getState().active).toBe(true);
  });

  it('allows scrubbing past the reported total, since paint clamps it', () => {
    usePlaybackStore.getState().setTotal(10);
    usePlaybackStore.getState().setPosition(999);

    // The canvas floors and clamps; the store keeps the raw value so a frame
    // that arrives with a stale total does not silently rewind the pointer.
    expect(usePlaybackStore.getState().position).toBe(999);
  });

  it('stops playing when scrubbed to the end', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().play();
    usePlaybackStore.getState().setPosition(100);

    expect(usePlaybackStore.getState().playing).toBe(false);
    expect(usePlaybackStore.getState().active).toBe(true);
  });

  it('stays playing when scrubbed somewhere in the middle', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().play();
    usePlaybackStore.getState().setPosition(50);

    expect(usePlaybackStore.getState().playing).toBe(true);
    expect(usePlaybackStore.getState().position).toBe(50);
  });
});

describe('total hint', () => {
  it('records the sequence length', () => {
    usePlaybackStore.getState().setTotal(4321);
    expect(usePlaybackStore.getState().totalHint).toBe(4321);
  });

  it('clamps the pointer when the sequence shrinks', () => {
    usePlaybackStore.getState().setTotal(1000);
    usePlaybackStore.getState().setPosition(800);
    usePlaybackStore.getState().play();

    // Deleting objects mid-playback can shorten the sequence under the
    // pointer; leaving it past the end would freeze on an empty canvas.
    usePlaybackStore.getState().setTotal(200);

    const s = usePlaybackStore.getState();
    expect(s.position).toBe(200);
    expect(s.totalHint).toBe(200);
    expect(s.playing).toBe(false);
  });

  it('leaves the pointer alone when the sequence grows', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().setPosition(60);
    usePlaybackStore.getState().setTotal(500);

    expect(usePlaybackStore.getState().position).toBe(60);
    expect(usePlaybackStore.getState().totalHint).toBe(500);
  });

  it('leaves the pointer alone when the length is unchanged', () => {
    usePlaybackStore.getState().setTotal(100);
    usePlaybackStore.getState().setPosition(60);
    usePlaybackStore.getState().setTotal(100);

    expect(usePlaybackStore.getState().position).toBe(60);
  });
});

describe('speed', () => {
  it('accepts a value inside the documented range', () => {
    usePlaybackStore.getState().setSpeed(4);
    expect(usePlaybackStore.getState().speed).toBe(4);
  });

  it('clamps above the maximum', () => {
    usePlaybackStore.getState().setSpeed(999);
    expect(usePlaybackStore.getState().speed).toBe(MAX_SPEED);
  });

  it('clamps below the minimum', () => {
    usePlaybackStore.getState().setSpeed(0);
    expect(usePlaybackStore.getState().speed).toBe(MIN_SPEED);
  });

  it('never allows a zero multiplier, which would freeze playback', () => {
    expect(MIN_SPEED).toBeGreaterThan(0);
  });
});
