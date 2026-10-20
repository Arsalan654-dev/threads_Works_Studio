import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REDWORK,
  REDWORK_LIMITS,
  generateObjectStitches,
  redworkSettings,
  redworkStitches,
} from './index.js';
import type {
  EmbroideryObject,
  Point,
  RedworkSettings,
  RedworkStyle,
  StitchParameters,
} from './types.js';

const OPEN: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
];

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function settings(patch: Partial<RedworkSettings> = {}): RedworkSettings {
  return {
    enabled: true,
    style: 'single',
    widthMm: 1.2,
    stitchMm: 2.5,
    ...patch,
  };
}

function generate(
  points: Point[],
  patch: Partial<RedworkSettings> = {},
  closed = false,
): ReturnType<typeof redworkStitches> {
  return redworkStitches({ rings: [points] }, settings(patch), {
    closed,
    maxStitchLength: 12.1,
  });
}

function sewn(raw: { command: string }[]): number {
  return raw.filter((s) => s.command === 'stitch').length;
}

describe('redworkSettings', () => {
  it('is off when absent, null or disabled', () => {
    expect(redworkSettings(undefined)).toBeNull();
    expect(redworkSettings(null)).toBeNull();
    expect(redworkSettings({ ...DEFAULT_REDWORK })).toBeNull();
    expect(redworkSettings({ ...DEFAULT_REDWORK, enabled: false })).toBeNull();
  });

  it('keeps a valid style and clamps the numbers', () => {
    const normalized = redworkSettings({
      enabled: true,
      style: 'stem',
      widthMm: 99,
      stitchMm: 0,
    });
    expect(normalized).toEqual({
      enabled: true,
      style: 'stem',
      widthMm: REDWORK_LIMITS.maxWidthMm,
      stitchMm: REDWORK_LIMITS.minStitchMm,
    });
  });

  it('falls back to a single line for an unknown style', () => {
    const normalized = redworkSettings({
      enabled: true,
      style: 'scribble' as unknown as RedworkStyle,
      widthMm: 1,
      stitchMm: 2,
    });
    expect(normalized?.style).toBe('single');
  });
});

describe('redwork single line', () => {
  it('runs from end to end at the requested step', () => {
    const raw = generate(OPEN);
    expect(raw.every((s) => s.command === 'stitch')).toBe(true);
    expect(raw[0]!.x).toBe(0);
    expect(raw[raw.length - 1]!.x).toBe(20);
    expect(raw).toHaveLength(9); // 20 / 2.5
    for (let i = 1; i < raw.length; i++) expect(raw[i]!.x).toBeGreaterThan(raw[i - 1]!.x);
  });

  it('keeps every corner of a closed outline', () => {
    const raw = generate(SQUARE, {}, true);
    const first = raw[0]!;
    const last = raw[raw.length - 1]!;
    expect(last.x).toBe(first.x);
    expect(last.y).toBe(first.y);

    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    for (const corner of corners) {
      expect(
        raw.some((s) => Math.abs(s.x - corner.x) < 1e-9 && Math.abs(s.y - corner.y) < 1e-9),
      ).toBe(true);
    }
  });

  it('keeps points on the outline rather than cutting across it', () => {
    const raw = generate(SQUARE, { stitchMm: 2.4 }, true);
    for (const s of raw) {
      const onEdge =
        Math.abs(s.x) < 1e-9 ||
        Math.abs(s.x - 10) < 1e-9 ||
        Math.abs(s.y) < 1e-9 ||
        Math.abs(s.y - 10) < 1e-9;
      expect(onEdge).toBe(true);
    }
  });

  it('respects the machine step limit', () => {
    const raw = generate(OPEN, { stitchMm: 50 });
    for (let i = 1; i < raw.length; i++) {
      expect(Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y)).toBeLessThanOrEqual(
        12.1 + 1e-9,
      );
    }
  });
});

