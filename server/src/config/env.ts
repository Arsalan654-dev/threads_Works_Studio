/**
 * Environment configuration.
 *
 * Every value the server reads from the process is parsed through Zod here,
 * once, at startup. A missing or malformed value fails immediately with a
 * message naming the variable - rather than surfacing later as an opaque
 * connection error when the first request arrives.
 *
 * Both shapes are supported:
 *
 * - Local workstation: no configuration at all. MongoDB is expected on
 *   `127.0.0.1`, the server binds loopback, and only loopback pages may call
 *   the API.
 * - Hosted (Railway + Atlas): `MONGODB_URI` is an Atlas `mongodb+srv://` URI,
 *   `NODE_ENV=production` binds `0.0.0.0` (Railway injects `PORT`), and
 *   `CORS_ORIGINS` lists the front-end origins allowed to call the API.
 *
 * The defaults are deliberately the local ones, so `npm run dev` and
 * `start.bat` behave exactly as they did before hosting existed.
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root, three levels up from `server/dist/config`. */
export const REPO_ROOT = resolve(here, '..', '..', '..');

// `.env` sits at the repository root. Loading it explicitly (rather than
// relying on the process working directory) means `npm run start` behaves the
// same whether it is launched from the root or from `server/`.
const envFile = resolve(REPO_ROOT, '.env');
if (existsSync(envFile)) {
  loadDotenv({ path: envFile, override: false });
}

/**
 * A Mongo connection string. Atlas uses the `+srv` form; a local mongod uses
 * the plain form. Anything else is a typo, not a database.
 */
const MongoUri = z
  .string()
  .min(1)
  .refine(
    (value) => /^mongodb(\+srv)?:\/\//i.test(value),
    'MONGODB_URI must start with mongodb:// or mongodb+srv://',
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  MONGODB_URI: MongoUri.default('mongodb://127.0.0.1:27017/embroidery_studio'),

  /**
   * Leave unset locally. In production an unset host becomes `0.0.0.0`, which
   * is what a container platform needs to route traffic in.
   */
  SERVER_HOST: z.string().min(1).optional(),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Railway (and most PaaS) inject the port as `PORT`. */
  PORT: z.coerce.number().int().min(1).max(65535).optional(),

  /**
   * Comma-separated browser origins allowed to call the API, e.g.
   * `https://threadworks.vercel.app,https://*.vercel.app`.
   *
   * Loopback origins are always allowed so the local Vite dev server keeps
   * working. A `*.` entry matches any subdomain of that host.
   */
  CORS_ORIGINS: z.string().default(''),

  DATA_DIR: z.string().min(1).default('./data'),
  PROJECT_FILE_DIR: z.string().min(1).default('./data/projects'),
  EXPORT_DIR: z.string().min(1).default('./data/exports'),
  BACKUP_DIR: z.string().min(1).default('./data/backups'),
  UPLOAD_DIR: z.string().min(1).default('./data/uploads'),

  MAX_UPLOAD_MB: z.coerce.number().positive().max(512).default(25),
  MAX_PROJECT_MB: z.coerce.number().positive().max(1024).default(50),

  /** How many backup folders to retain when pruning. 0 disables pruning. */
  BACKUP_KEEP: z.coerce.number().int().min(0).max(1000).default(20),
});

type RawEnv = z.infer<typeof EnvSchema>;

export type Env = Omit<RawEnv, 'SERVER_HOST' | 'PORT'> & { SERVER_HOST: string };

function fail(message: string): never {
  // Written to stderr rather than thrown: dotenv already ran, so this is the
  // last stop before the process becomes unusable.
  process.stderr.write(`\n[ThreadWorks] Invalid environment: ${message}\n\n`);
  process.exit(1);
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  fail(detail);
}

export const env: Env = {
  ...parsed.data,
  SERVER_HOST:
    parsed.data.SERVER_HOST ?? (parsed.data.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  SERVER_PORT: parsed.data.PORT ?? parsed.data.SERVER_PORT,
};

/** Parsed `CORS_ORIGINS`, kept beside `env` so the app reads one list. */
export const corsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

/** Absolute path for a configured directory, resolved against the repo root. */
export function dataPath(relative: string): string {
  return isAbsolute(relative) ? relative : resolve(REPO_ROOT, relative);
}

/** Absolute paths for every configured directory. */
export const paths = {
  root: REPO_ROOT,
  data: dataPath(env.DATA_DIR),
  projects: dataPath(env.PROJECT_FILE_DIR),
  exports: dataPath(env.EXPORT_DIR),
  backups: dataPath(env.BACKUP_DIR),
  uploads: dataPath(env.UPLOAD_DIR),
} as const;
