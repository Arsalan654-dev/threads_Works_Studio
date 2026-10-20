/**
 * Backup and restore.
 *
 * Implemented with the MongoDB driver rather than shelling out to
 * `mongodump`: the tools are not guaranteed to be installed next to the
 * service, and a backup script that fails because a companion binary is
 * missing is not much of a safety net.
 *
 * Format: one folder per run containing a JSON file per collection plus a
 * `manifest.json` with counts and a schema-free timestamp. One JSON object
 * per line (JSONL) keeps files append-friendly and lets a partial file be
 * detected on restore instead of silently importing half a collection.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ObjectId } from 'mongodb';
import { env, paths } from '../config/env.js';
import { isObjectIdHex } from '../util/id.js';
import { COLLECTIONS, collection, connectDb, disconnectDb, ensureIndexes } from '../db/mongo.js';

/** Every collection the application owns. */
const ALL_COLLECTIONS: string[] = Object.values(COLLECTIONS);

const MANIFEST = 'manifest.json';

interface Manifest {
  createdAt: string;
  appVersion: string;
  counts: Record<string, number>;
  collections: string[];
}

/**
 * Where backup/restore write progress.
 *
 * Silent by default: these are library functions as well as CLI commands, and
 * a callee that prints makes every test run unreadable. The CLI passes
 * `process.stdout.write` explicitly.
 */
export type Logger = (message: string) => void;
const silent: Logger = () => undefined;

export interface BackupOptions {
  log?: Logger;
}

export interface RestoreOptions {
  log?: Logger;
  /** `false` merges into existing data instead of dropping it first. */
  replace?: boolean;
}

/** Folder name is sortable, so `Get-ChildItem | Sort-Object Name` is newest-last. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeCollection(name: string, file: string): Promise<number> {
  const docs = await collection<Record<string, unknown>>(name).find().toArray();

  const lines = docs.map((doc) =>
    JSON.stringify(doc, (_key, value) => {
      // Dates are serialised as ISO strings by JSON.stringify already; keep
      // BSON types we do not handle explicit rather than silently mangling.
      if (typeof value === 'bigint') return value.toString();
      return value;
    }),
  );

  await writeFile(file, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  return docs.length;
}

export async function backup(options: BackupOptions = {}): Promise<string> {
  const log = options.log ?? silent;
  const db = await connectDb();
  await ensureIndexes(db);

  const dir = join(paths.backups, timestamp());
  await mkdir(dir, { recursive: true });

  const counts: Record<string, number> = {};

  for (const name of ALL_COLLECTIONS) {
    counts[name] = await writeCollection(name, join(dir, `${name}.jsonl`));
  }

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    appVersion: process.env.npm_package_version ?? '0.1.0',
    counts,
    collections: ALL_COLLECTIONS,
  };
  await writeFile(join(dir, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');

  log(`Backup written to ${dir}`);
  for (const [name, count] of Object.entries(counts)) {
    log(`  ${name}: ${count}`);
  }

  // Deliberately does NOT disconnect: this is a library function too, and a
  // callee closing a connection it may not own breaks any caller that keeps
  // using the database afterwards. The CLI tears the connection down itself.
  return dir;
}

async function readJsonl(file: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(file, 'utf8');
  const docs: Record<string, unknown>[] = [];
  let lineNumber = 0;

  for (const line of text.split('\n')) {
    lineNumber++;
    if (line.trim() === '') continue;
    try {
      docs.push(rehydrate(JSON.parse(line) as Record<string, unknown>));
    } catch (err) {
      // Report the offending line: a truncated file is exactly the failure
      // mode a restore needs to surface rather than skip past. The original
      // error is attached as `cause` so the JSON parse stack survives.
      throw new Error(
        `Corrupt backup file ${file} at line ${lineNumber}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  return docs;
}

/** Fields the application stores as BSON dates. */
const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'openedAt']);

