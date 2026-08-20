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
 * The client-side checks below are a courtesy to the user, not a control - the
 * server re-validates the MIME type, decodes the image and re-encodes it.
 */
export function LogoUploader({ currentUrl }: { currentUrl?: string | null }) {
  const t = useT();
  const csrf = useCsrfToken();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

      const res = await fetch('/api/uploads/logo', {
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
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-field)] border border-dashed border-line-strong bg-surface-muted">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" className="size-6 text-ink-faint" fill="none" aria-hidden="true">
              <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm0-2 5-5 4 4 2-2 5 5"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? t('common.saving') : t('common.upload')}
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
