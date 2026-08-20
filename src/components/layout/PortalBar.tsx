'use client';

import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { LanguageSwitcher } from './LanguageSwitcher';

export function PortalBar({ name, studentNo }: { name: string; studentNo: string | null }) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();

  async function logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      credentials: 'same-origin',
    });
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      <LanguageSwitcher compact />
      <span className="hidden text-[13px] text-ink-soft sm:block">
        {name}
        {studentNo ? ` · ${studentNo}` : ''}
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-[var(--radius-field)] border border-line px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-muted"
      >
        {t('nav.logout')}
      </button>
    </>
  );
}
