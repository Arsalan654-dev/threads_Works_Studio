/**
 * Error and "not found" middleware.
 *
 * Express detects error handlers by arity, so these two functions must keep
 * four parameters even where one goes unused.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MongoServerError } from 'mongodb';
import { ZodError } from 'zod';
import { ApiError } from '../http/errors.js';
import { env } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err instanceof ZodError) {
    apiError = ApiError.badRequest(
      'VALIDATION_FAILED',
      err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      { fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    );
  } else if (err instanceof MongoServerError && err.code === 11000) {
    // Unique index violation - surfaced as a conflict, not a 500.
    apiError = ApiError.conflict('That value is already in use', { key: err.keyValue });
  } else if (isBodyParserLimit(err)) {
    apiError = ApiError.tooLarge(
      `The request body is larger than this server's configured limit (${env.MAX_PROJECT_MB} MB for designs, ${env.MAX_UPLOAD_MB} MB for uploads).`,
    );
  } else {
    const unexpected = err as Error;
    process.stderr.write(
      `[ThreadWorks] 500 on ${req.method} ${req.originalUrl}: ${unexpected?.stack ?? String(err)}\n`,
    );
    apiError = new ApiError(
      500,
      'INTERNAL_ERROR',
      // Generic on purpose: stacks and driver messages are local-only detail.
      'The server failed to handle this request. See the server log for details.',
    );
  }

  const body: Record<string, unknown> = {
    error: { code: apiError.code, message: apiError.message },
  };
  if (apiError.details !== undefined) {
    (body.error as Record<string, unknown>).details = apiError.details;
  }
  // Full context locally, nothing extra in a production-shaped run.
  if (env.NODE_ENV === 'development' && apiError.status >= 500) {
    (body.error as Record<string, unknown>).debug = String((err as Error)?.stack ?? err);
  }

  res.status(apiError.status).json(body);
};

function isBodyParserLimit(err: unknown): err is Error {
  const e = err as { type?: string; status?: number };
  return e?.type === 'entity.too.large' || e?.status === 413;
}
