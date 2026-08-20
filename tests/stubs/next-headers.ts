/**
 * Stand-in for `next/headers` in unit and domain tests, which run outside a
 * request scope. HTTP-level behaviour (real cookies, real CSRF) is covered by
 * the tests in tests/http, which drive a running server instead.
 */
const store = new Map<string, string>();

export async function headers(): Promise<Headers> {
  return new Headers({ 'user-agent': 'vitest', 'x-forwarded-for': '127.0.0.1' });
}

export async function cookies() {
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name) as string } : undefined),
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
  };
}
