import { notFound, redirect } from 'next/navigation';
import { AppError } from './errors';
import type { OrgContext } from './tenant';
import type { Permission } from './rbac';

/**
 * Bridges the domain layer's typed errors into Next's page conventions.
 *
 * Server components have no error translator of their own: an `AppError`
 * thrown by a loader escapes to the nearest boundary and renders a 500. That is
 * wrong twice over — a foreign or malformed id should be a 404, and a 500 tells
 * a prober that something unusual happened. Wrapping the loads maps:
 *
 *   404 -> notFound()          (the same answer a foreign tenant id gets)
 *   403 -> /forbidden          (signed in, but not allowed here)
 *   401 -> /login
 *
 * and lets anything genuinely unexpected keep bubbling.
 */
export async function loadPage<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof AppError) {
      if (err.status === 404) notFound();
      if (err.status === 403) redirect('/forbidden');
      if (err.status === 401) redirect('/login');
    }
    throw err;
  }
}

/**
 * Page-level permission gate.
 *
 * `assertPermission` throws, which is right for an API route that owes the
 * caller a 403. In a server component the same throw escapes to the client
 * error boundary, and that boundary cannot tell a refusal from a crash — Next
 * strips the detail in production — so the reader was shown "Something went
 * wrong" and a Try again button that would never work.
 *
 * Pages therefore redirect to the page that says what actually happened. The
 * check is the same one either way; only the way it is reported differs.
 */
export function requirePagePermission(ctx: OrgContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) redirect('/forbidden');
}
