import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, truncateAll, createTenant, makeStudent, makeGroup, type Tenant } from '../factories';
import { Session } from './client';
import { hashPassword } from '@/lib/auth/password';
import { generateInvoices } from '@/lib/domain/payments';

const PASSWORD = 'CorrectHorse42!';
let tenant: Tenant;
let session: Session;
const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = now.getUTCMonth() + 1;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant('Report Studio');
  await db.user.update({
    where: { id: tenant.user.id },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });

  const student = await makeStudent(tenant, 'Reported');
  const group = await makeGroup(tenant, 'Reported Group', 300_000n);
  await db.groupMember.create({
    data: { organizationId: tenant.org.id, groupId: group.id, studentId: student.id },
  });
  await generateInvoices(tenant.ctx, { year: YEAR, month: MONTH, dueDay: 5 });

  session = new Session();
  await session.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: tenant.user.email, password: PASSWORD },
  });
  await session.loadCsrf();
});

afterAll(() => db.$disconnect());

describe('report export', () => {
  it('returns JSON by default', async () => {
    const res = await session.fetch(`/api/reports?year=${YEAR}&month=${MONTH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { groups: unknown[]; balance: { expectedMinor: string } };
    expect(body.groups.length).toBe(1);
    expect(body.balance.expectedMinor).toBe('300000');
  });

  it('returns a downloadable CSV when format=csv', async () => {
    const res = await session.fetch(`/api/reports?year=${YEAR}&month=${MONTH}&format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');

    const csv = await res.text();
    expect(csv).toContain('"group"');
    expect(csv).toContain('Reported Group');
  });

  it('still rejects a genuinely unknown query parameter', async () => {
    const res = await session.fetch(`/api/reports?year=${YEAR}&month=${MONTH}&organizationId=x`);
    expect(res.status).toBe(422);
  });

  it('rejects an out-of-range period', async () => {
    expect((await session.fetch('/api/reports?year=1999&month=1')).status).toBe(422);
    expect((await session.fetch(`/api/reports?year=${YEAR}&month=13`)).status).toBe(422);
  });

  it('requires a session', async () => {
    const res = await new Session().fetch(`/api/reports?year=${YEAR}&month=${MONTH}`);
    expect(res.status).toBe(401);
  });
});
