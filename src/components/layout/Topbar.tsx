'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import { useCsrfToken } from '@/components/providers/CsrfProvider';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SidebarNav, type SidebarItem } from './Sidebar';
import { Logo } from '@/components/ui/Logo';

export function Topbar({
  title,
  userName,
  workspaceName,
  unreadCount,
  items = [],
}: {
  title: string;
  userName: string;
  workspaceName: string;
  unreadCount: number;
  items?: SidebarItem[];
}) {
  const t = useT();
  const router = useRouter();
  const csrf = useCsrfToken();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      credentials: 'same-origin',
    });
    router.push('/login');
    router.refresh();
  }

  const initials = userName.trim().slice(0, 1).toUpperCase() || 'U';

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-5">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={t('nav.menu')}
          className="rounded-[var(--radius-field)] p-2 text-ink-soft hover:bg-surface-muted lg:hidden"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <Link href="/dashboard" className="lg:hidden">
          <Logo size={24} showText={false} />
        </Link>

        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</h1>

        <div className="hidden sm:block">
          <LanguageSwitcher compact />
        </div>

        <Link
          href="/settings/notifications"
          className="relative rounded-[var(--radius-field)] p-2 text-ink-soft hover:bg-surface-muted"
          aria-label={t('notifications.title')}
        >
          <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" aria-hidden="true">
            <path
              d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 4.5-1.5 4.5h12s-1.5-1-1.5-4.5A4.5 4.5 0 0 0 10 3ZM8.5 15a1.6 1.6 0 0 0 3 0"
              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-danger-600 text-[9px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          <span className="sr-only">
            {unreadCount} {t('notifications.unread')}
          </span>
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-[13px] font-semibold text-brand-700 hover:bg-brand-100"
          >
            {initials}
            <span className="sr-only">{userName}</span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1.5 w-56 rounded-[var(--radius-card)] border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
              >
                <div className="border-b border-line px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink">{userName}</p>
                  <p className="truncate text-xs text-ink-faint">{workspaceName}</p>
                </div>
                <Link role="menuitem" href="/settings/profile" onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted hover:text-ink">
                  {t('nav.profile')}
                </Link>
                <Link role="menuitem" href="/settings/workspace" onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted hover:text-ink">
                  {t('nav.workspace')}
                </Link>
                <Link role="menuitem" href="/billing" onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted hover:text-ink">
                  {t('nav.billing')}
                </Link>
                <div className="mt-1 border-t border-line pt-1 sm:hidden">
                  <div className="px-3 py-1.5">
                    <LanguageSwitcher compact />
                  </div>
                </div>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => void logout()}
                  className="block w-full border-t border-line px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-50"
                >
                  {t('nav.logout')}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {mobileOpen && (
        <div id="mobile-nav" className="border-b border-line bg-surface p-2.5 lg:hidden">
          <SidebarNav items={items} onNavigate={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
