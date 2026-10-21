import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * API integration tests.
 *
 * These run against the real local MongoDB rather than a mock. Mocking the
 * driver would only prove that the router can talk to the mock - it would not
 * catch a wrong collection name, a missing index, or a query that the actual
 * server rejects. `vitest.config.ts` raises the timeout for first-run index
 * creation.
 */

const TEST_DB = 'embroidery_studio_test';

let app: Express;
let disconnect: () => Promise<void>;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Point at a dedicated database so these tests cannot touch real designs.
  process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${TEST_DB}`;

  const { connectDb, ensureIndexes, disconnectDb } = await import('../db/mongo.js');
  const db = await connectDb(process.env.MONGODB_URI);
  await ensureIndexes(db);
  // Start from a known state each run.
  await db.dropDatabase();

  const { createApp } = await import('../app.js');
  app = createApp();
  disconnect = disconnectDb;
}, 30_000);

afterAll(async () => {
  if (disconnect) {
    const { getDb } = await import('../db/mongo.js');
    try {
      await getDb().dropDatabase();
    } catch {
      // Database may already be gone; closing is what matters.
    }
    await disconnect();
  }
});

function sampleDesign() {
  return {
    units: 'mm',
    width: 100,
    height: 80,
    hoopId: null,
    objects: [
      {
        id: 'obj-1',
        name: 'Square',
        type: 'fill',
        path: {
          rings: [
            [
              { x: 0, y: 0 },
              { x: 40, y: 0 },
              { x: 40, y: 40 },
              { x: 0, y: 40 },
            ],
          ],
        },
        transform: { x: 0, y: 0 },
        colorIndex: 0,
        params: {
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
        },
        entryExit: { entry: null, exit: null },
        order: 0,
        locked: false,
        hidden: false,
        groupId: null,
        warnings: [],
      },
    ],
    threadPalette: [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }],
  };
}

describe('GET /api/health', () => {
  it('reports a real database connection', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(res.body.databaseMode).toBe('local');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('exposes no x-powered-by header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('projects', () => {
  it('creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Test Design', design: sampleDesign() });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.name).toBe('Test Design');
    expect(res.body.version).toBe(0);
    expect(res.body.summary.objectCount).toBe(1);
  });

  it('rejects a project with no name', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: '   ', design: sampleDesign() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('strips the placement flags older saves carried', async () => {
    // Flip, scale and rotate are baked into the path by the editor, so the
    // model only carries a position. A design saved by an older build - before
    // that was settled - must still load, with the dead values dropped rather
    // than stored back as if they still meant something.
    const legacy = sampleDesign();
    const design = {
      ...legacy,
      objects: legacy.objects.map((o) => ({
        ...o,
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, flipX: false },
      })),
    };

    const created = await request(app).post('/api/projects').send({ name: 'Legacy', design });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/projects/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.design.objects[0].transform).toEqual({ x: 0, y: 0 });
  });

  it('rejects a non-finite coordinate', async () => {
    const design = sampleDesign();
    design.objects[0]!.path.rings[0]![0] = { x: Number.NaN, y: 0 };

    const res = await request(app).post('/api/projects').send({ name: 'NaN', design });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects maxStitchLength beyond the machine limit', async () => {
    const design = sampleDesign();
    design.objects[0]!.params.maxStitchLength = 50;

    const res = await request(app).post('/api/projects').send({ name: 'Too long', design });
    expect(res.status).toBe(400);
  });

  it('accepts the optional foam and carve settings', async () => {
    const design = sampleDesign();
    design.objects[0]!.params.foam = { enabled: true, thicknessMm: 3, tackUnderlay: true };
    design.objects[0]!.params.carve = {
      enabled: true,
      pattern: 'star',
      spacing: 5,
      scale: 4,
      rotation: 15,
      outline: true,
    };

    const res = await request(app).post('/api/projects').send({ name: 'Effects', design });
    expect(res.status).toBe(201);
  });

  it('accepts applique settings and refuses a width the engine would reject', async () => {
    const patch = {
      enabled: true,
      mode: 'full' as const,
      placement: true,
      tack: 'zigzag' as const,
      tackWidth: 4,
      tackSpacing: 1,
      finish: 'satin' as const,
      finishWidth: 4,
      finishSpacing: 0.4,
      finishOffset: 0,
      fill: false,
      start: 0,
      length: 1,
    };

    const design = sampleDesign();
    (design.objects[0]!.params as Record<string, unknown>).applique = patch;
    const created = await request(app).post('/api/projects').send({ name: 'Patch', design });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/projects/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.design.objects[0].params.applique).toEqual(patch);

    const bad = sampleDesign();
    (bad.objects[0]!.params as Record<string, unknown>).applique = { ...patch, finishWidth: 0 };
    const refused = await request(app)
      .post('/api/projects')
      .send({ name: 'Bad patch', design: bad });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts photo stitch settings and refuses an impossible density', async () => {
    const design = sampleDesign();
    (design.objects[0]!.params as Record<string, unknown>).photo = {
      enabled: true,
      style: 'satin',
      spacing: 0.4,
    };

    const created = await request(app).post('/api/projects').send({ name: 'Photo', design });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/projects/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.design.objects[0].params.photo).toEqual({
      enabled: true,
      style: 'satin',
      spacing: 0.4,
    });

    const bad = sampleDesign();
    (bad.objects[0]!.params as Record<string, unknown>).photo = {
      enabled: true,
      style: 'satin',
      spacing: 5,
    };
    const refused = await request(app)
      .post('/api/projects')
      .send({ name: 'Bad photo', design: bad });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a carve stamp this build does not ship', async () => {
    const design = sampleDesign();
    design.objects[0]!.params.carve = {
      enabled: true,
      pattern: 'spiral' as unknown as 'diamond',
      spacing: 5,
      scale: 4,
      rotation: 0,
      outline: true,
    };

    const res = await request(app).post('/api/projects').send({ name: 'Bad stamp', design });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('round-trips a lettering spec so saved text keeps its layout', async () => {
    // Lettering geometry comes from its spec, not from its path. If the spec
    // were dropped in transit, a saved design would reopen as the default
    // "TEXT" - so the whole spec, advanced layouts included, must survive.
    const base = sampleDesign();
    const lettering = {
      text: 'ABC',
      height: 25,
      spacing: 0.5,
      slant: 10,
      rotation: 15,
      width: 1.5,
      stretch: 1.4,
      mirror: { x: true, y: false },
      onPath: {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        upright: false,
        offsetMm: 2,
        align: 'center',
      },
      monogram: { enabled: true, frame: 'oval', mirrorSides: true, frameWidth: 2 },
      drop: { enabled: false, index: 0, scale: 1.6 },
      order: 'insideOut',
    };
    const text = {
      id: 'text-1',
      name: 'Text "ABC"',
      type: 'lettering',
      path: { rings: [] },
      transform: { x: 10, y: 20 },
      colorIndex: 1,
      // The same stitch parameters as the square: the object schema does not
      // care which generator the type implies.
      params: base.objects[0]!.params,
      entryExit: { entry: null, exit: null },
      order: 1,
      locked: false,
      hidden: false,
      groupId: null,
      warnings: [],
      lettering,
    };
    base.objects.push(text as (typeof base.objects)[number]);

    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Lettering', design: base });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/projects/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.design.objects[1].lettering).toEqual(lettering);
    // A plain shape carries no spec, and gets an explicit null back.
    expect(fetched.body.design.objects[0].lettering).toBeNull();

    const bad = sampleDesign();
    bad.objects.push({
      ...text,
      id: 'text-2',
      lettering: { ...lettering, height: 5000 },
    } as (typeof bad.objects)[number]);
    const refused = await request(app)
      .post('/api/projects')
      .send({ name: 'Bad text', design: bad });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts every advanced fill pattern and refuses an unknown one', async () => {
    // fillPattern is the whole point of the advanced fills: if a value were
    // dropped or renamed in transit, a saved design would reopen as tatami
    // and the client would sew a different texture than the one picked.
    const patterns = [
      'motif',
      'contour',
      'spiral',
      'programmedSplit',
      'accordion',
      'florentine',
      'liquid',
      'maze',
      'string',
      'laydown',
      'stipple',
      'cross',
      'shading',
      'hand',
      'jagged',
      'warp',
      'flexiSplit',
    ];

    for (const pattern of patterns) {
      const design = sampleDesign();
      design.objects[0]!.params = { ...design.objects[0]!.params, fillPattern: pattern };
      const created = await request(app)
        .post('/api/projects')
        .send({ name: `Fill ${pattern}`, design });
      expect(created.status, pattern).toBe(201);

      const fetched = await request(app).get(`/api/projects/${created.body.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.design.objects[0].params.fillPattern, pattern).toBe(pattern);
    }

    const bad = sampleDesign();
    bad.objects[0]!.params = { ...bad.objects[0]!.params, fillPattern: 'plaid' };
    const refused = await request(app)
      .post('/api/projects')
      .send({ name: 'Bad fill', design: bad });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('round-trips the motif layout, gradient and user-defined split', async () => {
    // These three decide how a motif is sewn and how a split fill breaks. If
    // any were dropped in transit, a saved design would reopen as a plain
    // gridded fill with the built-in split - a different sew-out than the one
    // on screen.
    const base = sampleDesign();
    base.objects[0]!.params = {
      ...base.objects[0]!.params,
      stitchType: 'motif',
      motifMode: 'column',
      motifGradient: { scaleFrom: 0.6, scaleTo: 1.6, angleFrom: -30, angleTo: 45 },
      customSplit: { segmentLength: 7, gap: 1.2, stagger: 0.25 },
    };
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Motif modes', design: base });
    expect(created.status).toBe(201);

    const fetched = await request(app).get(`/api/projects/${created.body.id}`);
    expect(fetched.status).toBe(200);
    const params = fetched.body.design.objects[0].params;
    expect(params.motifMode).toBe('column');
    expect(params.motifGradient).toEqual({
      scaleFrom: 0.6,
      scaleTo: 1.6,
      angleFrom: -30,
      angleTo: 45,
    });
    expect(params.customSplit).toEqual({ segmentLength: 7, gap: 1.2, stagger: 0.25 });

    const bad = sampleDesign();
    bad.objects[0]!.params = {
      ...bad.objects[0]!.params,
      customSplit: { segmentLength: 7, gap: 1.2, stagger: 2 },
    };
    const refused = await request(app)
      .post('/api/projects')
      .send({ name: 'Bad split', design: bad });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('loads a project saved before foam and carve existed', async () => {
    // Neither field present: absent means flat / plain fill, as always.
    const design = sampleDesign();
    expect(design.objects[0]!.params.foam).toBeUndefined();
    expect(design.objects[0]!.params.carve).toBeUndefined();

    const res = await request(app).post('/api/projects').send({ name: 'Legacy', design });
    expect(res.status).toBe(201);
  });

  it('lists and searches projects', async () => {
    await request(app).post('/api/projects').send({ name: 'Alpha', design: sampleDesign() });
    await request(app).post('/api/projects').send({ name: 'Beta', design: sampleDesign() });

    const all = await request(app).get('/api/projects');
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    // A library row carries metadata only. Sending every design made the list
    // response grow with the library and could exceed a hosted body limit.
    expect(all.body.items[0]).not.toHaveProperty('design');
    expect(all.body.items[0]?.summary?.objectCount).toBe(1);

    const found = await request(app).get('/api/projects').query({ search: 'Alph' });
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].name).toBe('Alpha');
  });

  it('reads a project back with its design intact', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Round trip', design: sampleDesign() });

    const res = await request(app).get(`/api/projects/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.design.objects).toHaveLength(1);
    expect(res.body.design.objects[0].path.rings[0]).toHaveLength(4);
  });

  it('404s on a missing project', async () => {
    const res = await request(app).get('/api/projects/000000000000000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id instead of reaching the driver', async () => {
    const res = await request(app).get('/api/projects/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('increments the version on every save', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Versioned', design: sampleDesign() });
    const id = created.body.id;

    const first = await request(app)
      .put(`/api/projects/${id}`)
      .send({ name: 'Versioned v1', expectedVersion: 0 });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(1);

    const second = await request(app)
      .put(`/api/projects/${id}`)
      .send({ name: 'Versioned v2', expectedVersion: 1 });
    expect(second.body.version).toBe(2);
  });

  it('rejects a save based on a stale version', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Conflict', design: sampleDesign() });
    const id = created.body.id;

    await request(app).put(`/api/projects/${id}`).send({ expectedVersion: 0 });

    // Another client still holds version 0.
    const stale = await request(app)
      .put(`/api/projects/${id}`)
      .send({ name: 'Clobbered', expectedVersion: 0 });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.error.details.currentVersion).toBe(1);
  });

  it('deletes a project', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Doomed', design: sampleDesign() });

    const del = await request(app).delete(`/api/projects/${created.body.id}`);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/projects/${created.body.id}`);
    expect(after.status).toBe(404);
  });
});

