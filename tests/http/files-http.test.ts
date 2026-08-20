import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { db, truncateAll, createTenant, type Tenant } from '../factories';
import { Session } from './client';
import { BASE_URL } from './server';
import { hashPassword } from '@/lib/auth/password';
import { signFileUrl, newStorageKey, putObject } from '@/lib/files/storage';

/** Acceptance criterion 3: one teacher cannot reach another teacher's files. */
const PASSWORD = 'CorrectHorse42!';

let alice: Tenant;
let bob: Tenant;
let aliceSession: Session;
let bobFileId: string;
let bobSignedUrl: string;

async function login(tenant: Tenant): Promise<Session> {
  const session = new Session();
  await session.fetch('/api/auth/login', {
    method: 'POST',
    json: { identifier: tenant.user.email, password: PASSWORD },
  });
  await session.loadCsrf();
  return session;
}

beforeAll(async () => {
  await truncateAll();
  alice = await createTenant('Alice Files');
  bob = await createTenant('Bob Files');

  const hash = await hashPassword(PASSWORD);
  await db.user.updateMany({
    where: { id: { in: [alice.user.id, bob.user.id] } },
    data: { passwordHash: hash },
  });

  // A real stored file belonging to Bob.
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } })
    .webp()
    .toBuffer();
  const storageKey = newStorageKey(`org/${bob.org.id}/logo`, '.webp');
  await putObject(storageKey, bytes);

  const file = await db.file.create({
    data: {
      organizationId: bob.org.id,
      ownerUserId: bob.user.id,
      kind: 'ORG_LOGO',
      storageKey,
      mimeType: 'image/webp',
      sizeBytes: bytes.byteLength,
      sha256: 'x'.repeat(64),
      width: 32,
      height: 32,
    },
  });
  bobFileId = file.id;
  bobSignedUrl = signFileUrl(bobFileId);

  aliceSession = await login(alice);
});

afterAll(() => db.$disconnect());

describe('3. cross-tenant file access', () => {
  it("a valid signature is not enough: Alice cannot fetch Bob's file", async () => {
    const res = await aliceSession.fetch(bobSignedUrl);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('image/');
  });

  it('an anonymous request with a valid signature is refused', async () => {
    const res = await fetch(`${BASE_URL}${bobSignedUrl}`, { redirect: 'manual' });
    expect([401, 403, 404]).toContain(res.status);
  });

  it('a session without a signature is refused', async () => {
    const res = await aliceSession.fetch(`/api/files/${bobFileId}`);
    expect(res.status).toBe(403);
  });

  it("Bob's own session with his own signature succeeds", async () => {
    const bobSession = await login(bob);
    const res = await bobSession.fetch(bobSignedUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it('a delivered file is sandboxed and cannot be sniffed into another type', async () => {
    const bobSession = await login(bob);
    const res = await bobSession.fetch(bobSignedUrl);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toContain('private');
  });

  it('a path-traversal id is rejected outright', async () => {
    for (const id of ['..%2f..%2fetc%2fpasswd', '../../../etc/passwd', 'null']) {
      const res = await aliceSession.fetch(`/api/files/${encodeURIComponent(id)}`);
      expect([400, 403, 404]).toContain(res.status);
    }
  });
});

describe('upload endpoint', () => {
  it('requires a CSRF token', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));

    const res = await aliceSession.fetch('/api/uploads/logo', { method: 'POST', body: form });
    expect(res.status).toBe(403);
  });

  it('rejects a non-image even with a valid session and token', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new TextEncoder().encode('<?php system($_GET["c"]); ?>')], 'shell.png', {
        type: 'image/png',
      }),
    );

    const res = await aliceSession.fetch('/api/uploads/logo', {
      method: 'POST',
      body: form,
      csrf: true,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).messageKey).toMatch(/errors\.file/);
  });

  it('accepts a real image and returns a signed URL scoped to the uploader', async () => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2f62d8' } })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append('file', new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' }));

    const res = await aliceSession.fetch('/api/uploads/logo', {
      method: 'POST',
      body: form,
      csrf: true,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { fileId: string; url: string };
    expect(body.url).toContain(`/api/files/${body.fileId}`);

    const stored = await db.file.findUniqueOrThrow({ where: { id: body.fileId } });
    expect(stored.organizationId).toBe(alice.org.id);
    // Always re-encoded, never stored as uploaded.
    expect(stored.mimeType).toBe('image/webp');
    // The client filename is discarded.
    expect(stored.storageKey).not.toContain('logo.png');
  });
});
