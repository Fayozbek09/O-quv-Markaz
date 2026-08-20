import { headers } from 'next/headers';
import { prisma } from '../db';
import { hashIp } from '../crypto';
import { clientIp } from '../auth/session';

export type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorAdminId?: string | null;
  isOverride?: boolean;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'failure' | 'denied';
  meta?: Record<string, unknown>;
};

/** Keys that must never reach the audit log, at any nesting level. */
const FORBIDDEN = /pass|secret|token|otp|code|authorization|cookie|key|hash/i;

export function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrub(v as Record<string, unknown>);
    } else if (typeof v === 'string' && v.length > 300) {
      out[k] = `${v.slice(0, 300)}…`;
    } else {
      out[k] = v as unknown;
    }
  }
  return out;
}

export async function audit(input: AuditInput): Promise<void> {
  let ipHash: string | null = null;
  let userAgent: string | null = null;
  try {
    const hdrs = await headers();
    ipHash = hashIp(clientIp(hdrs));
    userAgent = hdrs.get('user-agent')?.slice(0, 300) ?? null;
  } catch {
    // Outside a request scope (jobs, tests) — headers are unavailable.
  }

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorAdminId: input.actorAdminId ?? null,
      isOverride: input.isOverride ?? false,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? 'success',
      ipHash,
      userAgent,
      meta: scrub(input.meta) as object,
    },
  });
}
