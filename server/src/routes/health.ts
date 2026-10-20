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
      ...(databaseError ? { databaseError } : {}),
      // Timestamp lets a client detect a server restart without a session.
      serverTime: new Date().toISOString(),
    });
  }),
);

/** Exposed for tests that need a deterministic uptime baseline. */
export const serverStartedAt = startedAt;
