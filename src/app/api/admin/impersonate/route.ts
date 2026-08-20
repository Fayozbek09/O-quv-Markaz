import { prisma } from '@/lib/db';
import { adminMutation, json, noContent, readJson } from '@/lib/api';
import { adminImpersonateSchema } from '@/lib/validation/schemas';
import { startImpersonation, stopImpersonation } from '@/lib/auth/admin-session';
import { auditAdmin } from '@/lib/admin';
import { NotFound } from '@/lib/errors';

/**
 * Starts a "view as centre" session.
 *
 * It is never silent: the admin has to give a reason, the reason and the target
 * are written to the audit log before the session flips, and every page then
 * renders a persistent banner (see components/layout/ImpersonationBanner).
 */
export const POST = adminMutation(async (admin, request) => {
  const body = await readJson(request, adminImpersonateSchema);

  const org = await prisma.organization.findFirst({
    where: { id: body.organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!org) throw NotFound();

  await auditAdmin({
    adminId: admin.adminId,
    organizationId: org.id,
    action: 'admin.impersonate.start',
    entityType: 'organization',
    entityId: org.id,
    meta: { reason: body.reason, centerName: org.name },
  });
  await startImpersonation(admin.sessionId, org.id);

  return json({ ok: true, organizationId: org.id, redirectTo: '/center' });
});

/** Ends it. */
export const DELETE = adminMutation(async (admin) => {
  if (admin.impersonatingOrgId) {
    await auditAdmin({
      adminId: admin.adminId,
      organizationId: admin.impersonatingOrgId,
      action: 'admin.impersonate.stop',
      entityType: 'organization',
      entityId: admin.impersonatingOrgId,
    });
  }
  await stopImpersonation(admin.sessionId);
  return noContent();
});
