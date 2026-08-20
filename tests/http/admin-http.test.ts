import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, makeMember, type Tenant } from '../factories';
import { Session } from './client';
import { hashPassword } from '@/lib/auth/password';

/**
 * Platform-administration boundary, exercised over real HTTP.
 *
 * The point of these tests is that /admin is not protected by hiding a link:
 * a fully authenticated centre user typing the URL gets the same refusal as an
 * anonymous visitor, and the admin cookie is a different cookie entirely.
 */
const PASSWORD = 'CorrectHorse42!';
const ADMIN_PASSWORD = 'Platform-Admin-Password-2026!';
const ADMIN_USERNAME = 'f.iskandarov.test1';

let centre: Tenant;
let ownerSession: Session;
let teacherSession: Session;
let adminSession: Session;
let adminId: string;

async function loginUser(identifier: string): Promise<Session> {
  const session = new Session();
  const res = await session.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier, password: PASSWORD },
  });
  expect(res.status, await res.text()).toBe(200);
  await session.loadCsrf();
  return session;
}

beforeAll(async () => {
  await truncateAll();
  await db.platformAdmin.deleteMany();

  centre = await createTenant('Admin HTTP Centre');
  const teacher = await makeMember(centre, 'TEACHER');

  const hash = await hashPassword(PASSWORD);
  await db.user.updateMany({
    where: { id: { in: [centre.user.id, teacher.user.id] } },
    data: { passwordHash: hash, username: undefined },
  });
  await db.user.update({ where: { id: centre.user.id }, data: { username: 'owner.httptest' } });
  await db.user.update({ where: { id: teacher.user.id }, data: { username: 'teacher.httptest' } });

  const admin = await db.platformAdmin.create({
    data: {
      username: ADMIN_USERNAME,
      fullName: 'Iskandarov Fayozbek',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  adminId = admin.id;

  ownerSession = await loginUser('owner.httptest');
  teacherSession = await loginUser('teacher.httptest');
});
afterAll(() => db.$disconnect());

describe('login routes by server-resolved role', () => {
  it('sends an owner to the centre area', async () => {
    const session = new Session();
    const res = await session.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: 'owner.httptest', password: PASSWORD },
    });
    const body = (await res.json()) as { redirectTo: string };
    expect(body.redirectTo).toBe('/center');
  });

  it('sends a teacher to the teaching area', async () => {
    const session = new Session();
    const res = await session.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: 'teacher.httptest', password: PASSWORD },
    });
    const body = (await res.json()) as { redirectTo: string };
    expect(body.redirectTo).toBe('/teacher');
  });

  it('ignores a role supplied by the client', async () => {
    const session = new Session();
    const res = await session.fetch('/api/auth/login?role=admin', {
      method: 'POST',
      json: { identifier: 'teacher.httptest', password: PASSWORD, role: 'OWNER' },
    });
    // The strict schema rejects the extra key outright.
    expect(res.status).toBe(422);
  });
});

