import { createHash } from 'node:crypto';
import { BadRequest, PayloadTooLarge } from '../errors';
import { processImageUpload, type ProcessedImage } from './image';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * What a teacher or a student may hand over.
 *
 * Deliberately short: images, which are re-encoded and therefore neutralised,
 * and PDF, which is not. Office formats are ZIP containers that can carry
 * macros, and are not accepted. SVG is not an image for this purpose — it is an
 * XML document that can carry script — and `processImageUpload` refuses it.
 */
const PDF_MIME = 'application/pdf';
export const ALLOWED_DOCUMENT_MIME = [
  'image/png', 'image/jpeg', 'image/webp', PDF_MIME,
] as const;

export type ProcessedDocument = Omit<ProcessedImage, 'width' | 'height'> & {
  /** Null for a PDF, which has no single pixel size. */
  width: number | null;
  height: number | null;
  isImage: boolean;
};

/** `%PDF-` — the only signature a PDF may start with. */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

/**
 * Validates an uploaded attachment.
 *
 * An image is handed to the image pipeline, which decodes and re-encodes it, so
 * a renamed script or a polyglot never survives. A PDF cannot be re-encoded, so
 * it is checked three ways instead — declared MIME, filename extension and the
 * leading magic bytes must all agree — and then it is stored under a random
 * name and served as a download inside a sandbox, never executed and never
 * rendered as part of the site.
 *
 * The filename itself is discarded. Nothing derived from it reaches the
 * filesystem, so there is no path to traverse.
 */
export async function processDocumentUpload(
  file: File,
  opts: { maxBytes?: number } = {},
): Promise<ProcessedDocument> {
  const maxBytes = opts.maxBytes ?? MAX_DOCUMENT_BYTES;
  if (file.size > maxBytes) throw PayloadTooLarge('errors.fileTooLarge');

  const declared = file.type;
  if (!ALLOWED_DOCUMENT_MIME.includes(declared as (typeof ALLOWED_DOCUMENT_MIME)[number])) {
    throw BadRequest('errors.fileType');
  }

  if (declared !== PDF_MIME) {
    const image = await processImageUpload(file, { maxBytes, maxDimension: 2048 });
    return { ...image, isImage: true };
  }

  const name = (file.name ?? '').toLowerCase();
  if (!name.endsWith('.pdf')) throw BadRequest('errors.fileType');

  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.byteLength > maxBytes) throw PayloadTooLarge('errors.fileTooLarge');
  if (raw.byteLength < PDF_MAGIC.length) throw BadRequest('errors.fileCorrupt');
  if (!raw.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw BadRequest('errors.fileType');

  return {
    buffer: raw,
    mimeType: PDF_MIME,
    extension: '.pdf',
    width: null,
    height: null,
    sizeBytes: raw.byteLength,
    sha256: createHash('sha256').update(raw).digest('hex'),
    isImage: false,
  };
}
