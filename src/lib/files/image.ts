import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { createHash } from 'node:crypto';
import { BadRequest, PayloadTooLarge } from '../errors';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export type ProcessedImage = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
};

/**
 * Uploads are never trusted:
 *  - the declared MIME and the filename extension must both be on the allow-list;
 *  - the bytes are decoded by sharp, which rejects anything that is not a real
 *    raster image (a polyglot or a renamed script fails here);
 *  - SVG is refused outright - it is an XML document that can carry script;
 *  - the image is re-encoded, which drops EXIF, embedded thumbnails and any
 *    appended payload, so what is stored is not what was uploaded;
 *  - the stored file is always given a random name and a safe extension.
 */
export async function processImageUpload(
  file: File,
  opts: { maxBytes?: number; maxDimension?: number } = {},
): Promise<ProcessedImage> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const maxDimension = opts.maxDimension ?? 1024;

  if (file.size > maxBytes) throw PayloadTooLarge('errors.fileTooLarge');
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    throw BadRequest('errors.fileType');
  }

  const name = (file.name ?? '').toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) throw BadRequest('errors.fileType');

  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.byteLength > maxBytes) throw PayloadTooLarge('errors.fileTooLarge');

  let meta: Metadata;
  try {
    // `animated: false` and a pixel ceiling keep a decompression bomb from
    // exhausting memory.
    meta = await sharp(raw, { limitInputPixels: 40_000_000, animated: false }).metadata();
  } catch {
    throw BadRequest('errors.fileCorrupt');
  }

  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) {
    throw BadRequest('errors.fileType');
  }
  if (!meta.width || !meta.height) throw BadRequest('errors.fileCorrupt');

  const output = await sharp(raw, { limitInputPixels: 40_000_000, animated: false })
    .rotate() // apply EXIF orientation, then discard the metadata
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: output.data,
    mimeType: 'image/webp',
    extension: '.webp',
    width: output.info.width,
    height: output.info.height,
    sizeBytes: output.data.byteLength,
    sha256: createHash('sha256').update(output.data).digest('hex'),
  };
}
