import type { OrgRole } from '@/generated/prisma/enums';

/**
 * Explicit permission catalogue.
 *
 * Authorization is a set membership test, not a rank comparison: a receptionist
 * may create students (which a teacher may not) while a teacher may write
 * grades (which a receptionist may not), so the two cannot be ordered on a
 * single axis. Every server entry point names the permission it needs; the UI
 * only ever *hides* things it already knows the server would refuse.
 */
export const PERMISSIONS = [
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
  'students.import',
  'students.credentials',

  'groups.read',
  'groups.create',
  'groups.update',
  'groups.delete',
  'groups.members',
  'groups.assignTeacher',

  'courses.read',
  'courses.write',

  'lessons.read',
  'lessons.write',
  'lessons.cancel',

  'attendance.read',
  'attendance.write',

  'homework.read',
  'homework.write',
  'homework.grade',

  'grades.read',
  'grades.write',

  'payments.read',
  'payments.create',
  'payments.adjust',
  'invoices.read',
  'invoices.write',

  'teachers.read',
  'teachers.create',
  'teachers.update',
  'teachers.delete',

  'staff.read',
  'staff.create',
  'staff.update',
  'staff.delete',

  'salary.read',
  'salary.write',

  'expenses.read',
  'expenses.write',

  'reports.read',
  'reports.export',

  'notifications.send',

  'center.settings',
  'center.billing',
  'center.delete',
  'center.audit',

  // Held only by a platform administrator; a centre role can never gain these.
  'platform.centers',
  'platform.impersonate',
  'platform.audit',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PLATFORM_ONLY = new Set<Permission>([
  'platform.centers',
  'platform.impersonate',
  'platform.audit',
]);

const OWNER: Permission[] = PERMISSIONS.filter((p) => !PLATFORM_ONLY.has(p));

/** Centre admin: everything the owner has except destroying or selling the centre. */
const ADMIN: Permission[] = OWNER.filter(
  (p) => p !== 'center.delete' && p !== 'center.billing',
);

const RECEPTIONIST: Permission[] = [
  'students.read', 'students.create', 'students.update', 'students.import',
  'students.credentials',
  'groups.read', 'groups.create', 'groups.update', 'groups.members', 'groups.assignTeacher',
  'courses.read',
  'lessons.read', 'lessons.write',
  'attendance.read',
  'homework.read',
  'grades.read',
  'payments.read', 'payments.create',
  'invoices.read', 'invoices.write',
  'teachers.read',
  'staff.read',
  'reports.read',
  'notifications.send',
];

const TEACHER: Permission[] = [
  'students.read',
  'groups.read',
  'courses.read',
  'lessons.read', 'lessons.write', 'lessons.cancel',
  'attendance.read', 'attendance.write',
  'homework.read', 'homework.write', 'homework.grade',
  'grades.read', 'grades.write',
  // salary.read is scoped to *their own* record inside the salary routes.
  'salary.read',
];

/**
 * A student holds no centre permissions. The student portal reads through
 * dedicated, self-scoped queries in lib/domain/portal.ts — never through the
 * staff endpoints — so there is no permission a crafted request could reuse.
 */
const STUDENT: Permission[] = [];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  OWNER,
  ADMIN,
  RECEPTIONIST,
  TEACHER,
  STUDENT,
  // Legacy rows created before the receptionist role existed.
  ASSISTANT: RECEPTIONIST,
};

/**
 * Permissions an owner is allowed to grant to a member on top of their role.
 * Anything outside this list is ignored even if it is written to the column, so
 * a stray database edit cannot mint an owner.
 */
export const GRANTABLE: Record<OrgRole, readonly Permission[]> = {
  OWNER: [],
  ADMIN: [],
  RECEPTIONIST: [
    'attendance.write', 'students.delete', 'groups.delete', 'payments.adjust',
    'salary.read', 'expenses.read', 'reports.export', 'teachers.create',
    'teachers.update', 'homework.read', 'grades.read',
  ],
  ASSISTANT: [
    'attendance.write', 'students.delete', 'groups.delete', 'payments.adjust',
    'salary.read', 'expenses.read', 'reports.export',
  ],
  TEACHER: ['groups.create', 'groups.update', 'students.read', 'reports.read'],
  STUDENT: [],
};

const isPermission = (v: unknown): v is Permission =>
  typeof v === 'string' && (PERMISSIONS as readonly string[]).includes(v);

/**
 * Resolves the effective permission set: role baseline plus any override the
 * owner explicitly granted, filtered through GRANTABLE.
 */
export function permissionsFor(
  role: OrgRole,
  overrides?: unknown,
): ReadonlySet<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const allowed = new Set<Permission>(GRANTABLE[role] ?? []);
    for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (!isPermission(key)) continue;
      if (value === true && allowed.has(key)) set.add(key);
      // Revoking works for anything the role holds by default.
      if (value === false) set.delete(key);
    }
  }
  return set;
}

export function roleHas(role: OrgRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** Landing route for a role, used by the login redirect and by /dashboard. */
export const ROLE_HOME: Record<OrgRole, string> = {
  OWNER: '/center',
  ADMIN: '/center',
  RECEPTIONIST: '/reception',
  ASSISTANT: '/reception',
  TEACHER: '/teacher',
  STUDENT: '/student',
};

/** Roles a centre user may hold. Used to validate role inputs from a form. */
export const ASSIGNABLE_ROLES = ['ADMIN', 'RECEPTIONIST', 'TEACHER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const isStaffRole = (role: OrgRole) => role !== 'STUDENT';
