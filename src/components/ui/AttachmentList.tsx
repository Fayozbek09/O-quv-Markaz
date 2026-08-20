import { signFileUrl } from '@/lib/files/storage';

/** Locale-independent: a size in KB or MB reads the same in all three languages. */
const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Links to the files hanging off a piece of homework.
 *
 * Each link carries a short-lived signature, and the endpoint behind it still
 * checks that the reader belongs to the file's centre — the URL alone opens
 * nothing. The uploaded filename was discarded at upload time, so the label is
 * the file type rather than a name the uploader chose.
 */
export function AttachmentList({
  items,
  label,
}: {
  items: Array<{ fileId: string; file: { mimeType: string; sizeBytes: number } }>;
  label: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <ul className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li key={item.fileId}>
            <a
              href={signFileUrl(item.fileId, 30 * 60_000)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-field)] border border-line bg-surface-muted px-2.5 py-1.5 text-[13px] text-ink-soft hover:border-line-strong hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" aria-hidden="true">
                <path
                  d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                {item.file.mimeType === 'application/pdf' ? 'PDF' : 'IMG'} {index + 1}
              </span>
              <span className="tnum text-ink-faint">{formatBytes(item.file.sizeBytes)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
