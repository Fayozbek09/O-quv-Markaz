/**
 * Browser-side fetch wrapper. Every mutating call carries the per-session CSRF
 * token and `credentials: 'same-origin'`, so a token can never be sent to a
 * third-party host by mistake.
 */
export type ApiError = { error: string; messageKey: string; fields?: Record<string, string> };

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiError,
  ) {
    super(payload.messageKey);
    this.name = 'ApiFailure';
  }
}

export async function apiFetch<T>(
  url: string,
  options: { method?: string; body?: unknown; csrfToken?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD' && options.csrfToken) {
    headers['x-csrf-token'] = options.csrfToken;
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiFailure(res.status, (payload as ApiError) ?? { error: 'error', messageKey: 'errors.server' });
  }
  return payload as T;
}
