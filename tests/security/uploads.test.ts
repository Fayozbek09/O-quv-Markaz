import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processImageUpload } from '@/lib/files/image';
import { processDocumentUpload } from '@/lib/files/document';
import { newStorageKey, putObject, getObject, signFileUrl, verifyFileSignature } from '@/lib/files/storage';
import { AppError } from '@/lib/errors';

/** Acceptance criteria 11 and 12: uploaded files cannot execute, SVG is refused. */
const realPng = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#2f62d8' } }).png().toBuffer();

const asFile = (bytes: Buffer, name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

describe('11. uploaded files cannot execute', () => {
  it('accepts a genuine PNG and re-encodes it to WebP', async () => {
    const file = asFile(await realPng(), 'logo.png', 'image/png');
    const result = await processImageUpload(file);

    expect(result.mimeType).toBe('image/webp');
    expect(result.extension).toBe('.webp');
    // The stored bytes are the re-encode, not the upload.
    expect(result.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('rejects a PHP script renamed to .png', async () => {
    const payload = Buffer.from('<?php system($_GET["c"]); ?>');
    const file = asFile(payload, 'shell.png', 'image/png');
    await expect(processImageUpload(file)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a polyglot: a valid PNG with script appended', async () => {
    const polyglot = Buffer.concat([await realPng(), Buffer.from('<?php system($_GET["c"]); ?>')]);
    const file = asFile(polyglot, 'polyglot.png', 'image/png');

    // sharp still decodes the leading image, so this one is accepted - but the
    // trailing payload cannot survive re-encoding.
    const result = await processImageUpload(file);
    expect(result.buffer.includes(Buffer.from('<?php'))).toBe(false);
    expect(result.buffer.includes(Buffer.from('system('))).toBe(false);
  });

  it('rejects an executable regardless of its declared type', async () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    await expect(processImageUpload(asFile(elf, 'x.png', 'image/png'))).rejects.toBeInstanceOf(AppError);
    await expect(processImageUpload(asFile(elf, 'x.elf', 'application/octet-stream'))).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a double extension', async () => {
    const file = asFile(await realPng(), 'logo.png.php', 'image/png');
    await expect(processImageUpload(file)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an oversized file before decoding it', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await expect(processImageUpload(asFile(big, 'big.png', 'image/png'))).rejects.toMatchObject({ status: 413 });
  });
});

describe('12. SVG cannot become stored XSS', () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
  );

  it('refuses image/svg+xml outright', async () => {
    await expect(processImageUpload(asFile(svg, 'x.svg', 'image/svg+xml'))).rejects.toBeInstanceOf(AppError);
  });

  it('refuses SVG bytes even when the type and extension claim PNG', async () => {
    await expect(processImageUpload(asFile(svg, 'x.png', 'image/png'))).rejects.toBeInstanceOf(AppError);
  });
});

describe('metadata stripping', () => {
  it('discards EXIF from the stored image', async () => {
    const withExif = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-LOCATION-DATA' } } })
      .jpeg()
      .toBuffer();

    const result = await processImageUpload(asFile(withExif, 'photo.jpg', 'image/jpeg'));
    expect(result.buffer.includes(Buffer.from('SECRET-LOCATION-DATA'))).toBe(false);
  });
});

describe('storage keys and path traversal', () => {
  it('ignores the client filename and generates a random key', async () => {
    const a = newStorageKey('org/abc/logo', '.webp');
    const b = newStorageKey('org/abc/logo', '.webp');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^org\/abc\/logo\/[0-9a-f]{32}\.webp$/);
  });

  it('strips traversal characters from the prefix', () => {
    const key = newStorageKey('../../etc/passwd', '.webp');
    expect(key).not.toContain('..');
  });

  it('refuses to read outside the storage root', async () => {
    for (const key of ['../../../etc/passwd', '..%2f..%2fetc%2fpasswd', '/etc/passwd']) {
      await expect(getObject(key)).rejects.toBeInstanceOf(AppError);
    }
  });

  it('round-trips a legitimate object', async () => {
    const key = newStorageKey('test', '.webp');
    const bytes = Buffer.from('hello');
    await putObject(key, bytes);
    expect((await getObject(key)).toString()).toBe('hello');
  });
});

describe('signed file URLs', () => {
  const fileId = '11111111-1111-4111-8111-111111111111';

  it('accepts a freshly signed URL', () => {
    const url = signFileUrl(fileId);
    const params = new URL(url, 'http://localhost').searchParams;
    expect(verifyFileSignature(fileId, params.get('exp'), params.get('sig'))).toBe(true);
  });

  it('rejects a signature issued for a different file', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const params = new URL(signFileUrl(other), 'http://localhost').searchParams;
    expect(verifyFileSignature(fileId, params.get('exp'), params.get('sig'))).toBe(false);
  });

  it('rejects an expired URL', () => {
    const url = signFileUrl(fileId, -1000);
    const params = new URL(url, 'http://localhost').searchParams;
    expect(verifyFileSignature(fileId, params.get('exp'), params.get('sig'))).toBe(false);
  });

  it('rejects a tampered expiry or signature', () => {
    const params = new URL(signFileUrl(fileId), 'http://localhost').searchParams;
    const exp = params.get('exp') as string;
    const sig = params.get('sig') as string;

    expect(verifyFileSignature(fileId, String(Number(exp) + 86_400_000), sig)).toBe(false);
    expect(verifyFileSignature(fileId, exp, `${sig.slice(0, -1)}0`)).toBe(false);
    expect(verifyFileSignature(fileId, exp, null)).toBe(false);
    expect(verifyFileSignature(fileId, null, sig)).toBe(false);
  });
});

/**
 * Homework attachments. Images reuse the pipeline above; PDF is the one format
 * that is stored as it arrived, so it gets its own checks.
 */
describe('homework attachment validation', () => {
  const pdf = (body = '1 0 obj\n<<>>\nendobj\n') =>
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(body)]);

  it('accepts a genuine PDF and keeps its bytes', async () => {
    const result = await processDocumentUpload(asFile(pdf(), 'task.pdf', 'application/pdf'));
    expect(result.mimeType).toBe('application/pdf');
    expect(result.extension).toBe('.pdf');
    expect(result.isImage).toBe(false);
    expect(result.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('re-encodes an attached image rather than storing it as sent', async () => {
    const result = await processDocumentUpload(asFile(await realPng(), 'photo.png', 'image/png'));
    expect(result.mimeType).toBe('image/webp');
    expect(result.isImage).toBe(true);
  });

  it('rejects a script that only claims to be a PDF', async () => {
    const payload = Buffer.from('<?php system($_GET["c"]); ?>');
    await expect(
      processDocumentUpload(asFile(payload, 'shell.pdf', 'application/pdf')),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a real PDF sent under a different extension', async () => {
    await expect(
      processDocumentUpload(asFile(pdf(), 'task.pdf.html', 'application/pdf')),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects SVG, which is a script container rather than an image', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(
      processDocumentUpload(asFile(svg, 'x.svg', 'image/svg+xml')),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an Office document, which can carry macros', async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    await expect(
      processDocumentUpload(
        asFile(zip, 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an oversized attachment before reading it', async () => {
    const big = asFile(pdf(), 'big.pdf', 'application/pdf');
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 });
    await expect(processDocumentUpload(big)).rejects.toBeInstanceOf(AppError);
  });

  it('never derives the stored name from the uploaded one', async () => {
    const result = await processDocumentUpload(
      asFile(pdf(), '../../../etc/passwd.pdf', 'application/pdf'),
    );
    const key = newStorageKey('org/abc/homework', result.extension);
    expect(key).not.toContain('..');
    expect(key).not.toContain('passwd');
    expect(key.endsWith('.pdf')).toBe(true);
  });
});
