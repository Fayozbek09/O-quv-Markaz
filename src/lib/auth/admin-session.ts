import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { prisma } from '../db';
import { randomToken, sha256, hashIp } from '../crypto';
import { clientIp } from './session';

/**
 * Platform-administrator sessions.
 *
 * Deliberately a separate cookie, a separate table and a separate resolver from
 * the centre-user session in ./session.ts. A centre session can never be read
 * as an admin session and vice versa, so a bug in one path cannot escalate into
 * the other. Admin sessions are also far shorter-lived.
 */
export const ADMIN_SESSION_COOKIE = '__Host-omarkaz_admin';

const IDLE_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours of inactivity
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 8; // one working day, maximum
const RENEW_THRESHOLD_MS = 1000 * 60 * 5;

export type AdminSessionUser = {
  sessionId: string;
  csrfSecret: string;
  adminId: string;
  username: string;
  fullName: string;
  mustChangePassword: boolean;
  /** Non-null while the admin is viewing a centre through the override path. */
  impersonatingOrgId: string | null;
  impersonationStartedAt: Date | null;
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // __Host- requires Secure; browsers treat http://localhost as trustworthy.
    secure: true,
    sameSite: 'strict' as const, // stricter than the centre cookie: no cross-site entry at all
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function createAdminSession(adminId: string) {
  const token = randomToken(32);
  const now = Date.now();
  const hdrs = await headers();

  const session = await prisma.adminSession.create({
    data: {
      adminId,
      tokenHash: sha256(token),
      csrfSecret: randomToken(24).slice(0, 64),
      userAgent: hdrs.get('user-agent')?.slice(0, 400) ?? null,
      ipHash: hashIp(clientIp(hdrs)),
      expiresAt: new Date(now + IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
    },
  });

  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, token, cookieOptions(Math.floor(ABSOLUTE_TTL_MS / 1000)));
  return session;
}

export async function destroyAdminSession() {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) {
    await prisma.adminSession.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  store.delete(ADMIN_SESSION_COOKIE);
}

export async function revokeAllAdminSessions(adminId: string) {
  await prisma.adminSession.updateMany({
    where: { adminId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const getAdminSession = cache(async (): Promise<AdminSessionUser | null> => {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { admin: true },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < now ||
    session.absoluteExpiresAt < now ||
    !session.admin.isActive
  ) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > RENEW_THRESHOLD_MS) {
    await prisma.adminSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: new Date(
          Math.min(now.getTime() + IDLE_TTL_MS, session.absoluteExpiresAt.getTime()),
        ),
      },
    });
  }

  return {
    sessionId: session.id,
    csrfSecret: session.csrfSecret,
    adminId: session.adminId,
    username: session.admin.username,
    fullName: session.admin.fullName,
    mustChangePassword: session.admin.mustChangePassword,
    impersonatingOrgId: session.impersonatingOrgId,
    impersonationStartedAt: session.impersonationStartedAt,
  };
});

/** Starts an explicit, visible "view as centre" session. */
export async function startImpersonation(sessionId: string, organizationId: string) {
  await prisma.adminSession.update({
    where: { id: sessionId },
    data: { impersonatingOrgId: organizationId, impersonationStartedAt: new Date() },
  });
}

export async function stopImpersonation(sessionId: string) {
  await prisma.adminSession.update({
    where: { id: sessionId },
    data: { impersonatingOrgId: null, impersonationStartedAt: null },
  });
}
