'use client';

import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/provider';
import { Topbar } from './Topbar';
import type { SidebarItem } from './Sidebar';
import type { TKey } from '@/lib/i18n';

const TITLES: Array<[string, TKey]> = [
  ['/center', 'nav.center'],
  ['/reception', 'nav.reception'],
  ['/teacher', 'nav.teacherArea'],
  ['/dashboard', 'nav.dashboard'],
  ['/students', 'nav.students'],
  ['/groups', 'nav.groups'],
  ['/courses', 'nav.courses'],
  ['/calendar', 'nav.calendar'],
  ['/attendance', 'nav.attendance'],
  ['/homework', 'nav.homework'],
  ['/grades', 'nav.grades'],
  ['/teachers', 'nav.teachers'],
  ['/payments', 'nav.payments'],
  ['/salaries', 'nav.salaries'],
  ['/expenses', 'nav.expenses'],
  ['/finance', 'nav.finance'],
  ['/reports', 'nav.reports'],
  ['/billing', 'nav.billing'],
  ['/settings', 'nav.settings'],
];

/** Derives the page title from the route so each page does not repeat it. */
export function AppTopbar(props: {
  userName: string;
  workspaceName: string;
  unreadCount: number;
  items?: SidebarItem[];
}) {
  const t = useT();
  const pathname = usePathname();
  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return <Topbar title={match ? t(match[1]) : t('app.name')} {...props} />;
}
