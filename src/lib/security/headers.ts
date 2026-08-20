import { isProd } from '../env';

/**
 * Content Security Policy. `strict-dynamic` + a per-request nonce means an
 * injected <script> without the nonce cannot execute, even if output encoding
 * somewhere fails.
 */
export function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`; // dev needs eval for HMR

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind injects a style element
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isProd ? '' : ' ws: wss:'}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    isProd ? `upgrade-insecure-requests` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function securityHeaders(nonce: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(nonce),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'X-DNS-Prefetch-Control': 'off',
  };
  if (isProd) {
    h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }
  return h;
}
