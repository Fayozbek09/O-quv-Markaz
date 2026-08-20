import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTenant, makeGroup, makeMember, makeStudent, makeStudentAccount,
  truncateAll, db, type Tenant,
} from '../factories';
import {
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAnnouncements, announcementsForMember, announcementsForStudent,
} from '@/lib/domain/announcements';
import { announcementInputSchema } from '@/lib/validation/schemas';

let tenant: Tenant;
let other: Tenant;
let teacher: Awaited<ReturnType<typeof makeMember>>;
let taughtGroup: Awaited<ReturnType<typeof makeGroup>>;
let otherGroup: Awaited<ReturnType<typeof makeGroup>>;
let enrolled: { studentId: string; organizationId: string };
let enrolledUserId: string;
let unenrolled: { studentId: string; organizationId: string };

const input = (over: Record<string, unknown> = {}) =>
  announcementInputSchema.parse({ title: 'Notice', body: 'Body text', ...over });

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Announcing Centre');
  other = await createTenant('Other Centre');

  teacher = await makeMember(tenant, 'TEACHER');
  taughtGroup = await makeGroup(tenant, 'Taught Group');
  otherGroup = await makeGroup(tenant, 'Other Group');
  await db.group.update({
    where: { id: taughtGroup.id },
    data: { teacherId: teacher.member.id },
  });

  const a = await makeStudent(tenant, 'Enrolled');
  enrolledUserId = (await makeStudentAccount(tenant, a.id)).id;
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: taughtGroup.id, studentId: a.id },
  });
  enrolled = { studentId: a.id, organizationId: tenant.org.id };

  const b = await makeStudent(tenant, 'Unenrolled');
  await makeStudentAccount(tenant, b.id);
  unenrolled = { studentId: b.id, organizationId: tenant.org.id };
});
afterAll(() => db.$disconnect());

