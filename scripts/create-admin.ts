import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hash } from '@node-rs/argon2';

/**
 * Creates or rotates the platform administrator.
 *
 *   npm run admin:create           # generate a username and password
 *   ADMIN_PASSWORD=… npm run admin:create   # set a known password (CI, staging)
 *
 * The password is printed exactly once, to this terminal, and only its Argon2id
 * hash is stored. There is no default password anywhere in the codebase and no
 * way to read an existing one back — a forgotten password is rotated, not
 * recovered.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

const FULL_NAME = process.env.ADMIN_FULL_NAME ?? 'Iskandarov Fayozbek';

/**
 * A guessable admin handle is half of a brute-force attempt. The name is used
 * as a mnemonic stem, but a random tail keeps the handle from being derivable
 * from the person's name alone.
 */
function buildUsername(fullName: string): string {
  const parts = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  const last = parts[0] ?? 'admin';
  const first = parts[1] ?? '';
  const stem = `${first.slice(0, 1)}.${last}`.replace(/[^a-z0-9.]/g, '');
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 5; i += 1) tail += alphabet[randomInt(alphabet.length)];
  return `${stem}.${tail}`;
}

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*?-_';

/** 24 characters from a CSPRNG — roughly 137 bits for the platform account. */
function generatePassword(length = 24): string {
  const chars: string[] = [];
  for (let i = 0; i < length - 3; i += 1) {
    chars.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]!);
  }
  chars.push(PASSWORD_SYMBOLS[randomInt(PASSWORD_SYMBOLS.length)]!);
  chars.push(PASSWORD_SYMBOLS[randomInt(PASSWORD_SYMBOLS.length)]!);
  chars.push(String(randomInt(10)));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

export async function ensurePlatformAdmin(options: { quiet?: boolean } = {}) {
  const existing = await prisma.platformAdmin.findFirst({ orderBy: { createdAt: 'asc' } });

  const username =
    process.env.ADMIN_USERNAME?.toLowerCase() ?? existing?.username ?? buildUsername(FULL_NAME);
  const chosen = process.env.ADMIN_PASSWORD;
  const password = chosen ?? generatePassword();

  if (chosen && chosen.length < 16) {
    throw new Error('ADMIN_PASSWORD must be at least 16 characters');
  }

  // A generated password is a transport secret: it has been through a terminal
  // and whatever carried it to the person. It gets them in once, then they
  // choose their own. A password set deliberately through ADMIN_PASSWORD is
  // already the operator's own choice, so it is not treated as temporary.
  const mustChangePassword = !chosen;

  const passwordHash = await hash(password, ARGON);

  const admin = existing
    ? await prisma.platformAdmin.update({
        where: { id: existing.id },
        data: {
          username,
          fullName: FULL_NAME,
          passwordHash,
          mustChangePassword,
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
        },
      })
    : await prisma.platformAdmin.create({
        data: { username, fullName: FULL_NAME, passwordHash, mustChangePassword, isActive: true },
      });

  // Rotating the secret must not leave older sessions alive.
  await prisma.adminSession.updateMany({
    where: { adminId: admin.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (!options.quiet) {
    printCredentials(username, password, Boolean(existing), mustChangePassword);
  }
  return { username, password, rotated: Boolean(existing), mustChangePassword };
}

export function printCredentials(
  username: string,
  password: string,
  rotated: boolean,
  mustChangePassword = false,
) {
  console.info(`
============================================================
  PLATFORM ADMINISTRATOR ${rotated ? '(rotated)' : '(created)'}
  ${FULL_NAME}
------------------------------------------------------------
  URL:       /admin/login
  username:  ${username}
  password:  ${password}
------------------------------------------------------------
  Shown once. Only the Argon2id hash is stored.${
    mustChangePassword
      ? '\n  Temporary: /admin/login will ask for a new password of at\n  least 16 characters before letting you in.'
      : ''
  }
  To rotate:  npm run admin:create
  Or from the UI: /admin -> change password
============================================================
`);
}

// Only run when invoked directly, not when imported by the seed.
const invokedDirectly = process.argv[1]?.includes('create-admin');
if (invokedDirectly) {
  ensurePlatformAdmin()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
