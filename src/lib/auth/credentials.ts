import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { hashPassword } from './password';

/**
 * Credential provisioning for accounts a centre creates on someone's behalf
 * (teachers, receptionists, students).
 *
 * Two rules drive this file:
 *   1. usernames are globally unique, because there is one login page and the
 *      server must be able to resolve a handle to exactly one account;
 *   2. the password is always freshly generated from a CSPRNG. There is no
 *      default password, no password derived from the name, and no reuse
 *      between two accounts created in the same breath.
 */

const ROLE_PREFIX = {
  ADMIN: 'admin',
  RECEPTIONIST: 'reception',
  TEACHER: 'teacher',
  STUDENT: 'student',
  OWNER: 'owner',
  ASSISTANT: 'reception',
} as const;

export type UsernameRole = keyof typeof ROLE_PREFIX;

/** Uzbek Latin letters map onto ASCII cleanly; anything else is dropped. */
const TRANSLIT: Record<string, string> = {
  ʻ: '', ʼ: '', "'": '', '‘': '', '’': '', '`': '',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

export function slugifyName(value: string): string {
  const lowered = value.toLowerCase().normalize('NFKD');
  let out = '';
  for (const ch of lowered) {
    if (ch in TRANSLIT) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/[\s._-]/.test(ch)) out += '.';
  }
  return out
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 40);
}

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'superuser', 'system', 'support', 'help',
  'api', 'login', 'logout', 'register', 'null', 'undefined', 'owner', 'platform',
  'oquvmarkaz', 'omarkaz',
]);

/**
 * Builds a globally unique username. On collision the candidate is suffixed
 * with an increasing number — never with a shared fallback — and the caller is
 * told which handle was actually issued so it can show it to the creator.
 */
export async function generateUsername(input: {
  firstName: string;
  lastName?: string | null;
  role: UsernameRole;
  /** Explicit request from the creator; still validated and de-duplicated. */
  preferred?: string | null;
}): Promise<{ username: string; wasTaken: boolean; requested: string | null }> {
  const prefix = ROLE_PREFIX[input.role];
  const requested = input.preferred ? slugifyName(input.preferred) : null;

  const nameSlug =
    slugifyName([input.lastName, input.firstName].filter(Boolean).join('.')) || 'user';
  const base =
    requested && requested.length >= 3 && !RESERVED.has(requested)
      ? requested
      : `${prefix}.${nameSlug}`.slice(0, 48);

  if (!(await isTaken(base))) {
    return { username: base, wasTaken: false, requested };
  }

  // Sequential suffixes first — they read well — then a random tail if the
  // centre really has 60 people with the same name.
  for (let n = 2; n <= 60; n += 1) {
    const candidate = `${base}${n}`;
    if (!(await isTaken(candidate))) {
      return { username: candidate, wasTaken: true, requested };
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base}.${randomUUID().slice(0, 6)}`;
    if (!(await isTaken(candidate))) {
      return { username: candidate, wasTaken: true, requested };
    }
  }
  throw new Error('username_exhausted');
}

async function isTaken(username: string): Promise<boolean> {
  const [user, admin] = await Promise.all([
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.platformAdmin.findUnique({ where: { username }, select: { id: true } }),
  ]);
  return Boolean(user || admin);
}

export const usernameAvailable = async (username: string) => !(await isTaken(username));

/**
 * Temporary password.
 *
 * Character classes that cannot be confused when read off a printed slip
 * (no O/0, no l/1/I), 14 characters ≈ 72 bits of entropy, sampled with
 * `randomInt` so there is no modulo bias.
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SYMBOLS = '!@#$%*?';
/** Same exclusion as the alphabet: no 0/1, which are read as O/l. */
const DIGITS = '23456789';

export function generateTempPassword(length = 14): string {
  const chars: string[] = [];
  for (let i = 0; i < length - 2; i += 1) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)]!);
  }
  chars.push(SYMBOLS[randomInt(SYMBOLS.length)]!);
  chars.push(DIGITS[randomInt(DIGITS.length)]!);
  // Fisher-Yates so the guaranteed symbol/digit are not always at the end.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** How long an unused temporary password stays valid. */
export const TEMP_CREDENTIAL_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export async function buildTempCredentials(input: {
  firstName: string;
  lastName?: string | null;
  role: UsernameRole;
  preferred?: string | null;
}) {
  const { username, wasTaken, requested } = await generateUsername(input);
  const password = generateTempPassword();
  return {
    username,
    password,
    wasTaken,
    requested,
    passwordHash: await hashPassword(password),
    credentialsExpireAt: new Date(Date.now() + TEMP_CREDENTIAL_TTL_MS),
  };
}

/** Centre-scoped student number: 2026-0007. */
export async function nextStudentNo(organizationId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.student.count({ where: { organizationId } });
  for (let n = count + 1; n < count + 500; n += 1) {
    const candidate = `${year}-${String(n).padStart(4, '0')}`;
    const clash = await prisma.student.findFirst({
      where: { organizationId, studentNo: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${year}-${randomUUID().slice(0, 6)}`;
}
