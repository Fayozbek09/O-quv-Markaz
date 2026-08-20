'use client';

import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { Topbar } from './Topbar';
import type { TKey } from '@/lib/i18n';

const TITLES: Array<[string, TKey]> = [
  ['/dashboard', 'nav.dashboard'],
  ['/students', 'nav.students'],
  ['/groups', 'nav.groups'],
  ['/calendar', 'nav.calendar'],
  ['/attendance', 'nav.attendance'],
  ['/payments', 'nav.payments'],
  ['/reports', 'nav.reports'],
  ['/settings', 'nav.settings'],
];

/** Derives the page title from the route so each page does not repeat it. */
export function AppTopbar(props: { userName: string; workspaceName: string; unreadCount: number }) {
  const t = useT();
  const pathname = usePathname();
  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return <Topbar title={match ? t(match[1]) : 'Ustozly'} {...props} />;
}
