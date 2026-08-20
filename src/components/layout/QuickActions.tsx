'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/provider';

/** The five things a tutor does most, one click from anywhere. */
export function QuickActions() {
  const t = useT();

  const actions = [
    { href: '/students?new=1', label: t('students.add') },
    { href: '/groups?new=1', label: t('groups.add') },
    { href: '/calendar?new=1', label: t('lessons.add') },
    { href: '/payments?new=1', label: t('payments.add') },
    { href: '/attendance', label: t('attendance.mark') },
  ];

  return (
    <nav aria-label={t('dashboard.quickActions')} className="flex flex-wrap gap-1.5">
      {actions.map((action, index) => (
        <Link
          key={action.href}
          href={action.href}
          className={
            index === 0
              ? 'rounded-[var(--radius-field)] bg-brand-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-600'
              : 'rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:bg-surface-muted hover:text-ink'
          }
        >
          {index === 0 ? `+ ${action.label}` : action.label}
        </Link>
      ))}
    </nav>
  );
}