describe('posting', () => {
  it('records the author and notifies the audience', async () => {
    const posted = await createAnnouncement(tenant.ctx, input({ audience: 'STUDENTS' }));
    expect(posted.authorMemberId).toBe(tenant.ctx.memberId);

    const notes = await db.notification.findMany({
      where: { type: 'ANNOUNCEMENT', payload: { path: ['announcementId'], equals: posted.id } },
    });
    // Both student accounts in this centre, and nobody else.
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.organizationId === tenant.org.id)).toBe(true);
  });

  it('refuses a group notice with no group', async () => {
    await expect(
      createAnnouncement(tenant.ctx, input({ audience: 'GROUP' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a group notice aimed at another centre's group", async () => {
    const theirs = await makeGroup(other, 'Their Group');
    await expect(
      createAnnouncement(tenant.ctx, input({ audience: 'GROUP', groupId: theirs.id })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('drops a group id when the audience is not a group', async () => {
    const posted = await createAnnouncement(
      tenant.ctx,
      input({ audience: 'EVERYONE', groupId: taughtGroup.id }),
    );
    expect(posted.groupId).toBeNull();
  });

  it('notifies only the named group', async () => {
    const posted = await createAnnouncement(
      tenant.ctx,
      input({ audience: 'GROUP', groupId: otherGroup.id }),
    );
    const notes = await db.notification.findMany({
      where: { type: 'ANNOUNCEMENT', payload: { path: ['announcementId'], equals: posted.id } },
    });
    // Nobody is enrolled in that group.
    expect(notes).toHaveLength(0);
  });
});

describe('who sees what', () => {
  it('shows a student the notices addressed to them, and no others', async () => {
    await createAnnouncement(tenant.ctx, input({ title: 'For all', audience: 'EVERYONE' }));
    await createAnnouncement(tenant.ctx, input({ title: 'For students', audience: 'STUDENTS' }));
    await createAnnouncement(tenant.ctx, input({ title: 'For staff', audience: 'STAFF' }));
    await createAnnouncement(tenant.ctx, input({ title: 'For teachers', audience: 'TEACHERS' }));

    const titles = (await announcementsForStudent(enrolled)).map((a) => a.title);
    expect(titles).toContain('For all');
    expect(titles).toContain('For students');
    expect(titles).not.toContain('For staff');
    expect(titles).not.toContain('For teachers');
  });

  it('shows a group notice only to the students in that group', async () => {
    await createAnnouncement(
      tenant.ctx,
      input({ title: 'Just this group', audience: 'GROUP', groupId: taughtGroup.id }),
    );

    const forEnrolled = (await announcementsForStudent(enrolled)).map((a) => a.title);
    const forUnenrolled = (await announcementsForStudent(unenrolled)).map((a) => a.title);
    expect(forEnrolled).toContain('Just this group');
    expect(forUnenrolled).not.toContain('Just this group');
  });

  it('shows a teacher staff notices and their own group, but not student-only ones', async () => {
    const titles = (await announcementsForMember(teacher.ctx, 50)).map((a) => a.title);
    expect(titles).toContain('For staff');
    expect(titles).toContain('For teachers');
    expect(titles).toContain('Just this group');
    expect(titles).not.toContain('For students');
  });

  it('hides a notice once it has expired', async () => {
    const expired = await createAnnouncement(
      tenant.ctx,
      input({
        title: 'Old news',
        audience: 'EVERYONE',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    expect(expired.expiresAt).not.toBeNull();

    const titles = (await announcementsForStudent(enrolled)).map((a) => a.title);
    expect(titles).not.toContain('Old news');
  });

  it('puts a pinned notice first', async () => {
    await createAnnouncement(tenant.ctx, input({ title: 'Pinned', audience: 'EVERYONE', pinned: true }));
    const rows = await announcementsForStudent(enrolled, 50);
    expect(rows[0]?.title).toBe('Pinned');
  });

  it("never shows one centre's notices to another", async () => {
    await createAnnouncement(other.ctx, input({ title: 'Not yours', audience: 'EVERYONE' }));

    const mine = (await listAnnouncements(tenant.ctx)).map((a) => a.title);
    expect(mine).not.toContain('Not yours');

    const studentTitles = (await announcementsForStudent(enrolled, 50)).map((a) => a.title);
    expect(studentTitles).not.toContain('Not yours');
  });
});

describe('editing and withdrawing', () => {
  it("refuses to edit another centre's notice", async () => {
    const theirs = await createAnnouncement(other.ctx, input({ title: 'Theirs' }));
    await expect(
      updateAnnouncement(tenant.ctx, theirs.id, input({ title: 'Hijacked' })),
    ).rejects.toMatchObject({ status: 404 });

    const after = await db.announcement.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.title).toBe('Theirs');
  });

  it("refuses to withdraw another centre's notice", async () => {
    const theirs = await createAnnouncement(other.ctx, input({ title: 'Also theirs' }));
    await expect(deleteAnnouncement(tenant.ctx, theirs.id)).rejects.toMatchObject({ status: 404 });

    const after = await db.announcement.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.deletedAt).toBeNull();
  });

  it('withdraws rather than destroys', async () => {
    const posted = await createAnnouncement(tenant.ctx, input({ title: 'Temporary' }));
    await deleteAnnouncement(tenant.ctx, posted.id);

    const row = await db.announcement.findUniqueOrThrow({ where: { id: posted.id } });
    expect(row.deletedAt).not.toBeNull();

    const titles = (await announcementsForStudent(enrolled, 50)).map((a) => a.title);
    expect(titles).not.toContain('Temporary');
  });

  it('treats a malformed id as not found', async () => {
    await expect(deleteAnnouncement(tenant.ctx, 'not-a-uuid')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('records every action in the audit log', async () => {
    const posted = await createAnnouncement(tenant.ctx, input({ title: 'Audited' }));
    await updateAnnouncement(tenant.ctx, posted.id, input({ title: 'Audited again' }));
    await deleteAnnouncement(tenant.ctx, posted.id);

    const actions = await db.auditLog.findMany({
      where: { organizationId: tenant.org.id, entityId: posted.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action).sort()).toEqual([
      'announcement.create',
      'announcement.delete',
      'announcement.update',
    ]);
  });
});

describe('mute preferences', () => {
  it('respects a reader who turned announcements off', async () => {
    await db.notificationPreference.upsert({
      where: { userId_type: { userId: enrolledUserId, type: 'ANNOUNCEMENT' } },
      create: { userId: enrolledUserId, type: 'ANNOUNCEMENT', inApp: false },
      update: { inApp: false },
    });

    const posted = await createAnnouncement(tenant.ctx, input({ title: 'Muted', audience: 'STUDENTS' }));
    const notes = await db.notification.count({
      where: {
        userId: enrolledUserId,
        payload: { path: ['announcementId'], equals: posted.id },
      },
    });
    expect(notes).toBe(0);

    // The notice itself is still readable — only the ping was suppressed.
    const titles = (await announcementsForStudent(enrolled, 50)).map((a) => a.title);
    expect(titles).toContain('Muted');
  });
});
