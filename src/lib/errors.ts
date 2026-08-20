/** Errors that are safe to surface to a user, as translation keys. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const Unauthorized = (key = 'errors.unauthorized') => new AppError(401, 'unauthorized', key);
export const Forbidden = (key = 'errors.forbidden') => new AppError(403, 'forbidden', key);
export const NotFound = (key = 'errors.notFound') => new AppError(404, 'not_found', key);
export const BadRequest = (key = 'errors.badRequest', meta?: Record<string, unknown>) =>
  new AppError(400, 'bad_request', key, meta);
export const Conflict = (key = 'errors.conflict') => new AppError(409, 'conflict', key);
export const TooManyRequests = (key = 'errors.tooManyRequests', meta?: Record<string, unknown>) =>
  new AppError(429, 'too_many_requests', key, meta);
export const PayloadTooLarge = (key = 'errors.payloadTooLarge') =>
  new AppError(413, 'payload_too_large', key);
export const PlanLimit = (key = 'errors.planLimit', meta?: Record<string, unknown>) =>
  new AppError(402, 'plan_limit', key, meta);
