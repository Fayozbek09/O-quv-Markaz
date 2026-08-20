import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toEskizPhone, __resetEskizToken } from '@/lib/notifications/providers/eskiz';
import { toPlayMobilePhone } from '@/lib/notifications/providers/playmobile';

/**
 * SMS delivery.
 *
 * The body of one of these messages is a one-time code, so the tests that
 * matter most are the ones asserting where it does *not* go.
 */

const OTP_BODY = 'O\'quv Markaz: tasdiqlash kodi 515249';

describe('phone normalisation', () => {
  it('accepts every shape a person or the database might supply', () => {
    for (const input of [
      '+998995900587',
      '998995900587',
      '+998 99 590 05 87',
      '(998) 99-590-05-87',
    ]) {
      expect(toEskizPhone(input), input).toBe('998995900587');
      expect(toPlayMobilePhone(input), input).toBe('998995900587');
    }
  });

  it('adds the country code to a bare national number', () => {
    expect(toEskizPhone('995900587')).toBe('998995900587');
    expect(toEskizPhone('0995900587')).toBe('998995900587');
  });
});

describe('eskiz delivery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const ok = (body: unknown = { status: 'waiting' }) =>
    new Response(JSON.stringify(body), { status: 200 });
  const authOk = () => new Response(JSON.stringify({ data: { token: 'tok-1' } }), { status: 200 });

  beforeEach(() => {
    __resetEskizToken();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sender = async () => (await import('@/lib/notifications/providers/eskiz')).eskizSms;

  it('signs in once and reuses the token for a second message', async () => {
    fetchMock.mockResolvedValueOnce(authOk()).mockResolvedValue(ok());

    const eskiz = await sender();
    await eskiz.send('+998995900587', OTP_BODY);
    await eskiz.send('+998995900587', OTP_BODY);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith('/auth/login'))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith('/message/sms/send'))).toHaveLength(2);
  });

  it('re-authenticates once when the held token has expired', async () => {
    fetchMock
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(ok());

    const eskiz = await sender();
    await expect(eskiz.send('+998995900587', OTP_BODY)).resolves.toBeUndefined();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith('/auth/login'))).toHaveLength(2);
  });

  it('gives up after one retry rather than looping on a bad password', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    // First call is the login itself, which also fails.
    const eskiz = await sender();
    await expect(eskiz.send('+998995900587', OTP_BODY)).rejects.toThrow(/eskiz_auth_failed:401/);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('sends the number without a plus and the code in the body', async () => {
    fetchMock.mockResolvedValueOnce(authOk()).mockResolvedValue(ok());

    const eskiz = await sender();
    await eskiz.send('+998995900587', OTP_BODY);

    const sendCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/message/sms/send'));
    const form = sendCall?.[1]?.body as FormData;
    expect(form.get('mobile_phone')).toBe('998995900587');
    expect(form.get('message')).toBe(OTP_BODY);
  });

  it('never writes the code to the console, on success or on failure', async () => {
    fetchMock.mockResolvedValueOnce(authOk()).mockResolvedValue(ok());
    const eskiz = await sender();
    await eskiz.send('+998995900587', OTP_BODY);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(authOk())
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'template not approved' }), { status: 400 }),
      );
    __resetEskizToken();
    await expect(eskiz.send('+998995900587', OTP_BODY)).rejects.toThrow();

    const written = [...infoSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(written).not.toContain('515249');
    expect(written).not.toContain(OTP_BODY);
  });

  it('reports why the gateway refused, without echoing the message', async () => {
    fetchMock
      .mockResolvedValueOnce(authOk())
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'insufficient balance' }), { status: 400 }),
      );

    const eskiz = await sender();
    await expect(eskiz.send('+998995900587', OTP_BODY)).rejects.toThrow(
      /eskiz_send_failed:400:insufficient balance/,
    );
  });

});

describe('an unconfigured gateway', () => {
  /**
   * Play Mobile has no credentials in the test environment, which is exactly
   * the state a half-finished deployment is in. It must refuse rather than
   * resolve — a sender that silently swallowed the message would leave a user
   * waiting for a code that was never sent.
   */
  it('throws instead of pretending the message went out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { playMobileSms } = await import('@/lib/notifications/providers/playmobile');
    await expect(playMobileSms.send('+998995900587', OTP_BODY)).rejects.toThrow(
      /sms_provider_not_configured:playmobile/,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
