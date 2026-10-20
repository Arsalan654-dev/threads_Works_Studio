/**
 * End-to-end smoke check against the running server.
 *
 * Deliberately uses plain HTTP + the real engine, i.e. the same two things the
 * browser uses, so a pass here means the shipped wiring works - not that a
 * unit test double does. Exits non-zero on the first failure.
 *
 *   npx tsx scripts/smoke.ts
 */

import {
  writeDst,
  readDst,
  writePes,
  readPes,
  writeExp,
  readExp,
  writeJef,
  readJef,
  writeVp3,
  readVp3,
  writeTbf,
  readTbf,
  writeHus,
  readHus,
  importMachineFile,
  autoDigitize,
  encodeStitchMovie,
  compileDesign,
  splitIntoHoops,
} from '../packages/embroidery-engine/src/index.js';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
}

async function req(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  // Both branches assign, so there is no sensible initial value to give it.
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  console.log(`\nSmoke test against ${BASE}\n`);

  // --- health ------------------------------------------------------------
  const health = await req('/api/health');
  check('health returns 200', health.status === 200, `got ${health.status}`);
  check('database connected', health.body?.database === 'connected', health.body?.database);

  // --- the editor itself is served from this origin ----------------------
  const index = await fetch(`${BASE}/`);
  const html = await index.text();
  check('index.html served', index.status === 200);
  check('bundle referenced', /assets\/index-[\w-]+\.js/.test(html));
  check(
    'no CDN references',
    !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(html.replace(/xmlns="[^"]*"/g, '')),
  );

  // --- seeded reference data --------------------------------------------
  // Reference endpoints answer with a `{ items: [...] }` envelope rather than
  // a bare array, so pagination has somewhere to live.
  const hoops = await req('/api/hoops');
  const hoopItems: any[] = hoops.body?.items ?? [];
  check('hoops listed', hoops.status === 200 && Array.isArray(hoops.body?.items));
  check('hoops seeded', hoopItems.length > 0, `${hoopItems.length} hoops`);

  const palettes = await req('/api/palettes');
  check(
    'palettes seeded',
    (palettes.body?.items?.length ?? 0) > 0,
    `${palettes.body?.items?.length ?? 0} palettes`,
  );

  const presets = await req('/api/presets');
  check(
    'digitizing presets seeded',
    (presets.body?.items?.length ?? 0) > 0,
    `${presets.body?.items?.length ?? 0} presets`,
  );

  // --- motif library ------------------------------------------------------
  // A motif is a shape a fill repeats or a carve presses in. The built-ins are
  // seeded, and a saved shape has to survive the round trip with its geometry
  // intact — a design that used it sews whatever comes back, not what was sent.
  const motifList = await req('/api/motifs');
  const motifItems: any[] = motifList.body?.items ?? [];
  check('motifs listed', motifList.status === 200 && Array.isArray(motifList.body?.items));
  check('motifs seeded', motifItems.length >= 5, `${motifItems.length} motifs`);
  check(
    'every motif carries a sewn-able outline',
    motifItems.every((m) => Array.isArray(m.data?.points) && m.data.points.length >= 3),
    `${motifItems.filter((m) => (m.data?.points?.length ?? 0) >= 3).length} of ${motifItems.length}`,
  );

  const shopShape = [
    { x: 0, y: -6 },
    { x: 6, y: 4 },
    { x: -6, y: 4 },
  ];
  const createdMotif = await req('/api/motifs', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Triangle', data: { points: shopShape } }),
  });
  check('a motif can be saved', createdMotif.status === 201, createdMotif.body?.id);
  check(
    'a saved motif keeps its exact shape',
    JSON.stringify(createdMotif.body?.data?.points) === JSON.stringify(shopShape),
    `${createdMotif.body?.data?.points?.length ?? 0} points`,
  );

  const renamedMotif = await req(`/api/motifs/${createdMotif.body?.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Smoke Renamed' }),
  });
  check(
    'a motif can be renamed without losing its shape',
    renamedMotif.status === 200 &&
      renamedMotif.body?.name === 'Smoke Renamed' &&
      JSON.stringify(renamedMotif.body?.data?.points) === JSON.stringify(shopShape),
    renamedMotif.body?.name,
  );

  // Half a shape cannot be sewn, so it has to be refused at the door rather
  // than stored and discovered on export.
  const brokenMotif = await req('/api/motifs', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Line', data: { points: shopShape.slice(0, 2) } }),
  });
  check('a motif of two points is refused', brokenMotif.status === 400);

  const builtinId = motifItems.find((m) => m.builtin)?.id;
  const deleteBuiltin = await req(`/api/motifs/${builtinId}`, { method: 'DELETE' });
  check(
    'a built-in motif cannot be deleted',
    deleteBuiltin.status === 409,
    `status ${deleteBuiltin.status}`,
  );

  const deleteMotif = await req(`/api/motifs/${createdMotif.body?.id}`, { method: 'DELETE' });
  check('a saved motif can be deleted', deleteMotif.status === 204);

  // --- project CRUD with optimistic concurrency --------------------------
  const design = {
    units: 'mm' as const,
    width: 180,
    height: 130,
    hoopId: hoopItems[0]?.id ?? null,
    objects: [],
    threadPalette: [],
  };

  const created = await req('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Test Design', design }),
  });
  check('project created', created.status === 201, `got ${created.status}`);
  const id = created.body?.id;
  const version = created.body?.version;
  check('project has id and starts at version 0', Boolean(id) && version === 0, `v${version}`);

  const list = await req('/api/projects');
  check(
    'project listed',
    list.status === 200 && (list.body?.items ?? []).some((p: any) => p.id === id),
  );

  const read = await req(`/api/projects/${id}`);
  check('project readable', read.status === 200 && read.body?.name === 'Smoke Test Design');
  check('design round-trips through storage', read.body?.design?.width === 180);

  const updated = await req(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      expectedVersion: version,
      name: 'Smoke Test Design v2',
      design,
    }),
  });
  check('project updated', updated.status === 200, `got ${updated.status}`);
  check('version incremented', updated.body?.version === 1, `v${updated.body?.version}`);

  const stale = await req(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion: 0, name: 'Stale write', design }),
  });
  check('stale write rejected with 409', stale.status === 409, `got ${stale.status}`);

  const readBack = await req(`/api/projects/${id}`);
  check(
    'conflict did not overwrite newer work',
    readBack.body?.name === 'Smoke Test Design v2',
    readBack.body?.name,
  );

  // --- design history and recent files ------------------------------------
  // A save only snapshots when the DESIGN actually differs, so the rename
  // above (which carried no design) deliberately left nothing to go back to.
  const stored = readBack.body?.design;
  const storedWidth = stored?.width;
  const changed = JSON.parse(JSON.stringify(stored));
  changed.width = storedWidth + 1;

  const edited = await req(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion: 1, design: changed }),
  });
  check('a design change saves', edited.status === 200, `got ${edited.status}`);
  check('design change bumps the version', edited.body?.version === 2, `v${edited.body?.version}`);

  const versions = await req(`/api/projects/${id}/versions`);
  check(
    'save snapshot recorded',
    versions.status === 200 && (versions.body?.total ?? 0) >= 1,
    `${versions.body?.total} version(s)`,
  );
  check(
    'version list omits the designs themselves',
    (versions.body?.items ?? []).every((v: any) => v.design === undefined),
  );

  const snapshotId = versions.body?.items?.[0]?.id;
  const snapshot = await req(`/api/projects/${id}/versions/${snapshotId}`);
  check(
    'snapshot holds the OUTGOING design',
    snapshot.status === 200 && snapshot.body?.design?.width === storedWidth,
    `width ${snapshot.body?.design?.width}, saved as ${storedWidth}`,
  );
  check(
    'snapshot is the state before the save, not after',
    snapshot.body?.design?.width !== changed.width,
    `${snapshot.body?.design?.width} != ${changed.width}`,
  );

  const checkpoint = await req(`/api/projects/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  check('manual checkpoint taken', checkpoint.status === 201, `got ${checkpoint.status}`);
  check(
    'manual checkpoint is named as one',
    checkpoint.body?.kind === 'manual',
    checkpoint.body?.kind,
  );

  const restored = await req(`/api/projects/${id}/versions/${snapshotId}/restore`, {
    method: 'POST',
  });
  check(
    'restore writes the snapshot back',
    restored.status === 200 && restored.body?.design?.width === storedWidth,
    `width ${restored.body?.design?.width}`,
  );

  const afterRestore = await req(`/api/projects/${id}/versions`);
  check(
    'restore checkpoints the state it replaced',
    afterRestore.body?.items?.[0]?.kind === 'restore',
    afterRestore.body?.items?.[0]?.kind,
  );

  const recents = await req('/api/recent');
  check(
    'opening a project files it under recent',
    recents.status === 200 && (recents.body?.items ?? []).some((r: any) => r.id === id),
    `${(recents.body?.items ?? []).length} entr(y/ies)`,
  );
  const clearedRecent = await req('/api/recent', { method: 'DELETE' });
  check('recent list can be cleared', clearedRecent.status === 204, `got ${clearedRecent.status}`);
  const emptyRecent = await req('/api/recent');
  check(
    'recent list is empty after clearing',
    emptyRecent.status === 200 && (emptyRecent.body?.items ?? []).length === 0,
    `${(emptyRecent.body?.items ?? []).length} entr(y/ies)`,
  );

  // --- validation rejects a malformed payload ----------------------------
  const bad = await req('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 42, width: 'wide' }),
  });
  check('malformed project rejected with 400', bad.status === 400, `got ${bad.status}`);

  // --- unknown route ------------------------------------------------------
  const missing = await req('/api/nope');
  check('unknown api route 404s', missing.status === 404, `got ${missing.status}`);

  // --- real DST round trip through the shipped engine ---------------------
  // Objects come from the editor's own factory, so the shape here is the shape
  // the app actually sends rather than a hand-rolled near-miss.
  const { createObject, rectangleRing } = await import('../client/src/model/defaults.js');

  const smokePalette = [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }];
  const compiled = compileDesign(
    [createObject('fill', [rectangleRing(20, 20, 60, 30)], 0, 0)],
    smokePalette,
    null,
  );

  check(
    'design compiles',
    compiled.sequence.stitches.length > 0,
    `${compiled.sequence.stitches.length} stitches`,
  );
  check(
    'no validation errors',
    compiled.validation.ok,
    `${compiled.validation.issues.length} issues`,
  );

  const bytes = writeDst(compiled.sequence.stitches, { colorCount: 1, name: 'Smoke' });
  check('DST encoded', bytes.length > 512, `${bytes.length} bytes`);

  const decoded = readDst(bytes);
  check('DST decodes', decoded.stitches.length > 0, `${decoded.stitches.length} records`);
  check(
    'decoded stitch count >= source',
    decoded.stitches.length >= compiled.sequence.stitches.length,
    `${decoded.stitches.length} vs ${compiled.sequence.stitches.length}`,
  );

  // --- PES: Brother container plus embedded PEC stitch block --------------
  const pesBytes = writePes(compiled.sequence.stitches, {
    colorCount: 1,
    name: 'Smoke',
    threads: [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }],
  });
  check('PES encoded', pesBytes.length > 1024, `${pesBytes.length} bytes`);

  const pes = readPes(pesBytes);
  check('PES decodes', pes.stitches.length > 0, `${pes.stitches.length} records`);
  const pesSew = pes.stitches.filter((s) => s.command === 'stitch').length;
  const sourceSew = compiled.sequence.stitches.filter((s) => s.command === 'stitch').length;
  check('PES keeps the sewing stitches', pesSew >= sourceSew, `${pesSew} vs ${sourceSew}`);

  // --- EXP: bare Melco stitch stream --------------------------------------
  const expBytes = writeExp(compiled.sequence.stitches);
  check(
    'EXP encoded',
    expBytes.length > 0 && expBytes.length % 2 === 0,
    `${expBytes.length} bytes`,
  );

  const exp = readExp(expBytes);
  check('EXP decodes', exp.stitches.length > 0, `${exp.stitches.length} records`);
  const expSew = exp.stitches.filter((s) => s.command === 'stitch').length;
  check('EXP keeps the sewing stitches', expSew >= sourceSew, `${expSew} vs ${sourceSew}`);

  // --- JEF: Janome file with a colour library and a hoop header ------------
  const jefBytes = writeJef(compiled.sequence.stitches, {
    threads: smokePalette,
    date: '20240101120000',
  });
  check('JEF encoded', jefBytes.length > 256, `${jefBytes.length} bytes`);

  const jef = readJef(jefBytes);
  check('JEF decodes', jef.stitches.length > 0, `${jef.stitches.length} records`);
  const jefSew = jef.stitches.filter((s) => s.command === 'stitch').length;
  check('JEF keeps the sewing stitches', jefSew >= sourceSew, `${jefSew} vs ${sourceSew}`);
  check(
    'JEF records a colour slot per block',
    jef.paletteIndices.length >= 1 && jef.paletteIndices.length <= compiled.sequence.colorCount,
    `${jef.paletteIndices.length} slots`,
  );
  // The header is what a machine reads first: the offset it points at has to
  // land inside the file, on the boundary where the records begin.
  const jefOffset = new DataView(jefBytes.buffer, jefBytes.byteOffset).getUint32(0, true);
  check(
    'JEF header points at its records',
    jefOffset >= 0x74 && jefOffset < jefBytes.length && jefOffset % 4 === 0,
    `offset ${jefOffset}`,
  );

  const jefOpened = importMachineFile(jefBytes, { filename: 'smoke-design.jef' });
  check('JEF re-imports', jefOpened.format === 'jef', jefOpened.format);
  check(
    'JEF import keeps the sewing order',
    jefOpened.stitches.filter((s) => s.command === 'stitch').length === jefSew,
    `${jefOpened.stitches.length} records`,
  );

  // --- VP3: tagged Husqvarna container with full thread metadata -----------
  const vp3Bytes = writeVp3(compiled.sequence.stitches, smokePalette);
  check('VP3 encoded', vp3Bytes.length > 256, `${vp3Bytes.length} bytes`);
  check(
    'VP3 opens with its magic',
    new TextDecoder().decode(vp3Bytes.subarray(0, 5)) === '%vsm%',
    'header read',
  );

  const vp3 = readVp3(vp3Bytes);
  check('VP3 decodes', vp3.stitches.length > 0, `${vp3.stitches.length} records`);
  const vp3Sew = vp3.stitches.filter((s) => s.command === 'stitch').length;
  check('VP3 keeps the sewing stitches', vp3Sew >= sourceSew, `${vp3Sew} vs ${sourceSew}`);
  check('VP3 carries thread colours', vp3.threads.length >= 1, `${vp3.threads.length} threads`);

  const vp3Opened = importMachineFile(vp3Bytes, { filename: 'smoke-design.vp3' });
  check('VP3 re-imports', vp3Opened.format === 'vp3', vp3Opened.format);
  check(
    'VP3 import keeps the colour blocks',
    vp3Opened.colorCount >= 1 && vp3Opened.colorCount <= compiled.sequence.colorCount,
    `${vp3Opened.colorCount} blocks`,
  );

  // --- TBF: fixed-offset header a loader reads by seek ---------------------
  const tbfBytes = writeTbf(compiled.sequence.stitches, smokePalette, 'Smoke Design');
  check('TBF encoded', tbfBytes.length > 0x600, `${tbfBytes.length} bytes`);
  const tbfRecord = String.fromCharCode(...tbfBytes.subarray(0, 4));
  check('TBF opens with its version banner', tbfRecord === '3.00', tbfRecord);

  const tbf = readTbf(tbfBytes);
  check('TBF decodes', tbf.stitches.length > 0, `${tbf.stitches.length} records`);
  const tbfSew = tbf.stitches.filter((s) => s.command === 'stitch').length;
  check('TBF keeps the sewing stitches', tbfSew >= sourceSew, `${tbfSew} vs ${sourceSew}`);
  check(
    'TBF terminates its records',
    tbfBytes[tbfBytes.length - 1] === 0x1a,
    `ends 0x${tbfBytes[tbfBytes.length - 1]!.toString(16)}`,
  );

  const tbfOpened = importMachineFile(tbfBytes, { filename: 'smoke-design.tbf' });
  check('TBF re-imports', tbfOpened.format === 'tbf', tbfOpened.format);
  check('TBF import names the design', tbfOpened.name === 'Smoke Design', tbfOpened.name);

  // --- HUS: compressed streams and a machine thread-library palette --------
  const husBytes = writeHus(compiled.sequence.stitches, smokePalette, 'Smoke Design');
  check('HUS encoded', husBytes.length > 64, `${husBytes.length} bytes`);

  const hus = readHus(husBytes);
  check('HUS decodes', hus.stitches.length > 0, `${hus.stitches.length} records`);
  const husSew = hus.stitches.filter((s) => s.command === 'stitch').length;
  check('HUS keeps the sewing stitches', husSew >= sourceSew, `${husSew} vs ${sourceSew}`);
  check(
    'HUS snaps threads onto the machine library',
    hus.threads.length >= 1 && hus.threads.every((t) => t.name !== ''),
    `${hus.threads.length} threads`,
  );

  const husOpened = importMachineFile(husBytes, { filename: 'smoke-design.hus' });
  check('HUS re-imports', husOpened.format === 'hus', husOpened.format);
  check(
    'HUS import keeps the colour blocks',
    husOpened.colorCount >= 1 && husOpened.colorCount <= compiled.sequence.colorCount,
    `${husOpened.colorCount} blocks`,
  );

  // --- auto-digitizing: raster image -> objects -> stitches ---------------
  const rasterWidth = 60;
  const rasterHeight = 30;
  const raster = new Uint8Array(rasterWidth * rasterHeight * 4);
  for (let y = 0; y < rasterHeight; y++) {
    for (let x = 0; x < rasterWidth; x++) {
      const o = (y * rasterWidth + x) * 4;
      const left = x < 30;
      raster[o] = left ? 200 : 40;
      raster[o + 1] = left ? 40 : 90;
      raster[o + 2] = left ? 60 : 200;
      raster[o + 3] = 255;
    }
  }

  const traced = autoDigitize(
    { width: rasterWidth, height: rasterHeight, data: raster },
    { colorCount: 4, widthMm: 60 },
  );
  check(
    'image traces into regions',
    traced.regions.length >= 2,
    `${traced.regions.length} regions`,
  );
  check(
    'traced palette has a colour per region colour',
    traced.palette.length >= 2,
    `${traced.palette.length} colours`,
  );

  const tracedObjects = traced.regions.map((region, index) => {
    const obj = createObject('fill', region.rings, region.colorIndex, index);
    return { ...obj, params: { ...obj.params, angle: region.angleDeg } };
  });
  const tracedCompiled = compileDesign(tracedObjects, traced.palette, null);
  check(
    'traced design compiles',
    tracedCompiled.sequence.stitches.length > 0,
    `${tracedCompiled.sequence.stitches.length} stitches`,
  );
  check(
    'traced design validates',
    tracedCompiled.validation.issues.filter((i) => i.severity === 'error').length === 0,
    `${tracedCompiled.validation.issues.length} issues`,
  );
  check(
    'traced design exports as DST',
    writeDst(tracedCompiled.sequence.stitches, { name: 'Traced', colorCount: 2 }).length > 512,
    'encoded',
  );

  // --- stitch movie: stitches -> frames -> GIF ----------------------------
  const movie = encodeStitchMovie(tracedCompiled.sequence.stitches, {
    size: 160,
    fps: 10,
    threads: traced.palette,
    maxFrames: 30,
  });
  check('stitch movie renders', movie.bytes.length > 1000, `${movie.bytes.length} bytes`);
  check('stitch movie has frames', movie.frames > 1, `${movie.frames} frames`);
  check(
    'stitch movie is a GIF89a',
    String.fromCharCode(...movie.bytes.slice(0, 6)) === 'GIF89a',
    'header',
  );
  check(
    'stitch movie ends with the GIF trailer',
    movie.bytes[movie.bytes.length - 1] === 0x3b,
    `0x${movie.bytes[movie.bytes.length - 1]!.toString(16)}`,
  );

  // --- machine file import: bytes a client sends -> preview -> convert -----

  // What a client would attach: a Brother PES file.
  const clientFile = writePes(compiled.sequence.stitches, {
    name: 'CLIENTLOGO',
    colorCount: smokePalette.length,
    threads: smokePalette,
  });
  const opened = importMachineFile(clientFile, { filename: 'client-logo.pes' });
  check('PES import detected', opened.format === 'pes', opened.format);
  check(
    'PES import recovers stitch positions',
    opened.stitches.length > 0,
    `${opened.stitches.length} records`,
  );
  check(
    'PES import recovers Brother thread colours',
    opened.paletteIsPlaceholder === false && opened.palette.length === opened.colorCount,
    `${opened.colorCount} colours, placeholder=${opened.paletteIsPlaceholder}`,
  );

  // Convert it to a Tajima DST, the format the shop's machine actually wants.
  const converted = writeDst(opened.stitches, {
    name: opened.name,
    colorCount: opened.colorCount,
  });
  const roundTrip = importMachineFile(converted, { filename: 'client-logo.dst' });
  check('converted DST re-imports', roundTrip.format === 'dst', roundTrip.format);
  check(
    'conversion keeps the sewing order',
    roundTrip.stitches.filter((s) => s.command === 'stitch').length ===
      opened.stitches.filter((s) => s.command === 'stitch').length,
    `${roundTrip.stitches.length} vs ${opened.stitches.length} records`,
  );

  // A standalone PEC (no PES container) is a separate format clients send.
  const pecSignature = Array.from('#PEC0001').map((c) => c.charCodeAt(0));
  const pecOffset =
    clientFile[8]! |
    (clientFile[9]! << 8) |
    (clientFile[10]! << 16) |
    ((clientFile[11]! << 24) >>> 0);
  const standalone = Uint8Array.from([...pecSignature, ...clientFile.slice(pecOffset)]);
  const pecOpened = importMachineFile(standalone, { filename: 'client-logo.pec' });
  check('standalone PEC import', pecOpened.format === 'pec', pecOpened.format);

  // Garbage must be rejected with an explanation, not accepted silently.
  let junkRejected = false;
  try {
    importMachineFile(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), { filename: 'photo.png' });
  } catch {
    junkRejected = true;
  }
  check('non-machine file rejected', junkRejected, 'ImportError expected');

  // --- 3D foam: a satin column sewn over a foam sheet ----------------------

  // A straight satin column, the shape foam is actually used on.
  const railA = [];
  const railB = [];
  for (let i = 0; i <= 12; i++) {
    const x = 20 + (i / 12) * 40;
    railA.push({ x, y: 30 });
    railB.push({ x, y: 36 });
  }
  const column = createObject('column', [railA, railB], 0, 0);
  const flat = compileDesign([column], smokePalette, null);

  const foamColumn = {
    ...column,
    params: {
      ...column.params,
      foam: { enabled: true, thicknessMm: 2, tackUnderlay: true },
    },
  };
  const puff = compileDesign([foamColumn], smokePalette, null);

  check(
    'foam column compiles',
    puff.sequence.stitches.length > 0,
    `${puff.sequence.stitches.length} stitches`,
  );
  check('foam column validates', puff.validation.ok, `${puff.validation.issues.length} issues`);
  check(
    'foam sews denser than flat',
    puff.sequence.stitches.length > flat.sequence.stitches.length,
    `${puff.sequence.stitches.length} vs ${flat.sequence.stitches.length}`,
  );

  const flatYs = flat.sequence.stitches.map((s) => s.y);
  const foamYs = puff.sequence.stitches.map((s) => s.y);
  const flatSpan = Math.max(...flatYs) - Math.min(...flatYs);
  const foamSpan = Math.max(...foamYs) - Math.min(...foamYs);
  check(
    'foam column pulls wider to wrap the edge',
    foamSpan > flatSpan,
    `${foamSpan.toFixed(2)} vs ${flatSpan.toFixed(2)} mm`,
  );

  // The whole point: it still exports as a real machine file.
  const foamBytes = writeDst(puff.sequence.stitches, { colorCount: 1, name: 'Puff' });
  check('foam design exports as DST', foamBytes.length > 512, `${foamBytes.length} bytes`);

  // --- carving stamp: a texture pressed into a fill -------------------------

  const plainFill = createObject('fill', [rectangleRing(20, 20, 60, 50)], 0, 0);
  const plainCompiled = compileDesign([plainFill], smokePalette, null);

  const carvedFill = {
    ...plainFill,
    params: {
      ...plainFill.params,
      carve: {
        enabled: true,
        pattern: 'diamond' as const,
        spacing: 6,
        scale: 3,
        rotation: 0,
        outline: true,
      },
    },
  };
  const carvedCompiled = compileDesign([carvedFill], smokePalette, null);

  check(
    'carved fill compiles',
    carvedCompiled.sequence.stitches.length > 0,
    `${carvedCompiled.sequence.stitches.length} stitches`,
  );
  check(
    'carved fill validates',
    carvedCompiled.validation.ok,
    `${carvedCompiled.validation.issues.length} issues`,
  );
  check(
    'carving removes fill stitches',
    carvedCompiled.sequence.stitches.length < plainCompiled.sequence.stitches.length,
    `${carvedCompiled.sequence.stitches.length} vs ${plainCompiled.sequence.stitches.length}`,
  );

  // Still a real machine file after the texture is punched through it.
  const carveBytes = writeDst(carvedCompiled.sequence.stitches, { colorCount: 1, name: 'Carved' });
  check('carved fill exports as DST', carveBytes.length > 512, `${carveBytes.length} bytes`);

  // --- multi-hoop splitting -----------------------------------------------
  // The real hoop library off the server, mapped into the engine's shape.
  const engineHoops = hoopItems.map((h: any) => ({
    id: h.id,
    name: h.name,
    width: h.data.width,
    height: h.data.height,
    shape: h.data.shape,
    safeMargin: h.data.safeMargin,
  }));

  // A run of squares spread across ~440 mm - wider than every seeded hoop.
  const wideObjects = [
    createObject('fill', [rectangleRing(10, 20, 60, 40)], 0, 0),
    createObject('fill', [rectangleRing(180, 20, 60, 40)], 1, 1),
    createObject('fill', [rectangleRing(360, 20, 60, 40)], 2, 2),
  ];
  const wideCompiled = compileDesign(wideObjects, smokePalette, null);

  try {
    const split = splitIntoHoops(wideCompiled.sequence, engineHoops);

    check(
      'wide design splits into multiple hoopings',
      split.sections.length > 1,
      `${split.sections.length} sections in "${split.hoop.name}"`,
    );
    check(
      'split picks one hoop for every section',
      split.sections.every((s) => s.hoop.id === split.hoop.id),
      split.hoop.name,
    );

    // Each section must decode from a real DST and fit its own hoop.
    let allFit = true;
    let allDecode = true;
    for (const section of split.sections) {
      const bytes = writeDst(section.stitches, { colorCount: section.colorCount, name: 'Part' });
      if (readDst(bytes).stitches.length === 0) allDecode = false;
      const m = section.hoop.safeMargin;
      if (
        section.bounds.minX < m - 0.01 ||
        section.bounds.minY < m - 0.01 ||
        section.bounds.maxX > section.hoop.width - m + 0.01 ||
        section.bounds.maxY > section.hoop.height - m + 0.01
      ) {
        allFit = false;
      }
    }
    check('every section encodes as a DST', allDecode);
    check('every section fits inside its hoop safe area', allFit);

    // The sections must tile the source exactly: no stitch lost, none twice.
    let cursor = 0;
    let tiled = true;
    for (const section of split.sections) {
      if (section.source.start !== cursor) tiled = false;
      cursor = section.source.end;
    }
    check(
      'sections tile the design with no gaps or overlaps',
      tiled && cursor === wideCompiled.sequence.stitches.length,
    );

    // --- a shared band at every join ---------------------------------------
    const overlapped = splitIntoHoops(wideCompiled.sequence, engineHoops, { overlap: 10 });
    let sharedBand = overlapped.sections.length > 1;
    let bandTooDeep = false;
    for (let i = 1; i < overlapped.sections.length; i++) {
      const prev = overlapped.sections[i - 1]!.source;
      const cur = overlapped.sections[i]!.source;
      // The next section must open before this one stopped, but never on or
      // before where it began, or the split would stop walking forward.
      if (cur.start >= prev.end || cur.start < prev.start + 1) sharedBand = false;
      const band = wideCompiled.sequence.stitches.slice(cur.start, prev.end).map((s) => s.x);
      if (band.length === 0 || Math.max(...band) - Math.min(...band) > 10.01) bandTooDeep = true;
    }
    check(
      'overlapping split shares a band between consecutive sections',
      sharedBand,
      `${overlapped.sections.length} sections`,
    );
    check('the shared band is no deeper than the overlap asked for', !bandTooDeep, '10 mm');

    let overlapStillFits = true;
    for (const section of overlapped.sections) {
      const m = section.hoop.safeMargin;
      if (
        !section.validation.ok ||
        section.bounds.minX < m - 0.01 ||
        section.bounds.minY < m - 0.01 ||
        section.bounds.maxX > section.hoop.width - m + 0.01 ||
        section.bounds.maxY > section.hoop.height - m + 0.01
      ) {
        overlapStillFits = false;
      }
    }
    check('overlapping sections still fit their hoop', overlapStillFits);

    // --- registration crosses at every join ---------------------------------
    const marked = splitIntoHoops(wideCompiled.sequence, engineHoops, {
      registrationMarks: true,
    });

    /** Design-space centres of the crosses in one section. */
    function crosses(section: (typeof marked.sections)[number]): { x: number; y: number }[] {
      const found: { x: number; y: number }[] = [];
      const c = section.stitches;
      for (let i = 0; i + 3 < c.length; i++) {
        if (
          c[i]!.command !== 'jump' ||
          c[i + 1]!.command !== 'stitch' ||
          c[i + 2]!.command !== 'jump' ||
          c[i + 3]!.command !== 'stitch'
        ) {
          continue;
        }
        const [a, b, d, e] = [c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!];
        if (!(a.y === b.y && b.x > a.x)) continue;
        if (!(d.x === e.x && e.y > d.y)) continue;
        const hx = (a.x + b.x) / 2;
        const hy = (a.y + b.y) / 2;
        if (Math.abs(hx - (d.x + e.x) / 2) > 1e-9 || Math.abs(hy - (d.y + e.y) / 2) > 1e-9)
          continue;
        // Undo this section's own translation: the two halves sit at
        // different coordinates in their files by design.
        found.push({ x: hx - section.offset.x, y: hy - section.offset.y });
      }
      return found;
    }

    const perSection = marked.sections.map(crosses);
    // First section only ends on a join, last only begins one, the rest have
    // one each side. n sections therefore have n-1 joins, and every join
    // contributes a cross to BOTH files: 2(n-1) in total.
    const expectedCrosses = (perSection.length - 1) * 2;
    const actualCrosses = perSection.reduce((n, list) => n + list.length, 0);
    check(
      'every join is crossed on both sides',
      marked.sections.length > 1 && actualCrosses === expectedCrosses,
      `${actualCrosses} of ${expectedCrosses} crosses`,
    );

    let inRegister = true;
    for (let i = 0; i + 1 < perSection.length; i++) {
      const ending = perSection[i]![perSection[i]!.length - 1]!;
      const starting = perSection[i + 1]![0]!;
      if (Math.abs(ending.x - starting.x) > 1e-6 || Math.abs(ending.y - starting.y) > 1e-6) {
        inRegister = false;
      }
    }
    check('the two halves of each join carry the cross at one design coordinate', inRegister);

    let marksFit = true;
    for (const section of marked.sections) {
      const m = section.hoop.safeMargin;
      if (
        !section.validation.ok ||
        section.bounds.minX < m - 0.01 ||
        section.bounds.maxY > section.hoop.height - m + 0.01
      ) {
        marksFit = false;
      }
      const bytes = writeDst(section.stitches, { colorCount: section.colorCount, name: 'Marked' });
      if (readDst(bytes).stitches.length === 0) marksFit = false;
    }
    check('marked sections still fit and encode as a DST', marksFit);

    // A design that fits comes back as a single, untouched section.
    const small = splitIntoHoops(plainCompiled.sequence, engineHoops);
    check(
      'a fitting design is a single section',
      small.sections.length === 1 &&
        small.sections[0]!.offset.x === 0 &&
        small.sections[0]!.offset.y === 0,
      `${small.sections.length} section(s)`,
    );
  } catch (err) {
    check(
      'wide design splits into multiple hoopings',
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Cleanup so repeated runs do not accumulate documents.
  if (id) {
    const removed = await req(`/api/projects/${id}`, { method: 'DELETE' });
    check(
      'project deleted',
      removed.status === 204 || removed.status === 200,
      `got ${removed.status}`,
    );
    const gone = await req(`/api/projects/${id}`);
    check('deleted project is gone', gone.status === 404, `got ${gone.status}`);
  }

  console.log(
    failures === 0 ? '\nAll smoke checks passed.\n' : `\n${failures} smoke check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test could not run:', err);
  process.exit(1);
});
