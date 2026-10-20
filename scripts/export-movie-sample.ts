/**
 * Render a stitch movie for the sample design.
 *
 * Run with `npx tsx scripts/export-movie-sample.ts`. The GIF lands in
 * `samples/` next to the machine files, so it can be sent to a client as-is.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDesign, encodeStitchMovie } from '../packages/embroidery-engine/src/index.js';
import { createObject, rectangleRing, circleRing } from '../client/src/model/defaults.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'samples');
mkdirSync(outDir, { recursive: true });

const objects = [
  createObject('fill', [rectangleRing(20, 20, 40, 25)], 0, 0),
  createObject('fill', [circleRing(55, 55, 15)], 1, 0),
];

const palette = [
  { id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' },
  { id: 'c2', code: '1002', name: 'Navy', hex: '#1B2A4A' },
];

const compiled = compileDesign(objects, palette, null);
if (!compiled.validation.ok) {
  console.error('Design failed validation:');
  for (const issue of compiled.validation.issues) console.error(` - ${issue.message}`);
  process.exitCode = 1;
} else {
  const started = Date.now();
  const movie = encodeStitchMovie(compiled.sequence.stitches, {
    size: 420,
    fps: 12,
    threads: palette,
    maxFrames: 260,
  });
  const elapsed = Date.now() - started;

  const path = join(outDir, 'sample-movie.gif');
  writeFileSync(path, movie.bytes);

  console.log(`design: ${movie.stitches} stitches, ${movie.frames} frames @ ${movie.fps} fps`);
  console.log(`frame:  ${movie.width} x ${movie.height}`);
  console.log(`sample-movie.gif  ${movie.bytes.length} bytes  (rendered in ${elapsed} ms)`);
  console.log(`written to ${path}`);
}