/**
 * Restore the BSON types that `JSON.stringify` flattened.
 *
 * JSON has no ObjectId or Date, so a round trip leaves `_id` as a plain
 * string. Inserting that as-is silently changes the key type: the document
 * then no longer matches lookups by ObjectId, which is how a backup can
 * "restore successfully" while the project is unreachable afterwards. Only
 * fields with their real types are converted - seeded string keys such as
 * `hoop-100x100` are left alone because they are not 24-hex.
 */
function rehydrate(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };

  if (isObjectIdHex(out['_id'])) {
    out['_id'] = new ObjectId(out['_id'] as string);
  }

  for (const field of DATE_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      out[field] = new Date(value);
    }
  }

  return out;
}

/**
 * Restore a backup folder.
 *
 * `replace` drops the destination collections first. Without it the restore
 * is a merge, which can leave deleted projects resurrected - usually worse
 * than having done nothing.
 */
export async function restore(backupDir: string, replace?: boolean): Promise<void>;
export async function restore(backupDir: string, options?: RestoreOptions): Promise<void>;
export async function restore(
  backupDir: string,
  second: boolean | RestoreOptions = true,
): Promise<void> {
  // Accepts a plain boolean for the common `restore(dir, true)` call so the
  // option bag does not have to be spelled out at every call site.
  const opts: RestoreOptions = typeof second === 'boolean' ? { replace: second } : second;
  const replace = opts.replace ?? true;
  const log = opts.log ?? silent;

  const manifestRaw = await readFile(join(backupDir, MANIFEST), 'utf8');
  const manifest = JSON.parse(manifestRaw) as Manifest;

  const db = await connectDb();
  await ensureIndexes(db);

  log(`Restoring backup from ${manifest.createdAt}`);

  for (const name of manifest.collections) {
    const file = join(backupDir, `${name}.jsonl`);
    const docs = await readJsonl(file);

    const target = collection<Record<string, unknown>>(name);
    if (replace) {
      await target.deleteMany({});
    }
    if (docs.length > 0) {
      await target.insertMany(docs, { ordered: false });
    }
    log(`  ${name}: ${docs.length} document${docs.length === 1 ? '' : 's'}`);
  }
}

/** Remove backups older than `keep` runs, newest first. */
export async function pruneBackups(keep: number): Promise<number> {
  let entries: string[];
  try {
    entries = (await readdir(paths.backups, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return 0; // Nothing to prune if the folder does not exist yet.
  }

  const excess = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of excess) {
    await rm(join(paths.backups, name), { recursive: true, force: true });
  }
  return excess.length;
}

// --- CLI --------------------------------------------------------------------

/** CLI progress output, one line per message. */
const cliLog: Logger = (message) => process.stdout.write(`${message}\n`);

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'backup';
  const target = process.argv[3];

  try {
    if (command === 'backup') {
      await backup({ log: cliLog });
      const pruned = await pruneBackups(env.BACKUP_KEEP);
      if (pruned > 0) cliLog(`Pruned ${pruned} old backup(s)`);
      return;
    }

    if (command === 'restore') {
      if (!target) {
        process.stderr.write(
          'Usage: npm run restore -- <backup-folder>\n' +
            `Available backups are in ${paths.backups}\n`,
        );
        process.exit(1);
      }
      await restore(target, { replace: !process.argv.includes('--merge'), log: cliLog });
      return;
    }

    if (command === 'list') {
      try {
        const entries = (await readdir(paths.backups, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort()
          .reverse();
        process.stdout.write(entries.length > 0 ? `${entries.join('\n')}\n` : 'No backups yet.\n');
      } catch {
        process.stdout.write('No backups yet.\n');
      }
      return;
    }

    process.stderr.write(`Unknown command "${command}". Use backup | restore | list.\n`);
    process.exit(1);
  } finally {
    // Only the CLI owns the connection lifecycle.
    await disconnectDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `Backup/restore failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
