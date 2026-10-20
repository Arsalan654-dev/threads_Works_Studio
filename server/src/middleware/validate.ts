/**
 * Request validation middleware.
 *
 * Express 4 does not narrow types from a schema, so the validated value is
 * written back onto the request (as `req.validated`). Handlers therefore read
 * parsed data, never the raw body - which is the point of putting Zod at the
 * boundary in the first place.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from '../http/errors.js';

function toZodError(error: z.ZodError): ApiError {
  const fields = error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));
  return ApiError.badRequest(
    'VALIDATION_FAILED',
    `Invalid request: ${fields.map((f) => `${f.path}: ${f.message}`).join('; ')}`,
    { fields },
  );
}

export function validateBody<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(toZodError(result.error));
      return;
    }
    (req as Request & { validated: z.infer<S> }).validated = result.data;
    next();
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(toZodError(result.error));
      return;
    }
    (req as Request & { validatedQuery: z.infer<S> }).validatedQuery = result.data;
    next();
  };
}

/**
 * Validate a route parameter.
 *
 * `:id` arrives as a string; a MongoDB ObjectId has a fixed 24-hex shape, and
 * anything else would be passed straight to a driver call that throws a
 * driver-level error nobody downstream knows how to phrase.
 */
export function requireObjectId(param = 'id'): RequestHandler {
  return (req, _res, next) => {
    const value = req.params[param];
    if (!value || !/^[0-9a-fA-F]{24}$/.test(value)) {
      next(ApiError.badRequest('INVALID_ID', `"${param}" must be a 24-character object id`));
      return;
    }
    next();
  };
}

/** Read the value written by `validateBody`. */
export function body<S extends ZodTypeAny>(req: Request): z.infer<S> {
  const value = (req as Request & { validated?: z.infer<S> }).validated;
  if (value === undefined) {
    throw new Error('validateBody() must run before reading the body');
  }
  return value;
}

/** Read the value written by `validateQuery`. */
export function query<S extends ZodTypeAny>(req: Request): z.infer<S> {
  const value = (req as Request & { validatedQuery?: z.infer<S> }).validatedQuery;
  if (value === undefined) {
    throw new Error('validateQuery() must run before reading the query');
  }
  return value;
}

/** Wrap an async handler so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