describe('design history and recent files', () => {
  /** A design differs from `sampleDesign` only in a way a save would notice. */
  function changedDesign(label: string) {
    const d = sampleDesign();
    d.objects[0]!.name = label;
    return d;
  }

  let historyId = '';

  it('snapshots the OUTGOING design when a save actually changes it', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'History', design: sampleDesign() });
    historyId = created.body.id;

    const saved = await request(app)
      .put(`/api/projects/${historyId}`)
      .send({ expectedVersion: 0, design: changedDesign('Second') });

    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(1);

    const list = await request(app).get(`/api/projects/${historyId}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const entry = list.body.items[0];
    expect(entry.kind).toBe('auto');
    expect(entry.summary.objectCount).toBe(1);
    // The snapshot has to be what was there BEFORE the save - the design the
    // user is asking to get back - not a copy of what they just lost.
    const full = await request(app).get(`/api/projects/${historyId}/versions/${entry.id}`);
    expect(full.body.design.objects[0].name).toBe('Square');
  });

  it('does not snapshot a save that changed nothing', async () => {
    const before = (await request(app).get(`/api/projects/${historyId}/versions`)).body.total;

    // Renaming alone carries no design, so there is nothing to roll back to.
    const res = await request(app)
      .put(`/api/projects/${historyId}`)
      .send({ name: 'Renamed', expectedVersion: 1 });
    expect(res.status).toBe(200);

    const after = (await request(app).get(`/api/projects/${historyId}/versions`)).body.total;
    expect(after).toBe(before);
  });

  it('stamps the project version the snapshot belongs to', async () => {
    await request(app)
      .put(`/api/projects/${historyId}`)
      .send({ expectedVersion: 2, design: changedDesign('Third') });

    const list = await request(app).get(`/api/projects/${historyId}/versions`);
    const entry = list.body.items[0];
    // projectVersion is the counter BEFORE this save, so the entry names the
    // state it represents rather than the one it produced.
    expect(entry.projectVersion).toBe(2);
  });

  it('takes a manual checkpoint of the stored design', async () => {
    const res = await request(app).post(`/api/projects/${historyId}/versions`).send({});
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('manual');
    expect(res.body.design.objects[0].name).toBe('Third');
  });

  it('lists history newest first, without shipping every design', async () => {
    const list = await request(app).get(`/api/projects/${historyId}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(3);
    expect(list.body.items[0].design).toBeUndefined();
    const times = list.body.items.map((i: { createdAt: string }) => Date.parse(i.createdAt));
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeLessThanOrEqual(times[i - 1]!);
  });

  it('restores a snapshot over the project and keeps a way back', async () => {
    const list = await request(app).get(`/api/projects/${historyId}/versions`);
    // The oldest entry is the original 'Square'.
    const oldest = list.body.items[list.body.items.length - 1];

    const restored = await request(app).post(
      `/api/projects/${historyId}/versions/${oldest.id}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.design.objects[0].name).toBe('Square');
    expect(restored.body.version).toBe(4);

    // Restoring is itself an edit, so the state it replaced was checkpointed
    // first - pressing Restore on the wrong entry is undoable.
    const after = await request(app).get(`/api/projects/${historyId}/versions`);
    expect(after.body.items[0].kind).toBe('restore');
    // The list carries metadata only; the design comes back on its own read.
    expect(after.body.items[0].design).toBeUndefined();

    const checkpoint = await request(app).get(
      `/api/projects/${historyId}/versions/${after.body.items[0].id}`,
    );
    expect(checkpoint.body.design.objects[0].name).toBe('Third');
  });

  it('deletes a single snapshot', async () => {
    const list = await request(app).get(`/api/projects/${historyId}/versions`);
    const before = list.body.total;

    const del = await request(app).delete(
      `/api/projects/${historyId}/versions/${list.body.items[0].id}`,
    );
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/projects/${historyId}/versions`);
    expect(after.body.total).toBe(before - 1);
  });

  it('404s a version belonging to another project', async () => {
    const other = await request(app)
      .post('/api/projects')
      .send({ name: 'Other', design: sampleDesign() });
    await request(app)
      .put(`/api/projects/${other.body.id}`)
      .send({ expectedVersion: 0, design: changedDesign('Other edit') });

    const theirs = await request(app).get(`/api/projects/${other.body.id}/versions`);
    expect(theirs.body.total).toBe(1);
    const theirsId = theirs.body.items[0].id;

    // Looking up a real id under the wrong project must still miss: a history
    // that leaks across projects would be a way to read someone else's file.
    const res = await request(app).get(`/api/projects/${historyId}/versions/${theirsId}`);
    expect(res.status).toBe(404);

    const mine = await request(app).get(`/api/projects/${other.body.id}/versions/${theirsId}`);
    expect(mine.status).toBe(200);
  });

  it('rejects a malformed version id as a 400, not a driver 500', async () => {
    const res = await request(app).get(`/api/projects/${historyId}/versions/not-an-id`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });

  it('opens a project straight into the recent list', async () => {
    await request(app).get(`/api/projects/${historyId}`);

    const recents = await request(app).get('/api/recent');
    expect(recents.status).toBe(200);
    const hit = recents.body.items.find((r: { id: string }) => r.id === historyId);
    expect(hit).toBeDefined();
    expect(hit.summary.objectCount).toBe(1);
    expect(typeof Date.parse(hit.openedAt)).toBe('number');
  });

  it('re-opening moves one entry up rather than adding a second', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Twice', design: sampleDesign() });
    await request(app).get(`/api/projects/${created.body.id}`);
    await request(app).get(`/api/projects/${created.body.id}`);

    const recents = await request(app).get('/api/recent');
    const hits = recents.body.items.filter((r: { id: string }) => r.id === created.body.id);
    expect(hits).toHaveLength(1);
  });

  it('forgets one recent entry, and the whole list', async () => {
    const one = await request(app).delete(`/api/recent/${historyId}`);
    expect(one.status).toBe(204);

    const after = await request(app).get('/api/recent');
    expect(after.body.items.some((r: { id: string }) => r.id === historyId)).toBe(false);

    const all = await request(app).delete('/api/recent');
    expect(all.status).toBe(204);

    const empty = await request(app).get('/api/recent');
    expect(empty.body.items).toHaveLength(0);
  });
});

