import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { prisma } from '../db';
import { randomToken, sha256, hashIp } from '../crypto';
import { isProd } from '../env';
import type { OrgRole } from '@/generated/prisma/enums';

export const SESSION_COOKIE = '__Host-ustozly_session';
const IDLE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days of inactivity
const ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days maximum
const RENEW_THRESHOLD_MS = 1000 * 60 * 30;

export type SessionUser = {
  sessionId: string;
  csrfSecret: string;
  userId: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  firstName: string;
  lastName: string | null;
  locale: 'UZ' | 'RU' | 'EN';
  timezone: string;
  avatarFileId: string | null;
  activeOrgId: string | null;
  role: OrgRole | null;
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // __Host- prefix requires secure+path=/ and no domain. In local http dev the
    // browser tolerates it on localhost.
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Creates a server-side session and sets the opaque cookie. */
export async function createSession(userId: string, activeOrgId?: string | null) {
  const token = randomToken(32);
  const csrfSecret = randomToken(24).slice(0, 64);
  const now = Date.now();
  const hdrs = await headers();

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfSecret,
      activeOrgId: activeOrgId ?? null,
      userAgent: hdrs.get('user-agent')?.slice(0, 400) ?? null,
      ipHash: hashIp(clientIp(hdrs)),
      expiresAt: new Date(now + IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(Math.floor(ABSOLUTE_TTL_MS / 1000)));
  return session;
}

/** Session fixation defence: issue a brand new token, kill the old row. */
export async function rotateSession(sessionId: string) {
  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing) return null;
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
  return createSession(existing.userId, existing.activeOrgId);
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  store.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolves the current user from the session cookie. Deduped per request via
 * React `cache` so multiple server components share one query.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { profile: true } } },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < now ||
    session.absoluteExpiresAt < now ||
    !session.user.isActive ||
    session.user.deletedAt
  ) {
    return null;
  }

  // Sliding idle window, written at most every 30 minutes.
  if (now.getTime() - session.lastSeenAt.getTime() > RENEW_THRESHOLD_MS) {
    const nextExpiry = new Date(Math.min(now.getTime() + IDLE_TTL_MS, session.absoluteExpiresAt.getTime()));
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: nextExpiry },
    });
  }

  let activeOrgId = session.activeOrgId;
  let role: OrgRole | null = null;

  if (activeOrgId) {
    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: activeOrgId, userId: session.userId, removedAt: null },
    });
    if (membership) role = membership.role;
    else activeOrgId = null; // membership was revoked — drop the tenant context
  }

  if (!activeOrgId) {
    const fallback = await prisma.organizationMember.findFirst({
      where: { userId: session.userId, removedAt: null },
      orderBy: { joinedAt: 'asc' },
    });
    if (fallback) {
      activeOrgId = fallback.organizationId;
      role = fallback.role;
      await prisma.session.update({ where: { id: session.id }, data: { activeOrgId } });
    }
  }

  const p = session.user.profile;
  return {
    sessionId: session.id,
    csrfSecret: session.csrfSecret,
    userId: session.userId,
    email: session.user.email,
    phone: session.user.phone,
    emailVerified: Boolean(session.user.emailVerified),
    phoneVerified: Boolean(session.user.phoneVerified),
    firstName: p?.firstName ?? '',
    lastName: p?.lastName ?? null,
    locale: p?.locale ?? 'UZ',
    timezone: p?.timezone ?? 'Asia/Tashkent',
    avatarFileId: p?.avatarFileId ?? null,
    activeOrgId,
    role,
  };
});

export async function switchOrganization(sessionId: string, userId: string, orgId: string) {
  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId, removedAt: null },
  });
  if (!membership) return false;
  await prisma.session.update({ where: { id: sessionId }, data: { activeOrgId: orgId } });
  return true;
}

export function clientIp(hdrs: Headers): string | null {
  // Only trust the left-most hop when a proxy is in front; document the
  // trusted-proxy assumption in DEPLOYMENT.md.
  const fwd = hdrs.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return hdrs.get('x-real-ip');
}
