import { prisma } from '@/lib/db';
import { json, orgMutation, readJson } from '@/lib/api';
import { updateWorkspaceSchema } from '@/lib/validation/schemas';
import { DB_LOCALE } from '@/lib/i18n/config';
import { audit } from '@/lib/security/audit';

export const PUT = orgMutation(async (ctx, request) => {
  const body = await readJson(request, updateWorkspaceSchema);

  await prisma.organization.update({
    where: { id: ctx.orgId },
    data: {
      name: body.name,
      address: body.address,
      phone: body.phone,
      telegramHandle: body.telegramHandle,
      defaultCurrency: body.defaultCurrency,
      timezone: body.timezone,
      locale: DB_LOCALE[body.locale],
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'organization.update',
    entityType: 'organization',
    entityId: ctx.orgId,
  });
  return json({ ok: true });
}, 'center.settings');
