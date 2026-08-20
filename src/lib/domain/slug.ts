import { randomBytes } from 'node:crypto';

/**
 * URL slug for a centre. A short random tail keeps two centres with the same
 * name from colliding without exposing a sequential id.
 */
export function centerSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'markaz'}-${randomBytes(3).toString('hex')}`;
}
