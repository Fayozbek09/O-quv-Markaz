import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../env';
import { hmac, safeEqual } from '../crypto';
import { Forbidden, NotFound } from '../errors';

const ROOT = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

/** Random, unguessable key. The client's filename is never used. */
export function newStorageKey(prefix: string, extension: string): string {
  const safePrefix = prefix.replace(/[^a-z0-9/_-]/gi, '');
  const id = randomBytes(16).toString('hex');
  return `${safePrefix}/${id}${extension}`;
}

/**
 * Resolves a storage key to an absolute path, refusing anything that escapes
 * the storage root. This is the path-traversal guard: `../../etc/passwd` and
 * URL-encoded variants both fail here.
 */
function resolveSafe(storageKey: string): string {
  if (storageKey.includes('\0')) throw NotFound();
  const decoded = decodeURIComponent(storageKey);
  const target = path.resolve(ROOT, decoded);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw Forbidden();
  return target;
}

export async function putObject(storageKey: string, data: Buffer): Promise<void> {
  const target = resolveSafe(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  // 0600: readable only by the application user, never by a static web server.
  await writeFile(target, data, { mode: 0o600 });
}

export async function getObject(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(resolveSafe(storageKey));
  } catch {
    throw NotFound();
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  try {
    await unlink(resolveSafe(storageKey));
  } catch {
    /* already gone */
  }
}

/**
 * Files are private. Access goes through a short-lived signed URL bound to the
 * file id and its expiry - guessing a file id is not enough to read it.
 */
export const SIGNED_URL_TTL_MS = 10 * 60_000;

export function signFileUrl(fileId: string, ttlMs = SIGNED_URL_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const sig = hmac(env.FILE_URL_SECRET, `${fileId}.${exp}`);
  return `/api/files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  return safeEqual(sig, hmac(env.FILE_URL_SECRET, `${fileId}.${expiry}`));
}
