'use client';

import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { Button } from '@/components/ui/Button';
import { ApiFailure } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

export type PickedFile = { fileId: string; name: string; sizeBytes: number };

/**
 * Uploads files one at a time and hands their ids to the parent form.
 *
 * The upload only creates a file owned by the caller's centre; whether that
 * file may be attached to a particular assignment is decided again by the
 * endpoint the parent form posts to.
 */
export function AttachmentPicker({
  value,
  onChange,
  max = 5,
  label,
}: {
  value: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  max?: number;
  label?: string;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setError(null);

    if (value.length >= max) return;
    if (file.size > MAX_BYTES) {
      setError(t('errors.fileTooLarge', { max: '10 MB' }));
      return;
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      setError(t('errors.fileType'));
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/uploads/attachment', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        credentials: 'same-origin',
        body: form,
      });

      const payload = await res.json();
      if (!res.ok) throw new ApiFailure(res.status, payload);

      onChange([
        ...value,
        {
          fileId: payload.fileId as string,
          // The server discards the uploaded name; this label is local only.
          name: file.name,
          sizeBytes: payload.sizeBytes as number,
        },
      ]);
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink-soft">
          {label ?? t('homework.attachments')}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || value.length >= max}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? t('common.saving') : t('common.upload')}
        </Button>
      </div>

      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((file) => (
            <li
              key={file.fileId}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-field)] border border-line bg-surface-muted px-2.5 py-1.5 text-[13px]"
            >
              <span className="min-w-0 truncate text-ink-soft">{file.name}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-danger-600 hover:underline"
                onClick={() => onChange(value.filter((f) => f.fileId !== file.fileId))}
              >
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-ink-faint">PNG / JPEG / WebP / PDF · 10 MB</p>

      {error && (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
