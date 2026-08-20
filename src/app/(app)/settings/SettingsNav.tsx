'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@/lib/i18n/provider';
import type { TKey } from '@/lib/i18n';

const ITEMS: Array<[string, TKey]> = [
  ['/settings/profile', 'nav.profile'],
  ['/settings/workspace', 'nav.workspace'],
  ['/settings/notifications', 'nav.notifications'],
  ['/settings/security', 'nav.security'],
  ['/settings/billing', 'nav.billing'],
];

export function SettingsNav() {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav aria-label={t('settings.title')} className="lg:w-52 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {ITEMS.map(([href, key]) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'block whitespace-nowrap rounded-[var(--radius-field)] px-3 py-2 text-sm',
                  active
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-ink-soft hover:bg-surface-muted hover:text-ink',
                )}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
