'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@/lib/i18n/provider';
import { Logo } from '@/components/ui/Logo';
import type { TKey } from '@/lib/i18n';

type NavItem = { href: string; labelKey: TKey; icon: React.ReactNode };

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" className="size-[18px] shrink-0" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: <Icon d="M3 10.5 10 4l7 6.5M5 9.5V16h10V9.5" /> },
  { href: '/students', labelKey: 'nav.students', icon: <Icon d="M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c0-2.5 2.2-4 5-4s5 1.5 5 4M14 12.2c1.9.4 3.5 1.5 3.5 3.8M13.5 8.8a2.2 2.2 0 0 0 0-4.3" /> },
  { href: '/groups', labelKey: 'nav.groups', icon: <Icon d="M4 7h5v5H4zM11 4h5v5h-5zM11 11h5v5h-5z" /> },
  { href: '/calendar', labelKey: 'nav.calendar', icon: <Icon d="M3.5 5.5h13v11h-13zM3.5 9h13M7 3.5v3M13 3.5v3" /> },
  { href: '/attendance', labelKey: 'nav.attendance', icon: <Icon d="M4 10.5 8 14l8-8M3.5 4.5h5" /> },
  { href: '/payments', labelKey: 'nav.payments', icon: <Icon d="M2.5 6.5h15v8h-15zM2.5 9.5h15M5.5 12.5h3" /> },
  { href: '/reports', labelKey: 'nav.reports', icon: <Icon d="M4 16V9M8 16V4M12 16v-5M16 16v-9" /> },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav aria-label={t('nav.menu')} className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex items-center gap-2.5 rounded-[var(--radius-field)] px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-ink-soft hover:bg-surface-muted hover:text-ink',
            )}
          >
            {item.icon}
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ workspaceName, logoUrl }: { workspaceName: string; logoUrl: string | null }) {
  const t = useT();
  const pathname = usePathname();
  const settingsActive = pathname.startsWith('/settings');

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          {logoUrl ? (
            // Workspace logos are served through a signed, access-checked route.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-7 rounded object-cover" />
          ) : (
            <Logo showText={false} size={26} />
          )}
          <span className="truncate text-sm font-semibold text-ink">{workspaceName}</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        <SidebarNav />
      </div>

      <div className="border-t border-line p-2.5">
        <Link
          href="/settings/profile"
          aria-current={settingsActive ? 'page' : undefined}
          className={clsx(
            'flex items-center gap-2.5 rounded-[var(--radius-field)] px-2.5 py-2 text-sm',
            settingsActive
              ? 'bg-brand-50 font-medium text-brand-700'
              : 'text-ink-soft hover:bg-surface-muted hover:text-ink',
          )}
        >
          <Icon d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM16.2 12a1.4 1.4 0 0 0 .3 1.5l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-2.4 1v.2a1.7 1.7 0 1 1-3.4 0v-.1a1.4 1.4 0 0 0-2.4-1l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0-1-2.4h-.2a1.7 1.7 0 1 1 0-3.4h.1a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 2.4-1v-.2a1.7 1.7 0 1 1 3.4 0v.1a1.4 1.4 0 0 0 2.4 1l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0 1 2.4h.2a1.7 1.7 0 1 1 0 3.4h-.1a1.4 1.4 0 0 0-1.3.9Z" />
          <span>{t('nav.settings')}</span>
        </Link>
      </div>
    </aside>
  );
}
