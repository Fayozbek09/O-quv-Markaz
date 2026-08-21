import { notFound, redirect } from 'next/navigation';
import { AppError } from './errors';
import { requireOrg, type OrgContext } from './tenant';
import { requireAdmin, type AdminContext } from './admin';
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
 * `requireOrg` for a server component.
 *
 * The bare call throws an `AppError`, which is right for an API route that owes
 * the caller a 403. In a page it escapes to the error boundary, and because
 * Next renders a page segment alongside its layout, an anonymous or refused
 * request logged `⨯ Error [AppError]: forbidden` on every hit even though the
 * layout's redirect is what the reader actually got. Routing through `loadPage`
 * makes the page redirect on its own account rather than relying on its layout,
 * and leaves the server log carrying real faults only.
 */
export async function requireOrgPage(permission?: Permission): Promise<OrgContext> {
  return loadPage(() => requireOrg(permission));
}

/**
 * `requireAdmin` for a server component, for the same reason as
 * `requireOrgPage`. A centre session at an /admin page is a 403 and an
 * anonymous one a 401; both belong at /admin/login, not in the crash boundary
 * and not in the server log.
 */
export async function requireAdminPage(): Promise<AdminContext> {
  try {
    return await requireAdmin();
  } catch (err) {
    if (err instanceof AppError && (err.status === 401 || err.status === 403)) {
      redirect('/admin/login');
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
