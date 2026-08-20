import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS, ROLE_PERMISSIONS, GRANTABLE, permissionsFor, roleHas, ROLE_HOME,
  type Permission,
} from '@/lib/rbac';

/**
 * The permission matrix is the whole authorization model, so it is asserted
 * directly rather than only through the endpoints that consume it.
 */
describe('role permissions', () => {
  it('gives the owner everything except the platform-only capabilities', () => {
    const owner = new Set(ROLE_PERMISSIONS.OWNER);
    expect(owner.has('center.delete')).toBe(true);
    expect(owner.has('salary.write')).toBe(true);
    for (const platform of ['platform.centers', 'platform.impersonate', 'platform.audit'] as const) {
      expect(owner.has(platform)).toBe(false);
    }
  });

  it('never grants a platform capability to any centre role', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      for (const platform of ['platform.centers', 'platform.impersonate', 'platform.audit'] as const) {
        expect(roleHas(role, platform)).toBe(false);
      }
    }
  });

  it('withholds centre destruction and billing from a centre admin', () => {
    expect(roleHas('ADMIN', 'center.delete')).toBe(false);
    expect(roleHas('ADMIN', 'center.billing')).toBe(false);
    expect(roleHas('ADMIN', 'students.create')).toBe(true);
  });

  it('separates the receptionist and the teacher rather than ranking them', () => {
    // Neither role is a superset of the other — this is why rank comparison
    // was replaced with an explicit matrix.
    expect(roleHas('RECEPTIONIST', 'students.create')).toBe(true);
    expect(roleHas('TEACHER', 'students.create')).toBe(false);

    expect(roleHas('TEACHER', 'grades.write')).toBe(true);
    expect(roleHas('RECEPTIONIST', 'grades.write')).toBe(false);

    expect(roleHas('TEACHER', 'attendance.write')).toBe(true);
    expect(roleHas('RECEPTIONIST', 'attendance.write')).toBe(false);
  });

  it("keeps money out of a teacher's reach", () => {
    expect(roleHas('TEACHER', 'payments.create')).toBe(false);
    expect(roleHas('TEACHER', 'payments.read')).toBe(false);
    expect(roleHas('TEACHER', 'salary.write')).toBe(false);
    expect(roleHas('TEACHER', 'expenses.read')).toBe(false);
  });

  it('gives a student no centre permission at all', () => {
    expect(ROLE_PERMISSIONS.STUDENT).toHaveLength(0);
  });

  it('treats the legacy ASSISTANT role as a receptionist', () => {
    expect(ROLE_PERMISSIONS.ASSISTANT).toEqual(ROLE_PERMISSIONS.RECEPTIONIST);
  });

  it('routes every role to its own landing area', () => {
    expect(ROLE_HOME.OWNER).toBe('/center');
    expect(ROLE_HOME.RECEPTIONIST).toBe('/reception');
    expect(ROLE_HOME.TEACHER).toBe('/teacher');
    expect(ROLE_HOME.STUDENT).toBe('/student');
  });
});

describe('per-member overrides', () => {
  it('honours a grant that the role is allowed to receive', () => {
    const perms = permissionsFor('RECEPTIONIST', { 'attendance.write': true });
    expect(perms.has('attendance.write')).toBe(true);
  });

  it("ignores a grant outside the role's grantable set", () => {
    // An owner cannot hand a receptionist the keys to the centre by writing a
    // permission the matrix never intended them to hold.
    const perms = permissionsFor('RECEPTIONIST', {
      'center.delete': true,
      'center.settings': true,
      'salary.write': true,
    });
    expect(perms.has('center.delete')).toBe(false);
    expect(perms.has('center.settings')).toBe(false);
    expect(perms.has('salary.write')).toBe(false);
  });

  it('ignores an unknown permission string', () => {
    const perms = permissionsFor('TEACHER', { 'not.a.permission': true } as Record<string, boolean>);
    expect([...perms].some((p) => (p as string) === 'not.a.permission')).toBe(false);
  });

  it('always allows a revocation, which can only narrow the account', () => {
    const perms = permissionsFor('TEACHER', { 'grades.write': false });
    expect(perms.has('grades.write')).toBe(false);
    expect(perms.has('attendance.write')).toBe(true);
  });

  it('never lets a grantable list contain a platform capability', () => {
    for (const list of Object.values(GRANTABLE)) {
      for (const permission of list) {
        expect(permission.startsWith('platform.')).toBe(false);
      }
    }
  });

  it('cannot escalate a student, whose grantable list is empty', () => {
    const perms = permissionsFor('STUDENT', {
      'students.read': true,
      'payments.read': true,
    } as Record<Permission, boolean>);
    expect(perms.size).toBe(0);
  });
});

describe('catalogue hygiene', () => {
  it('has no duplicate permission strings', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
