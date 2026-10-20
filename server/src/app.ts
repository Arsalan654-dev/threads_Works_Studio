/**
 * Express application.
 *
 * Kept separate from `server.ts` so tests can mount the app without opening a
 * socket or starting a listener.
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { corsOrigins, env, paths } from './config/env.js';
import { isOriginAllowed } from './config/origins.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { healthRouter } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { recentRouter, versionsRouter } from './routes/history.js';
import { createPresetRouter, PRESET_COLLECTIONS } from './routes/presets.js';
import { settingsRouter } from './routes/settings.js';
import {
  FillPatternSchema,
  HoopPresetCreateSchema,
  HoopPresetUpdateSchema,
  MotifPresetCreateSchema,
  MotifPresetUpdateSchema,
  ThreadColorSchema,
} from './schemas/design.js';
import { z } from 'zod';

/**
 * Thread palettes are stored as a preset whose payload is a colour list, so
 * they fit the same CRUD factory as hoops and digitizing presets.
 */
const PalettePresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  data: z.array(ThreadColorSchema).min(1, 'A palette needs at least one colour').max(1000),
});

/** Digitizing presets: named bundles of stitch parameters. */
const DigitizingPresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  data: z.object({
    stitchType: z.enum(['satin', 'tatami', 'run', 'bean', 'motif', 'contour', 'spiral']),
    angle: z.number().finite().min(-360).max(360),
    spacing: z.number().finite().min(0.05).max(10),
    maxStitchLength: z.number().finite().min(0.5).max(12.1),
    minStitchLength: z.number().finite().min(0).max(5),
    pullCompensation: z.number().finite().min(-5).max(5),
    // The same enum the design schema uses, so a preset can carry any fill
    // the engine can sew - one list, not two that drift apart.
    fillPattern: FillPatternSchema,
    underlay: z.object({
      type: z.enum(['none', 'centerRun', 'edgeRun', 'zigzag', 'tatami']),
      spacing: z.number().finite().min(0.1).max(20),
      offset: z.number().finite().min(0).max(20),
      inset: z.number().finite().min(0).max(20),
    }),
    tieIn: z.object({
      enabled: z.boolean(),
      length: z.number().finite().min(0.1).max(5),
      count: z.number().int().min(1).max(10),
    }),
    tieOff: z.object({
      enabled: z.boolean(),
      length: z.number().finite().min(0.1).max(5),
      count: z.number().int().min(1).max(10),
    }),
    // Optional: a preset saved before 3D foam existed still loads.
    foam: z
      .object({
        enabled: z.boolean(),
        thicknessMm: z.number().finite().min(0).max(10),
        tackUnderlay: z.boolean(),
      })
      .optional(),
    // Optional: absent means a plain fill, as it always was.
    carve: z
      .object({
        enabled: z.boolean(),
        pattern: z.enum(['diamond', 'circle', 'star', 'cross', 'hexagon']),
        spacing: z.number().finite().min(1).max(50),
        scale: z.number().finite().min(0.1).max(50),
        rotation: z.number().finite().min(-360).max(360),
        outline: z.boolean(),
      })
      .optional(),
  }),
});

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // Security headers. `helmet` sets a CSP; the dev server serves Vite's client,
  // which needs inline styles and eval in development, so the policy is
  // relaxed only when NODE_ENV is development.
  app.use(
    helmet({
      contentSecurityPolicy:
        env.NODE_ENV === 'development'
          ? {
              directives: {
                'default-src': ["'self'"],
                'style-src': ["'self'", "'unsafe-inline'"],
                'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                'connect-src': ["'self'", 'ws:', 'http://127.0.0.1:*', 'http://localhost:*'],
                'img-src': ["'self'", 'data:', 'blob:'],
                'font-src': ["'self'", 'data:'],
              },
            }
          : undefined,
      // Design previews are drawn to a canvas and downloaded as blobs.
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  app.use(compression());

  // Body size guards. A design is JSON, so the limit is generous but bounded
  // by MAX_PROJECT_MB rather than an unbounded default.
  app.use(express.json({ limit: `${env.MAX_PROJECT_MB}mb` }));
  app.use(express.urlencoded({ extended: false, limit: `${env.MAX_UPLOAD_MB}mb` }));

  // Pages on this machine (the Vite dev server) and any origin named in
  // CORS_ORIGINS may call the API. Hosted, that list is the Vercel URL; the
  // wildcard form also covers preview deployments.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!isOriginAllowed(origin, corsOrigins)) {
        res.status(403).json({
          error: {
            code: 'ORIGIN_NOT_ALLOWED',
            message: 'This origin may not use the API. Add it to CORS_ORIGINS on the server.',
          },
        });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  });

  const api = express.Router();

  api.use(healthRouter);
  api.use('/projects/:id/versions', versionsRouter);
  api.use('/projects', projectsRouter);
  api.use('/recent', recentRouter);
  api.use(
    '/palettes',
    createPresetRouter({
      collectionName: PRESET_COLLECTIONS.palettes,
      createSchema: PalettePresetCreateSchema,
      updateSchema: PalettePresetCreateSchema.partial(),
    }),
  );
  api.use(
    '/hoops',
    createPresetRouter({
      collectionName: PRESET_COLLECTIONS.hoops,
      createSchema: HoopPresetCreateSchema,
      updateSchema: HoopPresetUpdateSchema,
    }),
  );
  api.use(
    '/presets',
    createPresetRouter({
      collectionName: PRESET_COLLECTIONS.presets,
      createSchema: DigitizingPresetCreateSchema,
      updateSchema: DigitizingPresetCreateSchema.partial(),
    }),
  );
  api.use(
    '/motifs',
    createPresetRouter({
      collectionName: PRESET_COLLECTIONS.motifs,
      createSchema: MotifPresetCreateSchema,
      updateSchema: MotifPresetUpdateSchema,
    }),
  );
  api.use('/settings', settingsRouter);

  app.use('/api', api);

  // Exports are written to disk; expose them for local download.
  app.use(
    '/exports',
    express.static(paths.exports, {
      fallthrough: true,
      // Filenames are generated by us, but dotfiles are never a good idea.
      dotfiles: 'deny',
      index: false,
    }),
  );

  serveBuiltClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serve the built editor when it is present.
 *
 * In `development` the Vite dev server owns the client and proxies `/api`
 * here, so this is a no-op. In a production run there is no second process:
 * `start.bat` builds the client and this same server hands out the HTML, the
 * bundle and the API on one origin, which keeps the loopback-only story
 * simple and avoids a second port to secure.
 */
function serveBuiltClient(app: Express): void {
  const clientDist = resolve(paths.root, 'client', 'dist');

  if (!existsSync(join(clientDist, 'index.html'))) {
    return;
  }

  app.use(
    express.static(clientDist, {
      index: false,
      // The bundle filename is content-hashed by Vite, so it can be cached
      // hard; index.html must not be, or an upgrade would keep serving the
      // previous asset names.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.[0-9a-f]{8,}\./.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // Single-page-app fallback: unknown non-API paths get the shell so a deep
  // link still loads the editor instead of a 404.
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/exports')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(clientDist, 'index.html'));
  });
}
