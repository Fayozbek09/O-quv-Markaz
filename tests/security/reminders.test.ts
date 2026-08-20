import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, makeStudent, makeGroup, truncateAll, db, type Tenant } from '../factories';
import { buildReminder, sendReminder } from '@/lib/domain/reminders';
import { generateInvoices } from '@/lib/domain/payments';

/**
 * The parent payment reminder is the feature most able to annoy a real person,
 * so it carries consent, a preview, per-student throttling and an audit trail.
 */
let tenant: Tenant;
let student: Awaited<ReturnType<typeof makeStudent>>;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Reminder Studio');
  student = await makeStudent(tenant, 'Debtor');
  const group = await makeGroup(tenant, 'Reminder Group', 400_000n);
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: group.id, studentId: student.id },
  });
  await generateInvoices(tenant.ctx, { year: 2026, month: 8, dueDay: 5 });
});
afterAll(() => db.$disconnect());

describe('consent', () => {
  it('reports no recipient until a parent links their own Telegram account', async () => {
    const preview = await buildReminder(tenant.ctx, {
      studentId: student.id,
      template: 'DEBT',
      locale: 'uz',
    });
    expect(preview.recipientAvailable).toBe(false);

    await expect(
      sendReminder(tenant.ctx, { studentId: student.id, template: 'DEBT', locale: 'uz' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('never uses a phone number as the addressing key', async () => {
    // The parent has a phone but no linked chat id: still not reachable.
    const parent = await db.studentParent.findFirstOrThrow({ where: { studentId: student.id } });
    expect(parent.phone).toBeTruthy();
    expect(parent.telegramChatId).toBeNull();

    await expect(
      sendReminder(tenant.ctx, { studentId: student.id, template: 'DEBT', locale: 'uz' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('message content', () => {
  it('renders in all three languages with the amount and the student name', async () => {
    for (const locale of ['uz', 'ru', 'en'] as const) {
      const preview = await buildReminder(tenant.ctx, {
        studentId: student.id, template: 'DEBT', locale,
      });
      expect(preview.body).toContain('Debtor');
      expect(preview.body).toContain('400');
      expect(preview.body.length).toBeGreaterThan(30);
    }
  });

  it('produces visibly different text per language, not one language with swapped words', async () => {
    const bodies = await Promise.all(
      (['uz', 'ru', 'en'] as const).map(async (locale) =>
        (await buildReminder(tenant.ctx, { studentId: student.id, template: 'DEBT', locale })).body,
      ),
    );
    const [uz, ru, en] = bodies as [string, string, string];

    expect(uz).not.toBe(ru);
    expect(ru).not.toBe(en);
    expect(ru).toMatch(/[\u0400-\u04FF]/); // Cyrillic
    expect(en).not.toMatch(/[\u0400-\u04FF]/);
  });

  it('refuses to build a debt reminder for a student who owes nothing', async () => {
    const clear = await makeStudent(tenant, 'PaidUp');
    await expect(
      buildReminder(tenant.ctx, { studentId: clear.id, template: 'DEBT', locale: 'uz' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('throttling and audit', () => {
  beforeAll(async () => {
    await db.studentParent.updateMany({
      where: { studentId: student.id },
      data: { telegramChatId: 123456789n, telegramLinkedAt: new Date() },
    });
    await db.rateLimitCounter.deleteMany();
    await db.outboundMessage.deleteMany();
  });

  it('records every attempt as an outbound message and an audit entry', async () => {
    const result = await sendReminder(tenant.ctx, {
      studentId: student.id, template: 'DEBT', locale: 'uz',
    });
    // The test bot token is not a real one, so delivery fails - what matters is
    // that the attempt is recorded rather than silently dropped.
    expect(['SENT', 'FAILED', 'QUEUED']).toContain(result.status);

    const message = await db.outboundMessage.findFirstOrThrow({ where: { studentId: student.id } });
    expect(message.sentByUserId).toBe(tenant.user.id);
    expect(message.recipientRef).toBe('123456789');
    expect(message.body).toContain('Debtor');

    const log = await db.auditLog.findFirstOrThrow({
      where: { action: 'telegram.reminder.send', entityId: student.id },
    });
    expect(log.organizationId).toBe(tenant.org.id);
  });

  it('refuses a second identical reminder on the same day', async () => {
    await expect(
      sendReminder(tenant.ctx, { studentId: student.id, template: 'DEBT', locale: 'uz' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('caps how many reminders one student can receive per day', async () => {
    const other = await makeStudent(tenant, 'Frequent');
    const group = await db.group.findFirstOrThrow({ where: { organizationId: tenant.org.id } });
    await db.groupMember.create({
      data: { organizationId: tenant.org.id, groupId: group.id, studentId: other.id },
    });
    await db.studentParent.updateMany({
      where: { studentId: other.id },
      data: { telegramChatId: 987654321n, telegramLinkedAt: new Date() },
    });
    await generateInvoices(tenant.ctx, { year: 2026, month: 9, dueDay: 5 });

    let throttled = false;
    for (let i = 0; i < 5; i += 1) {
      try {
        await db.outboundMessage.deleteMany({ where: { studentId: other.id } });
        await sendReminder(tenant.ctx, { studentId: other.id, template: 'DEBT', locale: 'uz' });
      } catch (err) {
        if ((err as { status?: number }).status === 429) {
          throttled = true;
          break;
        }
      }
    }
    expect(throttled).toBe(true);
  });
});
