'use client';

import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { Button } from '@/components/ui/Button';
import { ApiFailure } from '@/lib/client/api';
import { messageFor } from '@/lib/client/errors';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * A profile photo, for the signed-in account or — when `studentId` is given and
 * the caller has the permission — for a student.
 *
 * The checks here are a courtesy to the user. The server re-validates the type,
 * decodes the image, strips its metadata and re-encodes it, and it decides for
 * itself whether the caller may touch the student named in the form.
 */
export function AvatarUploader({
  currentUrl,
  studentId,
  name,
}: {
  currentUrl?: string | null;
  studentId?: string;
  /** Shown as initials until a photo exists. */
  name?: string | null;
}) {
  const t = useT();
  const csrf = useCsrfToken();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  async function upload(file: File) {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(t('errors.fileTooLarge', { max: '2 MB' }));
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
      if (studentId) form.append('studentId', studentId);

      const res = await fetch('/api/uploads/avatar', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        credentials: 'same-origin',
        body: form,
      });

      const payload = await res.json();
      if (!res.ok) throw new ApiFailure(res.status, payload);
      setPreview(payload.url as string);
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-line-strong bg-surface-muted text-sm font-semibold text-ink-faint">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-cover" />
          ) : initials ? (
            <span aria-hidden="true">{initials}</span>
          ) : (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
              <path
                d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.6 0-7 1.9-7 4.2V20h14v-1.8c0-2.3-3.4-4.2-7-4.2Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
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
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? t('common.saving') : t('settings.changePhoto')}
          </Button>
          <p className="text-[11px] text-ink-faint">PNG / JPEG / WebP · 2 MB</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