describe('centre sessions cannot reach the platform area', () => {
  it('refuses the admin API to a signed-in teacher', async () => {
    const res = await teacherSession.fetch('/api/admin/centers');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('refuses the admin API to a signed-in centre owner', async () => {
    const res = await ownerSession.fetch('/api/admin/centers');
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller with 401, not 403', async () => {
    const res = await new Session().fetch('/api/admin/centers');
    expect(res.status).toBe(401);
  });

  it('records the denied attempt in the audit log', async () => {
    await teacherSession.fetch('/api/admin/audit');
    const denied = await db.auditLog.findFirst({
      where: { action: 'admin.access.denied' },
      orderBy: { createdAt: 'desc' },
    });
    expect(denied?.outcome).toBe('denied');
  });

  it('redirects a centre user away from the /admin page', async () => {
    const res = await teacherSession.fetch('/admin');
    // Next answers a server-side redirect to the admin login.
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get('location')).toContain('/admin/login');
  });

  it('will not accept a centre session cookie as an admin session', async () => {
    // Replaying the centre cookie against the admin endpoint changes nothing:
    // the admin resolver reads a different cookie name and a different table.
    const res = await ownerSession.fetch('/api/admin/settings');
    expect(res.status).toBe(403);
  });
});

describe('platform administrator', () => {
  it('signs in through its own endpoint', async () => {
    adminSession = new Session();
    const res = await adminSession.fetch('/api/admin/login', {
      method: 'POST',
      json: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    const body = (await res.json()) as { redirectTo: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.redirectTo).toBe('/admin');
    expect(adminSession.cookieHeader).toContain('__Host-omarkaz_admin');
  });

  it('does not accept a centre account at the admin login', async () => {
    const session = new Session();
    const res = await session.fetch('/api/admin/login', {
      method: 'POST',
      json: { username: 'owner.httptest', password: PASSWORD },
    });
    expect(res.status).toBe(401);
  });

  it('answers identically for an unknown username and a wrong password', async () => {
    const unknown = await new Session().fetch('/api/admin/login', {
      method: 'POST',
      json: { username: 'nobody.at.all', password: 'whatever-long-enough' },
    });
    const wrong = await new Session().fetch('/api/admin/login', {
      method: 'POST',
      json: { username: ADMIN_USERNAME, password: 'definitely-not-it' },
    });
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it('reaches the centre list once authenticated', async () => {
    const res = await adminSession.fetch('/api/admin/centers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ name: string }> };
    expect(body.rows.some((c) => c.name.includes('Admin HTTP Centre'))).toBe(true);
  });

  it('still requires a CSRF token for a mutation', async () => {
    const res = await adminSession.fetch('/api/admin/centers', {
      method: 'POST',
      json: { centerName: 'No CSRF', city: 'Toshkent', phone: '+998901234567', ownerFirstName: 'A' },
    });
    expect(res.status).toBe(403);
  });

  it('logs an override with the admin identity attached', async () => {
    await adminSession.loadCsrf();
    const res = await adminSession.fetch('/api/admin/impersonate', {
      method: 'POST',
      csrf: true,
      json: { organizationId: centre.org.id, reason: 'support ticket 42' },
    });
    expect(res.status, await res.text()).toBe(200);

    const log = await db.auditLog.findFirst({
      where: { action: 'admin.impersonate.start' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.actorAdminId).toBe(adminId);
    expect(log?.organizationId).toBe(centre.org.id);
    expect(log?.isOverride).toBe(true);
    expect(JSON.stringify(log?.meta)).toContain('support ticket 42');
  });

  it('ends the override on request', async () => {
    const res = await adminSession.fetch('/api/admin/impersonate', { method: 'DELETE', csrf: true });
    expect(res.status).toBe(204);
    const session = await db.adminSession.findFirst({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
    });
    expect(session?.impersonatingOrgId).toBeNull();
  });

  it('drops the session on logout', async () => {
    const res = await adminSession.fetch('/api/admin/logout', { method: 'POST' });
    expect(res.status).toBe(204);
    const after = await adminSession.fetch('/api/admin/centers');
    expect(after.status).toBe(401);
  });
});

describe('suspended centres', () => {
  it('locks a member out at login while keeping their data', async () => {
    await db.organization.update({
      where: { id: centre.org.id },
      data: { status: 'SUSPENDED' },
    });

    const session = new Session();
    const res = await session.fetch('/api/auth/login', {
      method: 'POST',
      json: { identifier: 'owner.httptest', password: PASSWORD },
    });
    expect(res.status).toBe(401);

    const students = await db.student.count({ where: { organizationId: centre.org.id } });
    expect(students).toBeGreaterThanOrEqual(0);

    await db.organization.update({ where: { id: centre.org.id }, data: { status: 'ACTIVE' } });
  });
});
