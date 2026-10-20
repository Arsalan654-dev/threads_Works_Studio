/**
 * MongoDB connection and collection access.
 *
 * A single client is created per process and reused. The app refuses to start
 * without a database: silent degradation to an in-memory or localStorage-style
 * store would mean "saved" designs vanish on restart, which is exactly the
 * failure mode this project set out to avoid.
 */

import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { env } from '../config/env.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(uri = env.MONGODB_URI): Promise<Db> {
  if (db) return db;

  client = new MongoClient(uri, {
    // Long enough for a cold Atlas cluster to answer, short enough that a
    // genuinely missing database fails the boot instead of hanging.
    serverSelectionTimeoutMS: 15_000,
    appName: 'threadworks-studio',
  });

  await client.connect();
  db = client.db();
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectDb() during startup.');
  }
  return db;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * Typed collection accessor.
 *
 * Callers pass the Zod-parsed shape rather than a Mongo schema; validation
 * happens at the HTTP boundary, so the driver stays a dumb transport.
 */
export function collection<T extends Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

/** Canonical collection names, kept in one place so renames stay consistent. */
export const COLLECTIONS = {
  projects: 'projects',
  designVersions: 'designVersions',
  threadPalettes: 'threadPalettes',
  hoopPresets: 'hoopPresets',
  digitizingPresets: 'digitizingPresets',
  motifPresets: 'motifPresets',
  applicationSettings: 'applicationSettings',
  recentFiles: 'recentFiles',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * Create the indexes the application relies on.
 *
 * Idempotent by design (createIndex is a no-op when the index already
 * exists), so it is safe to call on every boot.
 */
export async function ensureIndexes(database: Db): Promise<void> {
  await Promise.all([
    database
      .collection(COLLECTIONS.projects)
      .createIndex({ updatedAt: -1 }, { name: 'projects_updatedAt' }),
    database.collection(COLLECTIONS.projects).createIndex({ name: 1 }, { name: 'projects_name' }),
    database
      .collection(COLLECTIONS.designVersions)
      .createIndex({ projectId: 1, createdAt: -1 }, { name: 'versions_project_created' }),
    database
      .collection(COLLECTIONS.threadPalettes)
      .createIndex({ name: 1 }, { name: 'palettes_name' }),
    database.collection(COLLECTIONS.motifPresets).createIndex({ name: 1 }, { name: 'motifs_name' }),
    database
      .collection(COLLECTIONS.applicationSettings)
      .createIndex({ key: 1 }, { name: 'settings_key', unique: true }),
    database
      .collection(COLLECTIONS.recentFiles)
      .createIndex({ openedAt: -1 }, { name: 'recent_openedAt' }),
  ]);
}
