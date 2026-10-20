import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId, type Db } from 'mongodb';
import type { Express } from 'express';
// Type-only: the module itself is imported lazily inside `beforeAll` so the
// environment variables it reads are set first. Hoisting the *type* does not
// hoist the module, so the ordering still holds.
import type * as BackupModule from './backup.js';

/**
 * Regression tests for the two defects the manual restore round trip
 * uncovered: JSON flattens `_id` to a string, and seeded presets use
 * non-ObjectId keys that the generic `requireObjectId()` guard rejected.
 */

let app: Express;
let backupDir: string;
let disconnect: () => Promise<void>;
let backupMod: typeof BackupModule;
let getDb: () => Db;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/embroidery_studio_backup_test';
  backupDir = await mkdtemp(join(tmpdir(), 'tw-backup-'));
  process.env.BACKUP_DIR = backupDir;

  const { connectDb, ensureIndexes, disconnectDb, getDb: db } = await import('../db/mongo.js');
  const database = await connectDb(process.env.MONGODB_URI);
  await ensureIndexes(database);
  await database.dropDatabase();

  backupMod = await import('./backup.js');
  getDb = db;
  const { createApp } = await import('../app.js');
  app = createApp();
  disconnect = disconnectDb;
}, 30_000);

afterAll(async () => {
  try {
    await getDb().dropDatabase();
  } catch {
    // Database may already be closed.
  }
  if (disconnect) await disconnect();
  if (backupDir) await rm(backupDir, { recursive: true, force: true });
});

function design() {
  return {
    units: 'mm',
    width: 80,
    height: 80,
    hoopId: null,
    objects: [],
    threadPalette: [{ id: 'c1', code: '1', name: 'Red', hex: '#C8102E' }],
  };
}

describe('preset ids', () => {
  it('lists presets whose _id is a readable seeded string', async () => {
    // Seeded documents look exactly like this.
    await getDb()
      .collection('hoopPresets')
      .insertOne({
        _id: 'hoop-100x100',
        name: '100 x 100 mm',
        data: { width: 100, height: 100, shape: 'rect', safeMargin: 4 },
        builtin: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

    const res = await request(app).get('/api/hoops');
    expect(res.status).toBe(200);
    // The failure mode was a 500 from `_id.toHexString is not a function`.
    expect(res.body.items[0].id).toBe('hoop-100x100');
  });

  it('reads a seeded preset by its string key', async () => {
    const res = await request(app).get('/api/hoops/hoop-100x100');
    expect(res.status).toBe(200);
    expect(res.body.data.width).toBe(100);
  });

  it('reads a user-created preset by ObjectId hex', async () => {
    const created = await request(app)
      .post('/api/hoops')
      .send({
        name: 'Custom',
        data: { width: 150, height: 150, shape: 'round', safeMargin: 5 },
      });
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/hoops/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Custom');
  });

  it('refuses to delete a built-in preset', async () => {
    const res = await request(app).delete('/api/hoops/hoop-100x100');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects an id that could be an operator', async () => {
    const res = await request(app).get('/api/hoops/$where');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });
});

describe('backup / restore round trip', () => {
  it('restores a project so it is reachable by id and in lists', async () => {
    const created = await request(app)
      .post('/api/projects')
      .send({ name: 'Round Trip', design: design() });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const dir = await backupMod.backup();

    const del = await request(app).delete(`/api/projects/${id}`);
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/projects/${id}`)).status).toBe(404);

    await backupMod.restore(dir, true);

    // Reachable by the original id - this is what a string `_id` breaks.
    const fetched = await request(app).get(`/api/projects/${id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe('Round Trip');

    const list = await request(app).get('/api/projects');
    expect(list.status).toBe(200);
    expect(list.body.items.some((p: { id: string }) => p.id === id)).toBe(true);
  }, 40_000);

  it('keeps _id an ObjectId after restore, not a string', async () => {
    const dir = await backupMod.backup();
    await backupMod.restore(dir, true);

    const doc = await getDb().collection('projects').findOne({});
    expect(doc).not.toBeNull();
    expect(doc!._id).toBeInstanceOf(ObjectId);
  }, 40_000);

  it('keeps createdAt/updatedAt as real dates so sorting still works', async () => {
    const dir = await backupMod.backup();
    await backupMod.restore(dir, true);

    const doc = await getDb().collection('projects').findOne({});
    expect(doc).not.toBeNull();
    expect(doc!.updatedAt).toBeInstanceOf(Date);
    expect(doc!.updatedAt.getTime()).not.toBeNaN();
  }, 40_000);

  it('preserves seeded string keys as strings', async () => {
    const dir = await backupMod.backup();
    await backupMod.restore(dir, true);

    const hoop = await getDb().collection('hoopPresets').findOne({ _id: 'hoop-100x100' });
    expect(hoop).not.toBeNull();
  }, 40_000);

  it('reports a corrupt backup instead of importing half of it', async () => {
    const dir = await backupMod.backup();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'projects.jsonl'), '{"_id":"abc"}\n{not json\n', 'utf8');

    await expect(backupMod.restore(dir, true)).rejects.toThrow(/Corrupt backup file .* line 2/);
  }, 40_000);
});
