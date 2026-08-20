import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters. 19 MiB / t=2 / p=1 is the OWASP Password Storage
 * Cheat Sheet baseline for Argon2id.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const hashPassword = (plain: string) => hash(plain, OPTIONS);

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    return false;
  }
}

/** A dummy verify so that "user not found" costs the same as "wrong password". */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
export async function fakeVerify(plain: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plain, OPTIONS);
  } catch {
    /* expected */
  }
}

/** Minimum policy; the UI shows a strength meter on top of this. */
export function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 10) issues.push('auth.passwordRules.tooShort');
  if (pw.length > 200) issues.push('auth.passwordRules.tooLong');
  if (!/[a-zA-Z]/.test(pw)) issues.push('auth.passwordRules.needsLetter');
  if (!/[0-9]/.test(pw)) issues.push('auth.passwordRules.needsDigit');
  return issues;
}
