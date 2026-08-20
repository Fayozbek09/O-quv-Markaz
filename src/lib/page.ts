import { notFound, redirect } from 'next/navigation';
import { AppError } from './errors';

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