describe('hoop presets', () => {
  it('creates and lists hoops', async () => {
    const created = await request(app)
      .post('/api/hoops')
      .send({
        name: '100 x 100',
        data: { width: 100, height: 100, shape: 'rect', safeMargin: 4 },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.width).toBe(100);

    const list = await request(app).get('/api/hoops');
    expect(list.status).toBe(200);
    expect(list.body.items.some((h: { name: string }) => h.name === '100 x 100')).toBe(true);
  });

  it('rejects an implausibly small hoop', async () => {
    const res = await request(app)
      .post('/api/hoops')
      .send({
        name: 'Tiny',
        data: { width: 2, height: 2, shape: 'rect', safeMargin: 0 },
      });
    expect(res.status).toBe(400);
  });

  it('rejects a hoop missing its payload', async () => {
    const res = await request(app).post('/api/hoops').send({ name: 'No data' });
    expect(res.status).toBe(400);
  });
});

describe('thread palettes', () => {
  it('rejects an invalid hex colour', async () => {
    const res = await request(app)
      .post('/api/palettes')
      .send({
        name: 'Bad',
        data: [{ id: 'c1', code: '1', name: 'X', hex: 'red' }],
      });
    expect(res.status).toBe(400);
  });

  it('accepts a valid palette and lists it', async () => {
    const created = await request(app)
      .post('/api/palettes')
      .send({
        name: 'Primary',
        data: [{ id: 'c1', code: '1001', name: 'Red', hex: '#C8102E' }],
      });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/palettes');
    expect(list.body.items.some((p: { name: string }) => p.name === 'Primary')).toBe(true);
  });
});

describe('motif library', () => {
  /** A diamond 10 mm across, wound counter-clockwise. */
  const diamond = [
    { x: 0, y: -5 },
    { x: 5, y: 0 },
    { x: 0, y: 5 },
    { x: -5, y: 0 },
  ];

  it('creates a motif and lists it back with its shape intact', async () => {
    const created = await request(app)
      .post('/api/motifs')
      .send({ name: 'Diamond', data: { points: diamond, note: 'ten millimetres' } });
    expect(created.status).toBe(201);
    expect(created.body.builtin).toBe(false);
    // The shape has to survive the round trip point for point, or a design
    // that uses it would sew something other than what was saved.
    expect(created.body.data.points).toEqual(diamond);
    expect(created.body.data.note).toBe('ten millimetres');

    const list = await request(app).get('/api/motifs');
    expect(list.status).toBe(200);
    expect(list.body.items.some((m: { name: string }) => m.name === 'Diamond')).toBe(true);
  });

  it('renames a shape without touching its geometry', async () => {
    const created = await request(app)
      .post('/api/motifs')
      .send({ name: 'Before', data: { points: diamond } });

    const renamed = await request(app)
      .put(`/api/motifs/${created.body.id}`)
      .send({ name: 'After' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('After');
    expect(renamed.body.data.points).toEqual(diamond);
  });

  it('deletes a saved shape', async () => {
    const created = await request(app)
      .post('/api/motifs')
      .send({ name: 'Temporary', data: { points: diamond } });

    const removed = await request(app).delete(`/api/motifs/${created.body.id}`);
    expect(removed.status).toBe(204);

    const list = await request(app).get('/api/motifs');
    expect(list.body.items.some((m: { name: string }) => m.name === 'Temporary')).toBe(false);
  });

  it('refuses to delete a built-in shape', async () => {
    // Seeded built-ins are part of the app; deleting one would leave a design
    // that names it with nothing to fall back to. The test database is empty,
    // so the record is inserted directly rather than relying on a seed run.
    const { COLLECTIONS, collection } = await import('../db/mongo.js');
    await collection(COLLECTIONS.motifPresets).insertOne({
      _id: 'motif-star',
      name: 'Star',
      data: { points: diamond },
      builtin: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).delete('/api/motifs/motif-star');
    expect(res.status).toBe(409);
  });

  it('rejects fewer than three points', async () => {
    const res = await request(app)
      .post('/api/motifs')
      .send({ name: 'Line', data: { points: diamond.slice(0, 2) } });
    expect(res.status).toBe(400);
  });

  it('rejects more points than the engine will sew', async () => {
    const tooMany = Array.from({ length: 401 }, (_, i) => {
      const a = (i / 401) * Math.PI * 2;
      return { x: Math.cos(a) * 5, y: Math.sin(a) * 5 };
    });
    const res = await request(app)
      .post('/api/motifs')
      .send({ name: 'Trace', data: { points: tooMany } });
    expect(res.status).toBe(400);
  });

  it('rejects a point that is not a finite coordinate', async () => {
    const res = await request(app)
      .post('/api/motifs')
      .send({
        name: 'Broken',
        data: { points: [...diamond.slice(0, 3), { x: 'NaN', y: 0 }] },
      });
    expect(res.status).toBe(400);
  });
});

describe('settings', () => {
  it('returns defaults on first run without persisting them', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.units).toBe('mm');
    expect(res.body.autosaveIntervalMs).toBe(30_000);
    expect(res.body.gridMajorSize).toBe(25);
    expect(res.body.updatedAt).toBeNull();
  });

  it('persists a partial patch without resetting other fields', async () => {
    await request(app).put('/api/settings').send({ showGrid: false });

    const res = await request(app)
      .put('/api/settings')
      .send({ gridSize: 10, gridMajorSize: 40, snapToObjects: true });
    expect(res.body.showGrid).toBe(false);
    expect(res.body.gridSize).toBe(10);
    expect(res.body.gridMajorSize).toBe(40);
    expect(res.body.snapToObjects).toBe(true);

    const read = await request(app).get('/api/settings');
    expect(read.body.showGrid).toBe(false);
    expect(read.body.gridSize).toBe(10);
    expect(read.body.gridMajorSize).toBe(40);
  });

  it('rejects a major grid beyond the supported range', async () => {
    const res = await request(app).put('/api/settings').send({ gridMajorSize: 500 });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range autosave interval', async () => {
    const res = await request(app).put('/api/settings').send({ autosaveIntervalMs: 10 });
    expect(res.status).toBe(400);
  });

  it('ships a usable undo depth on first run', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.body.undoDepth).toBe(60);
  });

  it('accepts and keeps a wider undo history', async () => {
    const res = await request(app).put('/api/settings').send({ undoDepth: 300 });
    expect(res.status).toBe(200);
    expect(res.body.undoDepth).toBe(300);

    const read = await request(app).get('/api/settings');
    expect(read.body.undoDepth).toBe(300);
  });

  it('rejects an undo depth the editor would not honour', async () => {
    // Every one of these is a value the store would silently clamp or never
    // reach, so storing it would mean Preferences showing a number that does
    // not describe the stack the editor actually keeps.
    for (const undoDepth of [1, 5000, 12.5]) {
      const res = await request(app).put('/api/settings').send({ undoDepth });
      expect(res.status).toBe(400);
    }

    // A rejected patch never reaches the merge, so the stored depth stands.
    const read = await request(app).get('/api/settings');
    expect(read.body.undoDepth).toBe(300);
  });
});

