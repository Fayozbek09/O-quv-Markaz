import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs on every request. Two jobs:
 *   1. mint a per-request CSP nonce and attach the security headers;
 *   2. reject cross-origin state-changing requests before they reach a route.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Kept in step with lib/security/headers.ts. The middleware cannot import that
 * module — it would pull the server-only env parser into the edge bundle — so
 * the challenge host is read from the raw variable here.
 */
const CHALLENGE_HOSTS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com',
  hcaptcha: 'https://hcaptcha.com https://*.hcaptcha.com',
  recaptcha: 'https://www.google.com https://www.gstatic.com',
};

function csp(nonce: string, isProd: boolean): string {
  const provider = process.env.CAPTCHA_PROVIDER ?? 'none';
  const challengeHost = provider !== 'none' ? (CHALLENGE_HOSTS[provider] ?? '') : '';
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}${challengeHost ? ` ${challengeHost}` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${challengeHost ? ` ${challengeHost}` : ''}${isProd ? '' : ' ws: wss:'}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-src ${challengeHost || `'none'`}`,
    `worker-src 'self' blob:`,
    isProd ? 'upgrade-insecure-requests' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function middleware(request: NextRequest) {
  const isProd = process.env.NODE_ENV === 'production';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Same-origin check for anything that mutates state. Route handlers repeat
  // this with a per-session CSRF token; this is the cheap outer gate.
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin) {
      const expected = process.env.APP_URL ?? request.nextUrl.origin;
      if (new URL(origin).origin !== new URL(expected).origin) {
        return NextResponse.json({ error: 'forbidden', messageKey: 'errors.csrf' }, { status: 403 });
      }
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // User-uploaded bytes are served from /api/files/*. They get a far stricter
  // policy than the app: nothing may load, and nothing may run. Setting it here
  // rather than only in the route means the middleware cannot accidentally
  // relax what the route hardened.
  const isUserContent = request.nextUrl.pathname.startsWith('/api/files/');
  response.headers.set(
    'Content-Security-Policy',
    isUserContent ? "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'" : csp(nonce, isProd),
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  if (isProd) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static output.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
