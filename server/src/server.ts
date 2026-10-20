/**
 * Process entry point.
 *
 * Startup order matters: directories first (so a later write never fails on a
 * missing folder), then MongoDB, then the listener. If the database cannot be
 * reached the process exits rather than serving an API that would report
 * every save as successful while storing nothing.
 *
 * The host comes from `SERVER_HOST`; left unset it is `127.0.0.1` locally and
 * `0.0.0.0` when `NODE_ENV=production`, which is what a container platform
 * needs. CORS still decides which browser origins may use the API.
 */

import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { env, paths } from './config/env.js';
import { connectDb, ensureIndexes, disconnectDb } from './db/mongo.js';

/** Create every configured data directory if it does not already exist. */
async function ensureDirectories(): Promise<void> {
  await Promise.all(
    Object.values(paths)
      .filter((p): p is string => typeof p === 'string')
      .map((dir) => mkdir(dir, { recursive: true })),
  );
}

export async function start(): Promise<void> {
  await ensureDirectories();

  const db = await connectDb();
  await ensureIndexes(db);

  const app = createApp();
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.SERVER_PORT, env.SERVER_HOST, resolve);
  });

  const shownHost = env.SERVER_HOST === '0.0.0.0' ? '127.0.0.1' : env.SERVER_HOST;
  process.stdout.write(
    [
      '',
      '  ThreadWorks Studio',
      `  API      http://${shownHost}:${env.SERVER_PORT}/api/health`,
      `  Bind     ${env.SERVER_HOST}:${env.SERVER_PORT}`,
      `  Database ${env.MONGODB_URI.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@')}`,
      `  Data     ${paths.data}`,
      `  Mode     ${env.NODE_ENV}`,
      '',
    ].join('\n'),
  );

  // Windows sends SIGTERM on Ctrl+C in some terminals; SIGINT is the normal
  // console signal. Handle both so the port is always released promptly.
  const shutdown = (signal: string): void => {
    process.stdout.write(`\n[ThreadWorks] ${signal} received, shutting down...\n`);
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[ThreadWorks] unhandled rejection: ${String(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[ThreadWorks] uncaught exception: ${err.stack ?? err.message}\n`);
    shutdown('uncaughtException');
  });
}

// Only self-start when executed directly, so tests can import `createApp`
// without binding a port or connecting to MongoDB.
const entry = process.argv[1];
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (invokedDirectly) {
  start().catch((err: unknown) => {
    process.stderr.write(
      `[ThreadWorks] failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
