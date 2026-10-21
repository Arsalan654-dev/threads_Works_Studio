/**
 * Vercel Function entry point for the ThreadWorks API.
 *
 * Vercel's standalone `/api` functions do not provide Express-style nested
 * routing, so `vercel.json` rewrites every `/api/*` request here with the
 * original path in the `path` query parameter. This handler puts that path
 * back before handing the request to Express.
 *
 * The Express app expects a Node request/response pair, which is exactly what
 * a Vercel Node.js Function receives. The app is created once per instance;
 * the MongoDB connection is opened lazily on the first request and reused.
 *
 * The `.mjs` extension keeps this file native ESM, matching `server/dist`.
 */

import { URL } from 'node:url';
import { createApp } from '../server/dist/app.js';
import { connectDb, ensureIndexes } from '../server/dist/db/mongo.js';

const app = createApp();

/** @type {Promise<void> | undefined} */
let ready;

function init() {
  if (!ready) {
    ready = connectDb()
      .then((db) => ensureIndexes(db))
      .then(() => undefined)
      .catch((error) => {
        // A failed cold start should be retried on the next request rather
        // than poisoning this instance for its whole lifetime.
        ready = undefined;
        throw error;
      });
  }
  return ready;
}

function restoreApiPath(req) {
  const incoming = new URL(req.url ?? '/', 'http://internal');
  const forwarded = incoming.searchParams.get('path');
  if (forwarded === null) return;

  incoming.searchParams.delete('path');
  const query = incoming.searchParams.toString();
  req.url = `/api/${forwarded}${query ? `?${query}` : ''}`;
}

function sendJson(res, status, body) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    await init();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database connection failed.';
    sendJson(res, 503, {
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message,
      },
    });
    return;
  }

  try {
    restoreApiPath(req);
    await new Promise((resolve, reject) => {
      // Keep the invocation alive until Express has actually finished the
      // response; async route handlers end it later than the router returns.
      res.once('finish', resolve);
      res.once('close', resolve);
      try {
        app(req, res);
      } catch (error) {
        reject(error);
      }
    });
  } catch {
    sendJson(res, 500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The API failed to handle the request.',
      },
    });
  }
}
