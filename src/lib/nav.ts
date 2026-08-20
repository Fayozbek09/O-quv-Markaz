import type { Permission } from './rbac';
import type { OrgRole } from '@/generated/prisma/enums';
import type { TKey } from './i18n';

export type NavKey =
  | 'center' | 'reception' | 'teacher' | 'dashboard'
  | 'students' | 'groups' | 'courses' | 'calendar' | 'attendance'
  | 'homework' | 'grades' | 'teachers' | 'salaries' | 'announcements'
  | 'payments' | 'expenses' | 'finance' | 'reports' | 'billing';

export type NavItem = {
  key: NavKey;
  href: string;
  labelKey: TKey;
  /** Permission the server would require for the page behind this link. */
  permission: Permission | null;
  /** Restrict the entry to specific roles even when the permission matches. */
  roles?: readonly OrgRole[];
};

/**
 * The staff navigation.
 *
 * Every entry names the permission its page needs, and the sidebar is built by
 * filtering this list against the caller's effective permission set. Hiding a
 * link is a convenience, never the control: the page and its API both re-check
 * server-side, so typing the URL by hand gets the same 403.
 */
export const NAV: readonly NavItem[] = [
  { key: 'center', href: '/center', labelKey: 'nav.center', permission: 'finance.read', roles: ['OWNER', 'ADMIN'] },
  { key: 'reception', href: '/reception', labelKey: 'nav.reception', permission: 'students.read', roles: ['RECEPTIONIST', 'ASSISTANT'] },
  { key: 'teacher', href: '/teacher', labelKey: 'nav.teacherArea', permission: null, roles: ['TEACHER'] },
  { key: 'students', href: '/students', labelKey: 'nav.students', permission: 'students.read' },
  { key: 'groups', href: '/groups', labelKey: 'nav.groups', permission: 'groups.read' },
  { key: 'courses', href: '/courses', labelKey: 'nav.courses', permission: 'courses.read' },
  { key: 'calendar', href: '/calendar', labelKey: 'nav.calendar', permission: 'lessons.read' },
  { key: 'attendance', href: '/attendance', labelKey: 'nav.attendance', permission: 'attendance.read' },
  { key: 'homework', href: '/homework', labelKey: 'nav.homework', permission: 'homework.read' },
  { key: 'grades', href: '/grades', labelKey: 'nav.grades', permission: 'grades.read' },
  { key: 'teachers', href: '/teachers', labelKey: 'nav.teachers', permission: 'staff.read' },
  { key: 'announcements', href: '/announcements', labelKey: 'nav.announcements', permission: 'notifications.send' },
  { key: 'payments', href: '/payments', labelKey: 'nav.payments', permission: 'payments.read' },
  { key: 'salaries', href: '/salaries', labelKey: 'nav.salaries', permission: 'salary.read' },
  { key: 'expenses', href: '/expenses', labelKey: 'nav.expenses', permission: 'expenses.read' },
  { key: 'finance', href: '/finance', labelKey: 'nav.finance', permission: 'finance.read' },
  { key: 'reports', href: '/reports', labelKey: 'nav.reports', permission: 'reports.read' },
  { key: 'billing', href: '/billing', labelKey: 'nav.billing', permission: 'center.billing' },
];

export function navFor(role: OrgRole, permissions: ReadonlySet<Permission>): NavItem[] {
  return NAV.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.permission && !permissions.has(item.permission)) return false;
    return true;
  });
}
