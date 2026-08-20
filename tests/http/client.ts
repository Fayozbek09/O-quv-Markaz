import { BASE_URL } from './server';

/** A cookie jar, so a test can hold two independent logged-in sessions. */
export class Session {
  private cookies = new Map<string, string>();
  csrfToken: string | null = null;

  get cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (index <= 0 || !pair) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /Max-Age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(
    path: string,
    init: RequestInit & { json?: unknown; csrf?: boolean | string; origin?: string | null } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) headers.set('cookie', this.cookieHeader);
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (init.origin !== null) headers.set('origin', init.origin ?? BASE_URL);

    if (init.csrf === true && this.csrfToken) headers.set('x-csrf-token', this.csrfToken);
    else if (typeof init.csrf === 'string') headers.set('x-csrf-token', init.csrf);

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    this.absorb(response);
    return response;
  }

  /** Fetches this session's own CSRF token, the way a browser client would. */
  async loadCsrf(): Promise<string> {
    const res = await this.fetch('/api/csrf');
    if (!res.ok) throw new Error(`csrf fetch failed: ${res.status}`);
    const body = (await res.json()) as { csrfToken: string };
    this.csrfToken = body.csrfToken;
    return this.csrfToken;
  }
}
