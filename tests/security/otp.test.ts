import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, truncateAll } from '../factories';
import { requestOtp, verifyOtp, OTP_MAX_ATTEMPTS } from '@/lib/auth/otp';

/** Covers acceptance criteria 6-9: invalid, expired, replayed and brute-forced codes. */
const phone = () => `+9989${Date.now().toString().slice(-8)}`;

beforeEach(async () => {
  await db.rateLimitCounter.deleteMany();
  await db.otpCode.deleteMany();
});
afterAll(() => db.$disconnect());

describe('OTP issuance', () => {
  it('never stores the code in plaintext', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    expect(devCode).toMatch(/^\d{6}$/);

    const row = await db.otpCode.findFirstOrThrow({ where: { identifier } });
    expect(row.codeHash).not.toContain(devCode as string);
    expect(row.codeHash.startsWith('$argon2id$')).toBe(true);
  });

  it('produces codes that are not trivially predictable', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { devCode } = await requestOtp({ identifier: phone(), channel: 'SMS', purpose: 'PHONE_VERIFY' });
      codes.add(devCode as string);
    }
    // A biased or sequential generator would collide far more than this.
    expect(codes.size).toBeGreaterThanOrEqual(19);
  });

  it('invalidates the previous code when a new one is requested', async () => {
    const identifier = phone();
    const first = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    const second = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: first.devCode as string })).not.toBe('ok');
    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: second.devCode as string })).toBe('ok');
  });
});

describe('OTP verification', () => {
  it('6. rejects a wrong code', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    const wrong = devCode === '000000' ? '111111' : '000000';
    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: wrong })).toBe('invalid');
  });

  it('7. rejects an expired code', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    await db.otpCode.updateMany({
      where: { identifier },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string })).toBe('expired');
  });

  it('8. rejects a replayed code', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string })).toBe('ok');
    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string })).toBe('used');
  });

  it('8b. only one of two concurrent submissions of the same code wins', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    const results = await Promise.all([
      verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string }),
      verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string }),
    ]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
  });

  it('9. locks the code after too many wrong attempts', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    const wrong = devCode === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: wrong });
    }

    // Even the correct code no longer works once the attempt budget is spent.
    expect(await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: devCode as string })).toBe('locked');
  });

  it('a code is bound to its purpose and cannot be reused for password reset', async () => {
    const identifier = phone();
    const { devCode } = await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    expect(await verifyOtp({ identifier, purpose: 'PASSWORD_RESET', code: devCode as string })).toBe('invalid');
  });

  it('a code is bound to its identifier and cannot be replayed onto another number', async () => {
    const a = phone();
    const b = `${a.slice(0, -1)}9`;
    const { devCode } = await requestOtp({ identifier: a, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    await requestOtp({ identifier: b, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    expect(await verifyOtp({ identifier: b, purpose: 'PHONE_VERIFY', code: devCode as string })).toBe('invalid');
  });
});

describe('OTP request throttling', () => {
  it('9b. limits how many codes one identifier can request', async () => {
    const identifier = phone();
    await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });
    await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    await expect(
      requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('9c. limits how many verify attempts one identifier can make', async () => {
    const identifier = phone();
    await requestOtp({ identifier, channel: 'SMS', purpose: 'PHONE_VERIFY' });

    let throttled = false;
    for (let i = 0; i < 15; i += 1) {
      try {
        await verifyOtp({ identifier, purpose: 'PHONE_VERIFY', code: '000000' });
      } catch (err) {
        throttled = (err as { status?: number }).status === 429;
        break;
      }
    }
    expect(throttled).toBe(true);
  });
});
