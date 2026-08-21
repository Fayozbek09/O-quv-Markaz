'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@/lib/i18n/provider';
import type { TKey } from '@/lib/i18n';

const ITEMS: Array<[string, TKey]> = [
  ['/admin', 'admin.dashboard'],
  ['/admin/centers', 'admin.centers'],
  ['/admin/audit', 'admin.audit'],
  ['/admin/pricing', 'admin.pricing'],
  ['/admin/security', 'admin.security'],
];

export function AdminNav({ logoutOnly = false }: { logoutOnly?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    router.push('/admin/login');
    router.refresh();
  }

  if (logoutOnly) {
    return (
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-[var(--radius-field)] border border-white/25 px-2.5 py-1.5 text-[13px] text-white/80 hover:bg-white/10"
      >
        {t('nav.logout')}
      </button>
    );
  }

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label={t('admin.title')}>
      {ITEMS.map(([href, labelKey]) => {
        const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'whitespace-nowrap rounded-[var(--radius-field)] px-2.5 py-1.5 text-[13px]',
              active ? 'bg-white/15 font-medium text-white' : 'text-white/70 hover:bg-white/10',
            )}
          >
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
