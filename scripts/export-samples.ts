/**
 * Export sample files in every supported machine format.
 *
 * Run with `npx tsx scripts/export-samples.ts`. The files land in `samples/`
 * and are useful two ways: as quick verification that the encoders run end to
 * end, and as real files to try on a machine or open in digitizing software.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileDesign,
  writeDst,
  writePes,
  writeExp,
  writeJef,
  writeVp3,
  writeTbf,
  writeHus,
} from '../packages/embroidery-engine/src/index.js';
import { createObject, rectangleRing, circleRing } from '../client/src/model/defaults.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'samples');
mkdirSync(outDir, { recursive: true });

// Two colour blocks with a gap between them, so the export exercises colour
// changes, travel and trims rather than a single continuous run.
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
  const { stitches, colorCount } = compiled.sequence;
  const name = 'ThreadWorks Sample';

  const dst = writeDst(stitches, { name, colorCount });
  const pes = writePes(stitches, { name, colorCount, threads: palette });
  const exp = writeExp(stitches);
  // A fixed date keeps the sample byte-identical between runs, so a diff of
  // samples/ only ever shows a real encoder change.
  const jef = writeJef(stitches, { threads: palette, date: '20240101120000' });
  const vp3 = writeVp3(stitches, palette);
  const tbf = writeTbf(stitches, palette, name);
  const hus = writeHus(stitches, palette, name);

  writeFileSync(join(outDir, 'sample.dst'), dst);
  writeFileSync(join(outDir, 'sample.pes'), pes);
  writeFileSync(join(outDir, 'sample.exp'), exp);
  writeFileSync(join(outDir, 'sample.jef'), jef);
  writeFileSync(join(outDir, 'sample.vp3'), vp3);
  writeFileSync(join(outDir, 'sample.tbf'), tbf);
  writeFileSync(join(outDir, 'sample.hus'), hus);

  console.log(`design: ${stitches.length} stitches, ${colorCount} colours`);
  console.log(`sample.dst  ${dst.length} bytes`);
  console.log(`sample.pes  ${pes.length} bytes`);
  console.log(`sample.exp  ${exp.length} bytes`);
  console.log(`sample.jef  ${jef.length} bytes`);
  console.log(`sample.vp3  ${vp3.length} bytes`);
  console.log(`sample.tbf  ${tbf.length} bytes`);
  console.log(`sample.hus  ${hus.length} bytes`);
  console.log(`written to ${outDir}`);
}
