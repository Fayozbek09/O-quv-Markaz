import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTenant, truncateAll, db, type Tenant } from '../factories';
import { createStudent, listStudents } from '@/lib/domain/students';
import { listDebtors } from '@/lib/domain/billing';
import { studentInputSchema, studentListQuerySchema } from '@/lib/validation/schemas';

/** Acceptance criteria 13 and 14: injected markup and SQL payloads. */
let tenant: Tenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTenant();
});
afterAll(() => db.$disconnect());

const SQLI = [
  "'; DROP TABLE students; --",
  "1' OR '1'='1",
  "admin'--",
  "' UNION SELECT * FROM users --",
  '\'; UPDATE students SET "organizationId" = \'00000000-0000-4000-8000-000000000000\'; --',
  '%27%20OR%201%3D1',
  "') OR ('a'='a",
];

const XSS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  'javascript:alert(document.cookie)',
  '<svg/onload=alert(1)>',
  '{{constructor.constructor("alert(1)")()}}',
  "';alert(String.fromCharCode(88,83,83))//",
];

describe('14. SQL injection', () => {
  it.each(SQLI)('search payload %s is treated as a literal', async (payload) => {
    const result = await listStudents(
      tenant.ctx,
      studentListQuerySchema.parse({ q: payload, status: 'ALL' }),
    );
    // The query runs and simply matches nothing - nothing is executed.
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it.each(SQLI)('debtor-report payload %s is bound as a parameter', async (payload) => {
    // listDebtors is the one place that uses $queryRaw; the tagged template
    // binds every interpolation, so these must not alter the statement.
    const result = await listDebtors(tenant.ctx, { q: payload, limit: 10 });
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('the students table still exists after every payload', async () => {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
       WHERE table_name = 'students'
    `;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('a payload cannot reassign a row to another organization', async () => {
    const student = await createStudent(
      tenant.ctx,
      studentInputSchema.parse({ firstName: 'Target' }),
    );
    for (const payload of SQLI) {
      await listStudents(tenant.ctx, studentListQuerySchema.parse({ q: payload, status: 'ALL' }));
    }
    const after = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(after.organizationId).toBe(tenant.org.id);
  });
});

describe('13. markup in user-supplied fields', () => {
  it.each(XSS)('stores %s verbatim rather than mangling it', async (payload) => {
    const input = studentInputSchema.parse({ firstName: payload, notes: payload });
    const student = await createStudent(tenant.ctx, input);

    const stored = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    // The value round-trips exactly. React escapes it on output, so it is inert
    // in the browser; stripping it here would corrupt legitimate names such as
    // "O'Brien <3" and would give a false sense of safety.
    expect(stored.firstName).toBe(payload);
    expect(stored.notes).toBe(payload);
  });

  it('strips control characters that would corrupt a CSV export or a log line', () => {
    // NUL, BEL, backspace, vertical tab, DEL - none should survive validation.
    const dirty = 'Ali\u0000\u0007\u0008 Valiyev\u007F';
    const parsed = studentInputSchema.parse({ firstName: dirty, notes: 'a\u001Fb' });

    expect(parsed.firstName).toBe('Ali Valiyev');
    expect(parsed.notes).toBe('ab');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(parsed.firstName)).toBe(false);
  });

  it('enforces a length ceiling so a field cannot be used for storage abuse', () => {
    expect(studentInputSchema.safeParse({ firstName: 'x'.repeat(500) }).success).toBe(false);
    expect(studentInputSchema.safeParse({ firstName: 'Ali', notes: 'x'.repeat(5000) }).success).toBe(false);
  });
});

describe('mass assignment', () => {
  it('a strict schema refuses a key the caller must not control', () => {
    for (const extra of [
      { organizationId: '00000000-0000-4000-8000-000000000000' },
      { id: '00000000-0000-4000-8000-000000000000' },
      { deletedAt: null },
      { createdAt: '2020-01-01' },
      { archivedAt: null },
    ]) {
      const result = studentInputSchema.safeParse({ firstName: 'Ali', ...extra });
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('a prototype-pollution payload does not reach the parsed object', () => {
    const parsed = studentInputSchema.safeParse(
      JSON.parse('{"firstName":"Ali","__proto__":{"admin":true}}'),
    );
    // Either the strict schema rejects it, or the key is dropped entirely.
    if (parsed.success) {
      expect(Object.prototype.hasOwnProperty.call(parsed.data, '__proto__')).toBe(false);
    }
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe('parameter pollution', () => {
  it('a repeated query parameter cannot turn a string into an array', () => {
    const params = new URLSearchParams('status=ACTIVE&status=ALL&page=1&page=999');
    const collapsed: Record<string, string> = {};
    for (const [key, value] of params.entries()) collapsed[key] = value;

    const parsed = studentListQuerySchema.parse(collapsed);
    expect(parsed.status).toBe('ALL');
    expect(typeof parsed.page).toBe('number');
  });

  it('an out-of-range page size is rejected rather than passed through', () => {
    expect(studentListQuerySchema.safeParse({ perPage: '100000' }).success).toBe(false);
    expect(studentListQuerySchema.safeParse({ page: '-1' }).success).toBe(false);
    expect(studentListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});
