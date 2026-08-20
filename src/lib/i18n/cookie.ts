import { isProd } from '../env';
export { LOCALE_COOKIE } from './config';

export const localeCookieOptions = () => ({
  httpOnly: false, // read by the switcher for optimistic UI
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
});
