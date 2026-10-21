/**
 * Built-in clipart.
 *
 * Every shape is generated from original parametric geometry, normalised into
 * a one-unit box and then scaled to the requested millimetres. There is no
 * external SVG library and no third-party artwork: this is the same
 * "functionality, not copied expression" rule the rest of the engine follows.
 *
 * A clipart entry can have several rings. The canvas and the stitch generator
 * use the even-odd rule, so an inner ring cuts a hole (the moon's crescent) and
 * disjoint rings become separate islands (the paw's toes).
 */

import type { Point, Ring } from './types.js';
import { boundsOf } from './geometry/index.js';

export interface ClipartEntry {
  id: string;
  name: string;
  category: string;
  tags: string[];
  /** Rings in a normalised box centred on the origin. */
  rings: Ring[];
}

export interface ClipartPlacement {
  id: string;
  name: string;
  rings: Ring[];
  widthMm: number;
  heightMm: number;
  center: Point;
}

const TAU = Math.PI * 2;

function ringFrom(fn: (t: number) => Point, steps: number): Ring {
  const out: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const p = fn((i / steps) * TAU);
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) out.push(p);
  }
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 48, rotation = 0): Ring {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return ringFrom((t) => {
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  }, steps);
}

function star(points: number, outer: number, inner: number, phase = -Math.PI / 2): Ring {
  return ringFrom((t) => {
    const index = Math.round((t / TAU) * points * 2);
    const radius = index % 2 === 0 ? outer : inner;
    return { x: Math.cos(t + phase) * radius, y: Math.sin(t + phase) * radius };
  }, points * 2);
}

function polygon(points: Array<[number, number]>): Ring {
  return points.map(([x, y]) => ({ x, y }));
}

function normalise(rings: Ring[]): Ring[] {
  const box = boundsOf(rings);
  const width = Math.max(1e-6, box.maxX - box.minX);
  const height = Math.max(1e-6, box.maxY - box.minY);
  const scale = 1 / Math.max(width, height);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return rings.map((ring) =>
    ring.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })),
  );
}

function leaf(): Ring {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 32; i += 1) {
    const s = i / 32;
    const width = 0.46 * Math.pow(Math.sin(Math.PI * s), 0.72);
    const y = -0.5 + s;
    left.push({ x: -width, y });
    right.push({ x: width, y });
  }
  return [...left, ...right.reverse().slice(1)];
}

function butterfly(): Ring[] {
  return [
    ellipse(-0.23, -0.16, 0.25, 0.18, 36, -0.45),
    ellipse(0.23, -0.16, 0.25, 0.18, 36, 0.45),
    ellipse(-0.2, 0.22, 0.18, 0.15, 36, 0.35),
    ellipse(0.2, 0.22, 0.18, 0.15, 36, -0.35),
    ellipse(0, 0.05, 0.055, 0.28, 28),
  ];
}

function flower(): Ring {
  return ringFrom((t) => {
    const r = 0.36 + 0.3 * Math.abs(Math.sin(4 * t));
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  }, 96);
}

function sun(): Ring {
  return ringFrom((t) => {
    const r = 0.34 + (Math.round((t / TAU) * 24) % 2 === 0 ? 0.22 : 0);
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  }, 48);
}

function crown(): Ring {
  return polygon([
    [-0.46, 0.32],
    [-0.46, -0.3],
    [-0.24, -0.08],
    [-0.1, -0.43],
    [0, -0.12],
    [0.1, -0.43],
    [0.24, -0.08],
    [0.46, -0.3],
    [0.46, 0.32],
  ]);
}

function shield(): Ring {
  return polygon([
    [-0.4, -0.38],
    [0.4, -0.38],
    [0.4, 0.04],
    [0.3, 0.25],
    [0, 0.47],
    [-0.3, 0.25],
    [-0.4, 0.04],
  ]);
}

function arrow(): Ring {
  return polygon([
    [-0.48, -0.12],
    [0.08, -0.12],
    [0.08, -0.34],
    [0.48, 0],
    [0.08, 0.34],
    [0.08, 0.12],
    [-0.48, 0.12],
  ]);
}

function paw(): Ring[] {
  return [
    ellipse(0, 0.18, 0.24, 0.2, 40),
    ellipse(-0.27, -0.2, 0.09, 0.12, 28),
    ellipse(-0.09, -0.32, 0.09, 0.12, 28),
    ellipse(0.09, -0.32, 0.09, 0.12, 28),
    ellipse(0.27, -0.2, 0.09, 0.12, 28),
  ];
}

function snowflake(): Ring {
  return ringFrom((t) => {
    const r = 0.2 + 0.26 * Math.pow(Math.abs(Math.cos(3 * t)), 0.5);
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  }, 72);
}

function badge(): Ring[] {
  return [
    ellipse(0, 0, 0.46, 0.46, 56),
    star(5, 0.3, 0.13),
  ];
}

function hexagon(): Ring {
  return ringFrom((t) => ({ x: Math.cos(t) * 0.48, y: Math.sin(t) * 0.48 }), 6);
}

