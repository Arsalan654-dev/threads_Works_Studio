/**
 * Restore entry point.
 *
 * Separate from `backup.ts` purely for command discoverability - the actual
 * work lives there so the export and import code cannot drift apart.
 */

import { pathToFileURL } from 'node:url';
import { paths } from '../config/env.js';
import { restore } from './backup.js';

async function main(): Promise<void> {
  // `npm run restore -- <folder>` puts the folder in argv[2].
  const target = process.argv[2];

  if (!target) {
    process.stderr.write(
      'Usage: npm run restore -- <backup-folder>\n' + `Available backups are in ${paths.backups}\n`,
    );
    process.exit(1);
  }

  // Merge (rather than replace) only when explicitly requested.
  await restore(target, {
    replace: !process.argv.includes('--merge'),
    log: (message) => process.stdout.write(`${message}\n`),
  });
}

/** The CLI owns the connection, so it is the one that closes it. */
async function closeAndRun(): Promise<void> {
  try {
    await main();
  } finally {
    const { disconnectDb } = await import('../db/mongo.js');
    await disconnectDb();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  closeAndRun().catch((err: unknown) => {
    process.stderr.write(
      `Restore failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
