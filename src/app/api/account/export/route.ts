import { prisma } from '@/lib/db';
import { toErrorResponse } from '@/lib/api';
import { requireUser } from '@/lib/tenant';
import { audit } from '@/lib/security/audit';

/**
 * Data portability: everything this user's workspaces hold about them and their
 * students, as JSON. Scoped strictly to workspaces they are a member of.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.userId, removedAt: null },
      select: { organizationId: true, role: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);

    const [profile, organizations, students, groups, lessons, attendance, payments, invoices] =
      await Promise.all([
        prisma.profile.findUnique({ where: { userId: user.userId } }),
        prisma.organization.findMany({ where: { id: { in: orgIds } } }),
        prisma.student.findMany({
          where: { organizationId: { in: orgIds } },
          include: { parents: true },
        }),
        prisma.group.findMany({ where: { organizationId: { in: orgIds } }, include: { members: true } }),
        prisma.lesson.findMany({ where: { organizationId: { in: orgIds } } }),
        prisma.attendance.findMany({ where: { organizationId: { in: orgIds } } }),
        prisma.payment.findMany({
          where: { organizationId: { in: orgIds } },
          include: { adjustments: true },
        }),
        prisma.invoice.findMany({ where: { organizationId: { in: orgIds } } }),
      ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      account: { id: user.userId, email: user.email, phone: user.phone },
      profile,
      organizations,
      students,
      groups,
      lessons,
      attendance,
      payments,
      invoices,
    };

    await audit({ actorUserId: user.userId, action: 'account.export' });

    // BigInt is not JSON-serializable; money is emitted as a decimal string.
    const body = JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="ustozly-export.json"',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
