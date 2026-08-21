import { prisma } from '@/lib/db';
import { toErrorResponse } from '@/lib/api';
import { requireUser } from '@/lib/tenant';
import { permissionsFor } from '@/lib/rbac';
import { audit } from '@/lib/security/audit';

/**
 * Data portability, scoped to what the caller is actually entitled to.
 *
 * Membership of a centre is not by itself a right to read the centre. Only a
 * member holding `reports.export` — an owner or a centre admin — takes the whole
 * centre with them. Everyone else, teachers and students included, gets their
 * own record and nothing about anybody else: the same rule the rest of the API
 * enforces, applied here too.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.userId, removedAt: null },
      select: {
        id: true,
        organizationId: true,
        role: true,
        permissions: true,
        joinedAt: true,
        organization: { select: { id: true, name: true, slug: true, phone: true, email: true } },
      },
    });

    const fullOrgIds = memberships
      .filter((m) => permissionsFor(m.role, m.permissions).has('reports.export'))
      .map((m) => m.organizationId);
    const memberIds = memberships.map((m) => m.id);

    // The caller's own student record, if the account is a portal login.
    const ownStudent = await prisma.student.findUnique({
      where: { userId: user.userId },
      include: { parents: true },
    });
    const ownStudentId = ownStudent?.id;

    const [profile, centre, mine] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: user.userId } }),
      fullOrgIds.length > 0 ? fullCentreExport(fullOrgIds) : null,
      personalExport(ownStudentId, memberIds),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      // Says plainly which of the two shapes this is, so a reader is never
      // left guessing whether an empty section means "none" or "not allowed".
      scope: centre ? 'centre' : 'personal',
      account: { id: user.userId, email: user.email, phone: user.phone },
      profile,
      memberships: memberships.map((m) => ({
        organization: m.organization,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      me: mine,
      ...(centre ?? {}),
    };

    await audit({
      actorUserId: user.userId,
      action: 'account.export',
      meta: { scope: centre ? 'centre' : 'personal' },
    });

    // BigInt is not JSON-serializable; money is emitted as a decimal string.
    const body = JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="oquv-markaz-export.json"',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Everything the centres this person runs hold. Gated on `reports.export`. */
async function fullCentreExport(orgIds: string[]) {
  const [organizations, students, groups, lessons, attendance, payments, invoices] =
    await Promise.all([
      prisma.organization.findMany({ where: { id: { in: orgIds } } }),
      prisma.student.findMany({
        where: { organizationId: { in: orgIds } },
        include: { parents: true },
      }),
      prisma.group.findMany({
        where: { organizationId: { in: orgIds } },
        include: { members: true },
      }),
      prisma.lesson.findMany({ where: { organizationId: { in: orgIds } } }),
      prisma.attendance.findMany({ where: { organizationId: { in: orgIds } } }),
      prisma.payment.findMany({
        where: { organizationId: { in: orgIds } },
        include: { adjustments: true },
      }),
      prisma.invoice.findMany({ where: { organizationId: { in: orgIds } } }),
    ]);

  return { organizations, students, groups, lessons, attendance, payments, invoices };
}

/**
 * The caller's own rows. A student sees their record, their attendance, their
 * marks and what they have paid; a teacher sees the pay they were given. Every
 * query is keyed on an id derived from the session, never from the request.
 */
async function personalExport(studentId: string | undefined, memberIds: string[]) {
  const [student, groupMemberships, attendance, grades, payments, invoices, salaryPayments] =
    await Promise.all([
      studentId
        ? prisma.student.findUnique({ where: { id: studentId }, include: { parents: true } })
        : null,
      studentId
        ? prisma.groupMember.findMany({
            where: { studentId },
            include: { group: { select: { id: true, name: true, status: true } } },
          })
        : [],
      studentId ? prisma.attendance.findMany({ where: { studentId } }) : [],
      studentId ? prisma.grade.findMany({ where: { studentId } }) : [],
      studentId
        ? prisma.payment.findMany({ where: { studentId }, include: { adjustments: true } })
        : [],
      studentId ? prisma.invoice.findMany({ where: { studentId } }) : [],
      memberIds.length > 0
        ? prisma.salaryPayment.findMany({ where: { memberId: { in: memberIds } } })
        : [],
    ]);

  return { student, groupMemberships, attendance, grades, payments, invoices, salaryPayments };
}
