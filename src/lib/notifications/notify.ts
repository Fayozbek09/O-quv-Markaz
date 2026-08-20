import { prisma } from '../db';
import type { NotificationType } from '@/generated/prisma/enums';

/** Preference rows created for every new account. */
export const DEFAULT_NOTIFICATION_TYPES = [
  'LESSON_UPCOMING',
  'LESSON_CANCELLED',
  'LESSON_RESCHEDULED',
  'ATTENDANCE_MISSED',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_DUE',
  'GRADE_POSTED',
  'PAYMENT_OVERDUE',
  'PAYMENT_RECEIVED',
  'STUDENT_REGISTERED',
  'MONTHLY_SUMMARY',
  'ANNOUNCEMENT',
] as const satisfies readonly NotificationType[];

type NotifyInput = {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  /** Translation key rendered client-side; the payload supplies the values. */
  titleKey: string;
  payload?: Record<string, unknown>;
};

/**
 * Writes in-app notifications, honouring each recipient's preferences.
 *
 * The payload holds identifiers and short labels only — never a grade, a
 * balance or anything else that would leak if the row were read by the wrong
 * account. The reader re-fetches the detail through an access-checked query.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.userIds)].filter(Boolean);
  if (recipients.length === 0) return 0;

  const muted = await prisma.notificationPreference.findMany({
    where: { userId: { in: recipients }, type: input.type, inApp: false },
    select: { userId: true },
  });
  const mutedIds = new Set(muted.map((m) => m.userId));
  const targets = recipients.filter((id) => !mutedIds.has(id));
  if (targets.length === 0) return 0;

  const result = await prisma.notification.createMany({
    data: targets.map((userId) => ({
      organizationId: input.organizationId,
      userId,
      type: input.type,
      channel: 'IN_APP' as const,
      titleKey: input.titleKey.slice(0, 80),
      payload: (input.payload ?? {}) as object,
    })),
  });
  return result.count;
}

/** Portal accounts of every active student in a group. */
export async function groupStudentUserIds(
  organizationId: string,
  groupId: string,
): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({
    where: { organizationId, groupId, leftAt: null, student: { deletedAt: null } },
    select: { student: { select: { userId: true } } },
  });
  return rows.map((r) => r.student.userId).filter((id): id is string => Boolean(id));
}

/** Staff who should hear about money and enrolment events. */
export async function centerStaffUserIds(
  organizationId: string,
  roles: Array<'OWNER' | 'ADMIN' | 'RECEPTIONIST' | 'ASSISTANT' | 'TEACHER'> = [
    'OWNER',
    'ADMIN',
  ],
): Promise<string[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId, removedAt: null, role: { in: roles } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function memberUserId(
  organizationId: string,
  memberId: string | null,
): Promise<string[]> {
  if (!memberId) return [];
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId, removedAt: null },
    select: { userId: true },
  });
  return member ? [member.userId] : [];
}
