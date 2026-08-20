import { describe, it, expect, afterAll } from 'vitest';
import { db, truncateAll, createTenant } from '../factories';
import { scrub, audit } from '@/lib/security/audit';
import { hashIp } from '@/lib/crypto';

afterAll(() => db.$disconnect());

describe('audit log redaction', () => {
  it('redacts anything that looks like a secret, at any depth', () => {
    const cleaned = scrub({
      password: 'hunter2',
      otpCode: '123456',
      accessToken: 'abc',
      apiKey: 'k',
      passwordHash: 'x',
      cookie: 'session=1',
      authorization: 'Bearer xyz',
      nested: { newPassword: 'p', innocent: 'kept' },
      studentId: 'keep-me',
    });

    for (const key of ['password', 'otpCode', 'accessToken', 'apiKey', 'passwordHash', 'cookie', 'authorization']) {
      expect(cleaned[key]).toBe('[redacted]');
    }
    expect((cleaned.nested as Record<string, unknown>).newPassword).toBe('[redacted]');
    expect((cleaned.nested as Record<string, unknown>).innocent).toBe('kept');
    expect(cleaned.studentId).toBe('keep-me');
  });

  it('truncates long values so a log line cannot be used as a data channel', () => {
    const cleaned = scrub({ note: 'x'.repeat(5000) });
    expect(String(cleaned.note).length).toBeLessThan(400);
  });

  it('writes a row without ever storing a raw IP address', async () => {
    await truncateAll();
    const tenant = await createTenant();

    await audit({
      organizationId: tenant.org.id,
      actorUserId: tenant.user.id,
      action: 'test.action',
      meta: { password: 'secret', studentId: 'abc' },
    });

    const row = await db.auditLog.findFirstOrThrow({ where: { action: 'test.action' } });
    expect(JSON.stringify(row.meta)).not.toContain('secret');
    // The stub request header supplies 127.0.0.1; only its keyed hash is stored.
    expect(row.ipHash).not.toBe('127.0.0.1');
    expect(row.ipHash).toBe(hashIp('127.0.0.1'));
  });
});
