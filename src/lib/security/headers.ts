import { env, isProd } from '../env';

/**
 * Content Security Policy. `strict-dynamic` + a per-request nonce means an
 * injected <script> without the nonce cannot execute, even if output encoding
 * somewhere fails.
 */
/**
 * A challenge widget is third-party script in a policy that otherwise allows
 * none. The host is added only when that provider is actually configured, so a
 * deployment running without a challenge keeps the tighter policy — and a
 * misconfigured one fails visibly rather than silently loading nothing.
 */
const CHALLENGE_HOSTS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com',
  hcaptcha: 'https://hcaptcha.com https://*.hcaptcha.com',
  recaptcha: 'https://www.google.com https://www.gstatic.com',
};

const challengeHost = env.CAPTCHA_PROVIDER !== 'none' ? CHALLENGE_HOSTS[env.CAPTCHA_PROVIDER] : '';

export function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`; // dev needs eval for HMR

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}${challengeHost ? ` ${challengeHost}` : ''}`,
    `style-src 'self' 'unsafe-inline'`, // Tailwind injects a style element
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${challengeHost ? ` ${challengeHost}` : ''}${isProd ? '' : ' ws: wss:'}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-src ${challengeHost || `'none'`}`,
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
