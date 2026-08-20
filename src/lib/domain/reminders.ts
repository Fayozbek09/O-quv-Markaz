import { prisma } from '../db';
import { scope, type OrgContext } from '../tenant';
import { studentBalance } from './billing';
import { renderDebtReminder, renderLessonReminder } from '../integrations/telegram/templates';
import { sendMessage } from '../integrations/telegram/client';
import { enforceAll } from '../security/rate-limit';
import { audit } from '../security/audit';
import { BadRequest, NotFound } from '../errors';
import { telegramConfigured } from '../env';
import { formatDate } from '../i18n';
import type { AppLocale } from '../i18n/config';

export type ReminderRequest = {
  studentId: string;
  template: 'DEBT' | 'LESSON';
  locale: AppLocale;
};

export type BuiltReminder = {
  body: string;
  recipientAvailable: boolean;
  recipientName: string | null;
  studentName: string;
  dedupeKey: string;
};

/** Renders the message without sending it - used for the mandatory preview. */
export async function buildReminder(
  ctx: OrgContext,
  input: ReminderRequest,
): Promise<BuiltReminder> {
  const student = await prisma.student.findFirst({
    where: scope.byId(ctx, input.studentId),
    include: {
      parents: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
      memberships: {
        where: { leftAt: null },
        include: { group: { select: { name: true, currency: true } } },
        take: 1,
      },
    },
  });
  if (!student || student.deletedAt) throw NotFound();

  const org = await prisma.organization.findFirstOrThrow({
    where: { id: ctx.orgId },
    select: { name: true, defaultCurrency: true, timezone: true },
  });

  const parent = student.parents[0];
  const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ');
  const teacherName = [ctx.user?.firstName, ctx.user?.lastName].filter(Boolean).join(' ');
  const now = new Date();

  if (input.template === 'DEBT') {
    const balance = await studentBalance(ctx, student.id);
    if (balance.debtMinor <= 0n) throw BadRequest('debt.noDebt');

    const body = renderDebtReminder({
      locale: input.locale,
      studentName,
      centerName: org.name,
      debtMinor: balance.debtMinor,
      currency: student.memberships[0]?.group.currency ?? org.defaultCurrency,
      teacherName,
      periodLabel: formatDate(now, input.locale, 'monthYear', org.timezone),
    });

    return {
      body,
      recipientAvailable: Boolean(parent?.telegramChatId),
      recipientName: parent?.fullName ?? null,
      studentName,
      // One reminder per student per calendar day per template.
      dedupeKey: `${ctx.orgId}:${student.id}:DEBT:${now.toISOString().slice(0, 10)}`,
    };
  }

  const nextLesson = await prisma.lesson.findFirst({
    where: {
      ...scope.orgLive(ctx),
      startsAt: { gte: now },
      status: 'SCHEDULED',
      group: { members: { some: { studentId: student.id, leftAt: null } } },
    },
    orderBy: { startsAt: 'asc' },
    include: { group: { select: { name: true } } },
  });
  if (!nextLesson) throw BadRequest('lessons.empty');

  const body = renderLessonReminder({
    locale: input.locale,
    studentName,
    centerName: org.name,
    groupName: nextLesson.group.name,
    when: formatDate(
      nextLesson.startsAt,
      input.locale,
      'dateTime',
      org.timezone,
    ),
    room: nextLesson.room,
  });

  return {
    body,
    recipientAvailable: Boolean(parent?.telegramChatId),
    recipientName: parent?.fullName ?? null,
    studentName,
    dedupeKey: `${ctx.orgId}:${student.id}:LESSON:${nextLesson.id}`,
  };
}

export async function sendReminder(ctx: OrgContext, input: ReminderRequest) {
  const built = await buildReminder(ctx, input);

  // Anti-spam: per-workspace hourly cap and a hard per-student daily cap. The
  // parent's phone is never the addressing mechanism - only a linked chat id.
  await enforceAll([
    ['telegram:send:org', ctx.orgId],
    ['telegram:send:student', `${ctx.orgId}:${input.studentId}`],
  ]);

  const parent = await prisma.studentParent.findFirst({
    where: { studentId: input.studentId, organizationId: ctx.orgId, telegramChatId: { not: null } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  if (!parent?.telegramChatId) throw BadRequest('telegram.noRecipient');

  let message;
  try {
    message = await prisma.outboundMessage.create({
      data: {
        organizationId: ctx.orgId,
        studentId: input.studentId,
        channel: 'TELEGRAM',
        recipientRef: parent.telegramChatId.toString(),
        templateKey: input.template,
        locale: input.locale === 'ru' ? 'RU' : input.locale === 'en' ? 'EN' : 'UZ',
        body: built.body,
        status: 'QUEUED',
        sentByUserId: ctx.actorUserId,
        dedupeKey: built.dedupeKey,
      },
    });
  } catch {
    // Unique violation on dedupeKey: this exact reminder already went out.
    throw BadRequest('telegram.rateLimited');
  }

  if (!telegramConfigured) {
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED', error: 'bot_not_configured' },
    });
    await audit({
      organizationId: ctx.orgId,
      actorUserId: ctx.actorUserId,
      action: 'telegram.reminder.queued',
      entityType: 'student',
      entityId: input.studentId,
      outcome: 'failure',
      meta: { reason: 'bot_not_configured' },
    });
    return { status: 'QUEUED' as const, configured: false, messageId: message.id };
  }

  const result = await sendMessage(parent.telegramChatId, built.body);

  await prisma.outboundMessage.update({
    where: { id: message.id },
    data: result.ok
      ? { status: 'SENT', sentAt: new Date() }
      : { status: 'FAILED', error: result.error.slice(0, 400) },
  });

  await audit({
    organizationId: ctx.orgId,
    actorUserId: ctx.actorUserId,
    action: 'telegram.reminder.send',
    entityType: 'student',
    entityId: input.studentId,
    outcome: result.ok ? 'success' : 'failure',
    meta: { template: input.template },
  });

  return { status: result.ok ? ('SENT' as const) : ('FAILED' as const), configured: true, messageId: message.id };
}
