import { prisma } from '../db';
import { scope, findOwned, assertAllOwned, type OrgContext } from '../tenant';
import { audit } from '../security/audit';
import { notify, groupStudentUserIds, centerStaffUserIds } from '../notifications/notify';
import { BadRequest } from '../errors';
import type { AnnouncementAudience, OrgRole } from '@/generated/prisma/enums';
import type { z } from 'zod';
import type { announcementInputSchema } from '../validation/schemas';

/**
 * Centre announcements.
 *
 * A notice is written once and read by whoever it is addressed to. The
 * addressing is resolved server-side, both when the notice is posted (to decide
 * who gets a notification) and when it is read (to decide whose list it
 * appears in) — a reader never says which audience they belong to.
 */

type AnnouncementInput = z.infer<typeof announcementInputSchema>;

/** Audiences a given centre role is entitled to read. */
function audiencesFor(role: OrgRole): AnnouncementAudience[] {
  if (role === 'STUDENT') return ['EVERYONE', 'STUDENTS'];
  if (role === 'TEACHER') return ['EVERYONE', 'STAFF', 'TEACHERS'];
  return ['EVERYONE', 'STAFF', 'TEACHERS', 'STUDENTS'];
}

const live = { deletedAt: null } as const;

/**
 * Notices that have not been withdrawn or expired.
 *
 * Returned as an `AND` clause rather than a bare `OR`, because every caller
 * also filters on an audience `OR`. Spreading two objects that both carry an
 * `OR` key silently keeps only the last one — which is how an expired notice
 * once stayed on the page.
 */
const currentFilter = (now: Date) => ({
  ...live,
  AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
});

export async function listAnnouncements(ctx: OrgContext, limit = 50) {
  return prisma.announcement.findMany({
    where: { ...scope.org(ctx), ...live },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      group: { select: { id: true, name: true } },
      author: {
        select: {
          id: true,
          user: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
}

/**
 * What a member of staff should see on their own dashboard: everything
 * addressed to their role, plus anything aimed at a group they teach.
 */
export async function announcementsForMember(ctx: OrgContext, limit = 10) {
  const now = new Date();
  return prisma.announcement.findMany({
    where: {
      ...scope.org(ctx),
      ...currentFilter(now),
      OR: [
        { audience: { in: audiencesFor(ctx.role) } },
        ...(ctx.memberId ? [{ audience: 'GROUP' as const, group: { teacherId: ctx.memberId } }] : []),
      ],
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { group: { select: { name: true } } },
  });
}

/**
 * What one student should see.
 *
 * Scoped from the student's own record — their centre and their current group
 * memberships — never from anything the request supplied.
 */
export async function announcementsForStudent(
  sc: { studentId: string; organizationId: string },
  limit = 10,
) {
  const memberships = await prisma.groupMember.findMany({
    where: { organizationId: sc.organizationId, studentId: sc.studentId, leftAt: null },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const now = new Date();

  return prisma.announcement.findMany({
    where: {
      organizationId: sc.organizationId,
      ...currentFilter(now),
      OR: [
        { audience: { in: ['EVERYONE', 'STUDENTS'] } },
        ...(groupIds.length > 0
          ? [{ audience: 'GROUP' as const, groupId: { in: groupIds } }]
          : []),
      ],
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { group: { select: { name: true } } },
  });
}

/** Everyone a notice should reach, as account ids. */
async function recipientsFor(
  orgId: string,
  audience: AnnouncementAudience,
  groupId: string | null,
): Promise<string[]> {
  switch (audience) {
    case 'GROUP':
      return groupId ? groupStudentUserIds(orgId, groupId) : [];
    case 'STUDENTS': {
      const rows = await prisma.student.findMany({
        where: { organizationId: orgId, deletedAt: null, userId: { not: null } },
        select: { userId: true },
      });
      return rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
    }
    case 'TEACHERS':
      return centerStaffUserIds(orgId, ['TEACHER']);
    case 'STAFF':
      return centerStaffUserIds(orgId, ['OWNER', 'ADMIN', 'RECEPTIONIST', 'ASSISTANT', 'TEACHER']);
    case 'EVERYONE': {
      const [staff, students] = await Promise.all([
        centerStaffUserIds(orgId, ['OWNER', 'ADMIN', 'RECEPTIONIST', 'ASSISTANT', 'TEACHER']),
        recipientsFor(orgId, 'STUDENTS', null),
      ]);
      return [...staff, ...students];
    }
  }
}

export async function createAnnouncement(ctx: OrgContext, input: AnnouncementInput) {
  // A group notice must name a group, and that group must be this centre's.
  if (input.audience === 'GROUP') {
    if (!input.groupId) throw BadRequest('announcements.groupRequired');
    await assertAllOwned(ctx, 'group', [input.groupId]);
  }
  const groupId = input.audience === 'GROUP' ? (input.groupId ?? null) : null;

  const announcement = await prisma.announcement.create({
    data: {
      organizationId: ctx.orgId,
      authorMemberId: ctx.memberId,
      title: input.title,
      body: input.body,
      audience: input.audience,
      groupId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      pinned: input.pinned,
    },
  });

  // The notification carries the title so the feed can show it without a second
  // query. That is safe here in a way it would not be elsewhere: an
  // announcement is broadcast text, and the recipient list was just computed
  // from the audience.
  await notify({
    organizationId: ctx.orgId,
    userIds: await recipientsFor(ctx.orgId, input.audience, groupId),
    type: 'ANNOUNCEMENT',
    titleKey: 'notifications.announcement',
    payload: { announcementId: announcement.id, title: announcement.title },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'announcement.create',
    entityType: 'announcement',
    entityId: announcement.id,
    meta: { audience: input.audience, groupId },
  });
  return announcement;
}

export async function updateAnnouncement(
  ctx: OrgContext,
  id: string,
  input: AnnouncementInput,
) {
  await findOwned<{ id: string }>(ctx, 'announcement', id, live);
  if (input.audience === 'GROUP') {
    if (!input.groupId) throw BadRequest('announcements.groupRequired');
    await assertAllOwned(ctx, 'group', [input.groupId]);
  }

  const announcement = await prisma.announcement.update({
    where: { id },
    data: {
      title: input.title,
      body: input.body,
      audience: input.audience,
      groupId: input.audience === 'GROUP' ? (input.groupId ?? null) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      pinned: input.pinned,
    },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'announcement.update',
    entityType: 'announcement',
    entityId: id,
  });
  return announcement;
}

/** Withdrawn rather than destroyed, like everything else a centre owns. */
export async function deleteAnnouncement(ctx: OrgContext, id: string) {
  await findOwned<{ id: string }>(ctx, 'announcement', id, live);
  await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    actorAdminId: ctx.admin?.adminId ?? null,
    isOverride: ctx.isOverride,
    action: 'announcement.delete',
    entityType: 'announcement',
    entityId: id,
  });
  return { ok: true };
}
