import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AppError, BadRequest, PayloadTooLarge } from './errors';
import { assertCsrf } from './security/csrf';
import { requireOrg, requireUser, type OrgContext } from './tenant';
import { isProd } from './env';
import type { OrgRole } from '@/generated/prisma/enums';

/** Largest JSON body any route will parse. */
const MAX_BODY_BYTES = 256 * 1024;

/** BigInt money values are emitted as decimal strings. */
function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(serialize(data), {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export const noContent = () =>
  new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/**
 * Turns any thrown value into a safe response. A stack trace or a raw driver
 * error never reaches the client; the server log keeps the detail.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { error: err.code, messageKey: err.messageKey };
    if (err.meta) body.meta = err.meta;
    return NextResponse.json(body, {
      status: err.status,
      headers: {
        'cache-control': 'no-store',
        ...(err.status === 429 && typeof err.meta?.retryAfterSec === 'number'
          ? { 'retry-after': String(err.meta.retryAfterSec) }
          : {}),
      },
    });
  }

  if (err instanceof ZodError) {
    // Field-level messages are translation keys, not raw Zod prose.
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      if (!fields[path]) fields[path] = issue.message;
    }
    return NextResponse.json(
      { error: 'validation', messageKey: 'errors.validation', fields },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Unexpected: log server-side, return an opaque message.
  console.error('[unhandled]', err instanceof Error ? err.stack : err);
  return NextResponse.json(
    { error: 'server_error', messageKey: 'errors.server' },
    { status: 500, headers: { 'cache-control': 'no-store' } },
  );
}

/** Parses and validates a JSON body, enforcing a hard size ceiling. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) throw PayloadTooLarge();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw PayloadTooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw BadRequest();
  }
  // Reject arrays and primitives at the top level - every endpoint takes an object.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw BadRequest();

  return schema.parse(parsed);
}

/** Validates URL search params against a schema (query-string parameters only). */
export function readQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const entries: Record<string, string> = {};
  // Last value wins for repeated keys - defends against parameter pollution
  // producing an array where a string is expected.
  for (const [key, value] of url.searchParams.entries()) entries[key] = value;
  return schema.parse(entries);
}

type Handler<T> = (args: T) => Promise<NextResponse> | NextResponse;

/** Read-only route: authenticated + tenant-scoped, no CSRF token needed. */
export function orgRoute<P = unknown>(
  handler: (ctx: OrgContext, request: Request, params: P) => Promise<NextResponse>,
  minRole: OrgRole = 'ASSISTANT',
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const ctx = await requireOrg(minRole);
      const params = (await context?.params) ?? ({} as P);
      return await handler(ctx, request, params);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Mutating route: authenticated + tenant-scoped + CSRF verified. */
export function orgMutation<P = unknown>(
  handler: (ctx: OrgContext, request: Request, params: P) => Promise<NextResponse>,
  minRole: OrgRole = 'TEACHER',
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const ctx = await requireOrg(minRole);
      await assertCsrf(ctx.user.csrfSecret);
      const params = (await context?.params) ?? ({} as P);
      return await handler(ctx, request, params);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Authenticated but not tenant-scoped (profile, session, workspace creation). */
export function userMutation(
  handler: (
    user: Awaited<ReturnType<typeof requireUser>>,
    request: Request,
  ) => Promise<NextResponse>,
) {
  return async (request: Request) => {
    try {
      const user = await requireUser();
      await assertCsrf(user.csrfSecret);
      return await handler(user, request);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Public route (login, register, webhooks) with uniform error handling. */
export function publicRoute<T = Request>(handler: Handler<T>) {
  return async (request: T) => {
    try {
      return await handler(request);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const devOnly = () => !isProd;