describe('origin restriction', () => {
  it('rejects a cross-origin request', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('allows a loopback origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

it('accepts separate pull compensation and refuses an out-of-range side', async () => {
  const patch = { left: 0.8, right: 0.2 };
  const design = sampleDesign();
  (design.objects[0]!.params as Record<string, unknown>).separatePullCompensation = patch;

  const created = await request(app).post('/api/projects').send({ name: 'Pulled', design });
  expect(created.status).toBe(201);

  const fetched = await request(app).get(`/api/projects/${created.body.id}`);
  expect(fetched.status).toBe(200);
  expect(fetched.body.design.objects[0].params.separatePullCompensation).toEqual(patch);

  const bad = sampleDesign();
  (bad.objects[0]!.params as Record<string, unknown>).separatePullCompensation = {
    left: 6,
    right: 0,
  };
  const refused = await request(app).post('/api/projects').send({ name: 'Bad pull', design: bad });
  expect(refused.status).toBe(400);
  expect(refused.body.error.code).toBe('VALIDATION_FAILED');
});

it('accepts redwork settings and refuses an impossible width', async () => {
  const patch = { enabled: true, style: 'stem' as const, widthMm: 1.2, stitchMm: 2.5 };
  const design = sampleDesign();
  (design.objects[0]!.params as Record<string, unknown>).redwork = patch;

  const created = await request(app).post('/api/projects').send({ name: 'Redwork', design });
  expect(created.status).toBe(201);

  const fetched = await request(app).get(`/api/projects/${created.body.id}`);
  expect(fetched.status).toBe(200);
  expect(fetched.body.design.objects[0].params.redwork).toEqual(patch);

  const bad = sampleDesign();
  (bad.objects[0]!.params as Record<string, unknown>).redwork = { ...patch, widthMm: 0 };
  const refused = await request(app)
    .post('/api/projects')
    .send({ name: 'Bad redwork', design: bad });
  expect(refused.status).toBe(400);
  expect(refused.body.error.code).toBe('VALIDATION_FAILED');
});