describe('redwork line styles', () => {
  it('triple sews the same line three times', () => {
    const single = sewn(generate(OPEN));
    const triple = generate(OPEN, { style: 'triple' });
    expect(sewn(triple)).toBeGreaterThan(single * 2);
    expect(triple[triple.length - 1]!.x).toBe(20);
    // It never leaves the line: the passes reuse the same penetrations.
    expect(triple.every((s) => Math.abs(s.y) < 1e-9)).toBe(true);
  });

  it('backstitch returns to the previous hole before advancing', () => {
    const raw = generate(OPEN, { style: 'backstitch' });
    expect(raw[0]).toMatchObject({ x: 0, y: 0 });
    expect(raw[1]).toMatchObject({ x: 2.5, y: 0 });
    expect(raw[2]).toMatchObject({ x: 0, y: 0 });
    expect(raw[3]).toMatchObject({ x: 5, y: 0 });
    expect(raw[raw.length - 1]).toMatchObject({ x: 20, y: 0 });
  });

  it('stem lays slanted stitches across the line and finishes on it', () => {
    const raw = generate(OPEN, { style: 'stem', widthMm: 1.2 });
    const ys = raw.map((s) => s.y);
    expect(Math.max(...ys)).toBeCloseTo(0.6, 6);
    expect(Math.min(...ys)).toBeCloseTo(-0.6, 6);
    expect(raw[raw.length - 1]!.y).toBeCloseTo(0, 6);

    for (let i = 1; i < raw.length; i++) {
      expect(Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y)).toBeLessThanOrEqual(
        12.1 + 1e-9,
      );
    }
  });

  it('treats a two-point ring as a line and ignores a one-point ring', () => {
    expect(
      redworkStitches({ rings: [[{ x: 0, y: 0 }]] }, settings(), {
        closed: false,
        maxStitchLength: 12.1,
      }),
    ).toHaveLength(0);
    expect(
      redworkStitches({ rings: [[...OPEN]] }, settings(), {
        closed: true,
        maxStitchLength: 12.1,
      }).length,
    ).toBeGreaterThan(1);
  });
});

describe('redwork multi-ring and integration', () => {
  it('trims and jumps between separate rings', () => {
    const raw = redworkStitches(
      {
        rings: [
          OPEN,
          [
            { x: 0, y: 5 },
            { x: 20, y: 5 },
          ],
        ],
      },
      settings(),
      { closed: false, maxStitchLength: 12.1 },
    );

    const trim = raw.findIndex((s) => s.command === 'trim');
    expect(trim).toBeGreaterThan(0);
    expect(raw[trim + 1]).toMatchObject({ command: 'jump', x: 0, y: 5 });
  });

  const PARAMS: StitchParameters = {
    stitchType: 'tatami',
    angle: 0,
    spacing: 0.4,
    maxStitchLength: 12.1,
    minStitchLength: 0.3,
    pullCompensation: 0.2,
    fillPattern: 'tatami',
    underlay: { type: 'edgeRun', spacing: 3, offset: 1, inset: 1 },
    tieIn: { enabled: true, length: 0.4, count: 3 },
    tieOff: { enabled: true, length: 0.4, count: 3 },
  };

  function object(type: EmbroideryObject['type'], redwork: RedworkSettings | null) {
    return {
      id: 'rw-1',
      name: 'Redwork',
      type,
      path: { rings: [SQUARE] },
      transform: { x: 0, y: 0 },
      colorIndex: 0,
      params: { ...PARAMS, ...(redwork ? { redwork } : {}) },
      entryExit: { entry: null, exit: null },
      lettering: null,
      order: 0,
      locked: false,
      hidden: false,
      groupId: null,
      warnings: [],
    } satisfies EmbroideryObject;
  }

  it('replaces a fill with an outline and drops its underlay', () => {
    const raw = generateObjectStitches(object('fill', settings()));

    // Redwork is line work only: no underlay stitches inside the shape and no
    // tie-in/tie-off either.
    expect(raw.every((s) => s.command === 'stitch')).toBe(true);
    for (const s of raw) {
      const onEdge =
        Math.abs(s.x) < 1e-9 ||
        Math.abs(s.x - 10) < 1e-9 ||
        Math.abs(s.y) < 1e-9 ||
        Math.abs(s.y - 10) < 1e-9;
      expect(onEdge).toBe(true);
    }

    const plain = generateObjectStitches(object('fill', null));
    expect(raw.length).toBeLessThan(plain.length);
  });

  it('comes back as a normal fill when the setting is off', () => {
    const raw = generateObjectStitches(object('fill', { ...settings(), enabled: false }));
    expect(
      raw.some((s) => s.command === 'stitch' && s.x > 1 && s.x < 9 && s.y > 1 && s.y < 9),
    ).toBe(true);
  });
});