const RAW: Array<{
  id: string;
  name: string;
  category: string;
  tags: string[];
  rings: Ring[];
}> = [
  {
    id: 'heart',
    name: 'Heart',
    category: 'Love',
    tags: ['love', 'valentine', 'romance'],
    rings: [ringFrom((t) => {
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      return { x: x / 32, y: y / 32 };
    }, 80)],
  },
  {
    id: 'star',
    name: 'Five-point star',
    category: 'Stars',
    tags: ['star', 'award', 'rating'],
    rings: [star(5, 0.5, 0.21)],
  },
  {
    id: 'burst',
    name: 'Burst',
    category: 'Stars',
    tags: ['star', 'sun', 'burst'],
    rings: [star(12, 0.5, 0.27)],
  },
  {
    id: 'flower',
    name: 'Daisy',
    category: 'Nature',
    tags: ['flower', 'daisy', 'spring'],
    rings: [flower()],
  },
  {
    id: 'leaf',
    name: 'Leaf',
    category: 'Nature',
    tags: ['leaf', 'plant', 'botanical'],
    rings: [leaf()],
  },
  {
    id: 'butterfly',
    name: 'Butterfly',
    category: 'Nature',
    tags: ['butterfly', 'insect', 'spring'],
    rings: butterfly(),
  },
  {
    id: 'sun',
    name: 'Sun',
    category: 'Nature',
    tags: ['sun', 'summer', 'weather'],
    rings: [sun()],
  },
  {
    id: 'moon',
    name: 'Crescent moon',
    category: 'Nature',
    tags: ['moon', 'night', 'crescent'],
    rings: [ellipse(0, 0, 0.48, 0.48, 64), ellipse(0.12, -0.03, 0.36, 0.4, 64)],
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'Nature',
    tags: ['snow', 'winter', 'flake'],
    rings: [snowflake()],
  },
  {
    id: 'crown',
    name: 'Crown',
    category: 'Celebration',
    tags: ['crown', 'king', 'queen', 'royal'],
    rings: [crown()],
  },
  {
    id: 'shield',
    name: 'Shield',
    category: 'Symbols',
    tags: ['shield', 'badge', 'team'],
    rings: [shield()],
  },
  {
    id: 'badge',
    name: 'Star badge',
    category: 'Symbols',
    tags: ['badge', 'star', 'seal'],
    rings: badge(),
  },
  {
    id: 'arrow',
    name: 'Arrow',
    category: 'Symbols',
    tags: ['arrow', 'direction', 'pointer'],
    rings: [arrow()],
  },
  {
    id: 'diamond',
    name: 'Diamond',
    category: 'Symbols',
    tags: ['diamond', 'gem', 'rhombus'],
    rings: [polygon([
      [0, -0.48],
      [0.42, 0],
      [0, 0.48],
      [-0.42, 0],
    ])],
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    category: 'Symbols',
    tags: ['hexagon', 'geometric', 'frame'],
    rings: [hexagon()],
  },
  {
    id: 'paw',
    name: 'Paw print',
    category: 'Animals',
    tags: ['paw', 'dog', 'cat', 'pet'],
    rings: paw(),
  },
  {
    id: 'cross',
    name: 'Cross',
    category: 'Symbols',
    tags: ['cross', 'faith', 'plus'],
    rings: [polygon([
      [-0.13, -0.48],
      [0.13, -0.48],
      [0.13, -0.15],
      [0.44, -0.15],
      [0.44, 0.15],
      [0.13, 0.15],
      [0.13, 0.48],
      [-0.13, 0.48],
      [-0.13, 0.15],
      [-0.44, 0.15],
      [-0.44, -0.15],
      [-0.13, -0.15],
    ])],
  },
];

export const CLIPART: ClipartEntry[] = RAW.map((entry) => ({
  ...entry,
  rings: normalise(entry.rings),
}));

export const CLIPART_CATEGORIES: string[] = Array.from(
  new Set(CLIPART.map((entry) => entry.category)),
).sort();

export function clipartById(id: string): ClipartEntry | null {
  return CLIPART.find((entry) => entry.id === id) ?? null;
}

/**
 * Search name, category and tags. An empty query returns the whole catalogue
 * so the browser starts useful instead of blank.
 */
export function searchClipart(query: string, category?: string | null): ClipartEntry[] {
  const needle = query.trim().toLowerCase();
  return CLIPART.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (needle === '') return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.category.toLowerCase().includes(needle) ||
      entry.tags.some((tag) => tag.includes(needle))
    );
  });
}

/**
 * Scale and place a clipart entry. The aspect ratio is preserved and the
 * result is centred on `center`, so a 20 x 80 request still produces a
 * correctly proportioned shape inside that box rather than a stretched one.
 */
export function placeClipart(
  id: string,
  options: { widthMm: number; heightMm: number; center: Point },
): ClipartPlacement | null {
  const entry = clipartById(id);
  if (!entry) return null;
  const box = boundsOf(entry.rings);
  const naturalWidth = Math.max(1e-6, box.maxX - box.minX);
  const naturalHeight = Math.max(1e-6, box.maxY - box.minY);
  const widthMm = Math.max(1, Math.abs(options.widthMm));
  const heightMm = Math.max(1, Math.abs(options.heightMm));
  const scale = Math.min(widthMm / naturalWidth, heightMm / naturalHeight);
  const offsetX = options.center.x - box.minX * scale - (naturalWidth * scale) / 2;
  const offsetY = options.center.y - box.minY * scale - (naturalHeight * scale) / 2;

  return {
    id: entry.id,
    name: entry.name,
    rings: entry.rings.map((ring) =>
      ring.map((p) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY })),
    ),
    widthMm: naturalWidth * scale,
    heightMm: naturalHeight * scale,
    center: { ...options.center },
  };
}
