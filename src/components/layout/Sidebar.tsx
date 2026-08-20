'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@/lib/i18n/provider';
import { Logo } from '@/components/ui/Logo';
import type { NavKey } from '@/lib/nav';
import type { TKey } from '@/lib/i18n';

export type SidebarItem = { key: NavKey; href: string; labelKey: TKey };

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" className="size-[18px] shrink-0" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One glyph per navigation key, so the server can send data-only nav items. */
const ICONS: Record<NavKey, string> = {
  center: 'M3 10.5 10 4l7 6.5M5 9.5V16h10V9.5',
  dashboard: 'M3 10.5 10 4l7 6.5M5 9.5V16h10V9.5',
  reception: 'M2.5 15.5h15M4 15.5V9l6-4 6 4v6.5M8.5 15.5v-4h3v4',
  teacher: 'M3 6.5 10 3.5l7 3-7 3-7-3ZM6 9v4c0 1.1 1.8 2 4 2s4-.9 4-2V9',
  students:
    'M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.5 16c0-2.5 2.2-4 5-4s5 1.5 5 4M14 12.2c1.9.4 3.5 1.5 3.5 3.8M13.5 8.8a2.2 2.2 0 0 0 0-4.3',
  groups: 'M4 7h5v5H4zM11 4h5v5h-5zM11 11h5v5h-5z',
  courses: 'M4 4.5h9a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2v-9ZM4 13.5h11',
  calendar: 'M3.5 5.5h13v11h-13zM3.5 9h13M7 3.5v3M13 3.5v3',
  attendance: 'M4 10.5 8 14l8-8M3.5 4.5h5',
  homework: 'M6 3.5h8v13l-4-2.5-4 2.5v-13ZM8 7h4',
  grades: 'M10 3 12 7.5l5 .5-3.7 3.3 1.1 4.7L10 13.6 5.6 16l1.1-4.7L3 8l5-.5L10 3Z',
  teachers: 'M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 16.5c0-3 2.7-4.5 6-4.5s6 1.5 6 4.5',
  salaries: 'M10 3.5v13M13 6.5c0-1.4-1.3-2-3-2s-3 .6-3 2 1.3 1.9 3 2.3 3 .9 3 2.4-1.3 2.3-3 2.3-3-.7-3-2.1',
  payments: 'M2.5 6.5h15v8h-15zM2.5 9.5h15M5.5 12.5h3',
  expenses: 'M3.5 16.5 8 12l3 2.5 5-6.5M12.5 8h4v4',
  finance: 'M4 16V9M8 16V4M12 16v-5M16 16v-9',
  reports: 'M4 16V9M8 16V4M12 16v-5M16 16v-9',
  billing: 'M3.5 6.5h13v9h-13zM3.5 10h13M6.5 13h3M13 3.5v3',
};

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function SidebarNav({
  items,
  onNavigate,
}: {
  items: SidebarItem[];
  onNavigate?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav aria-label={t('nav.menu')} className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
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
            <Icon d={ICONS[item.key]} />
            <span className="truncate">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({
  workspaceName,
  logoUrl,
  items,
  homeHref,
}: {
  workspaceName: string;
  logoUrl: string | null;
  items: SidebarItem[];
  homeHref: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const settingsActive = pathname.startsWith('/settings');

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <Link href={homeHref} className="flex min-w-0 items-center gap-2">
          {logoUrl ? (
            // Centre logos are served through a signed, access-checked route.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-7 rounded object-cover" />
          ) : (
            <Logo showText={false} size={26} />
          )}
          <span className="truncate text-sm font-semibold text-ink">{workspaceName}</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        <SidebarNav items={items} />
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
