/**
 * Liveness / readiness.
 *
 * Reports the real database state rather than an optimistic "ok": this is the
 * endpoint `start.bat` polls to decide when the app is usable, and a health
 * check that lies is worse than none.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/validate.js';
import { connectDb, getDb } from '../db/mongo.js';
import { env } from '../config/env.js';

const startedAt = Date.now();

/**
 * Whether the API is talking to a database on this machine or a hosted one.
 * Only the label is exposed; the connection string (and its credentials) is
 * never part of the response.
 */
function databaseModeOf(uri: string): 'local' | 'remote' {
  const authority = uri.replace(/^mongodb(\+srv)?:\/\//i, '').split('/')[0] ?? '';
  const hostPort = authority.split('@').pop() ?? '';
  const firstHost = hostPort.split(',')[0] ?? '';
  const host = firstHost.startsWith('[')
    ? firstHost.slice(1, firstHost.indexOf(']')).toLowerCase()
    : (firstHost.split(':')[0] ?? '').toLowerCase();

  return host === '127.0.0.1' || host === 'localhost' || host === '::1' ? 'local' : 'remote';
}

const databaseMode = databaseModeOf(env.MONGODB_URI);

export const healthRouter: Router = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    let database: 'connected' | 'disconnected' = 'disconnected';
    let databaseError: string | undefined;

    try {
      const db = getDb();
      // `admin.command({ ping: 1 })` is the cheapest real round trip.
      await db.admin().command({ ping: 1 });
      database = 'connected';
    } catch {
      // A dropped connection may still be recoverable - try once to reattach.
      // The message below is taken from whichever attempt actually failed, so
      // the first error is not worth keeping: nothing reads it.
      try {
        await connectDb();
        database = 'connected';
        databaseError = undefined;
      } catch (retryErr) {
        databaseError = retryErr instanceof Error ? retryErr.message : String(retryErr);
      }
    }

    res.status(database === 'connected' ? 200 : 503).json({
      status: database === 'connected' ? 'ok' : 'degraded',
      name: 'ThreadWorks Studio',
      version: process.env.npm_package_version ?? '0.1.0',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      database,
      databaseMode,
      ...(databaseError ? { databaseError } : {}),
      // Timestamp lets a client detect a server restart without a session.
      serverTime: new Date().toISOString(),
    });
  }),
);

/** Exposed for tests that need a deterministic uptime baseline. */
export const serverStartedAt = startedAt;
