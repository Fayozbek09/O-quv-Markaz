import { prisma } from '../db';
import { scope, type OrgContext } from '../tenant';
import { orgBalance } from './billing';
import { attendanceSummary } from './attendance';
import { monthBounds } from './time';

export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;

export async function monthlyReport(
  ctx: OrgContext,
  year: number,
  month: number,
  timeZone: string,
  groupId?: string,
) {
  const [from, until] = monthBounds(year, month, timeZone);

  const [balance, attendance, lessonCount, activeStudents, groupRows] = await Promise.all([
    orgBalance(ctx, { year, month, from, until }),
    attendanceSummary(ctx, { from, until }, groupId),
    prisma.lesson.count({
      where: {
        ...scope.orgLive(ctx),
        startsAt: { gte: from, lt: until },
        status: { not: 'CANCELLED' },
        ...(groupId ? { groupId } : {}),
      },
    }),
    prisma.student.count({ where: { ...scope.orgLive(ctx), status: 'ACTIVE' } }),
    prisma.group.findMany({
      where: { ...scope.orgLive(ctx), ...(groupId ? { id: groupId } : {}) },
      select: {
        id: true, name: true, currency: true,
        _count: { select: { members: { where: { leftAt: null } } } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Per-group money, resolved in two grouped queries rather than N+1.
  const [invoiceByGroup, paymentByGroup, lessonByGroup] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['groupId'],
      where: { ...scope.org(ctx), periodYear: year, periodMonth: month, status: { not: 'VOID' } },
      _sum: { amountMinor: true },
    }),
    prisma.payment.groupBy({
      by: ['groupId'],
      where: { ...scope.org(ctx), status: 'COMPLETED', paidAt: { gte: from, lt: until } },
      _sum: { amountMinor: true },
    }),
    prisma.lesson.groupBy({
      by: ['groupId'],
      where: {
        ...scope.orgLive(ctx),
        startsAt: { gte: from, lt: until },
        status: { not: 'CANCELLED' },
      },
      _count: { _all: true },
    }),
  ]);

  const invMap = new Map(invoiceByGroup.map((r) => [r.groupId ?? '', r._sum.amountMinor ?? 0n]));
  const payMap = new Map(paymentByGroup.map((r) => [r.groupId ?? '', r._sum.amountMinor ?? 0n]));
  const lesMap = new Map(lessonByGroup.map((r) => [r.groupId, r._count._all]));

  const groups = groupRows.map((g) => {
    const expected = invMap.get(g.id) ?? 0n;
    const received = payMap.get(g.id) ?? 0n;
    return {
      id: g.id,
      name: g.name,
      currency: g.currency,
      students: g._count.members,
      lessons: lesMap.get(g.id) ?? 0,
      expectedMinor: expected,
      receivedMinor: received,
      debtMinor: expected - received,
    };
  });

  const collectionRate =
    balance.expectedMinor > 0n ? Number(balance.paidMinor) / Number(balance.expectedMinor) : null;

  return {
    year, month, activeStudents, lessonCount, attendance, balance, collectionRate, groups,
  };
}

/** RFC 4180 quoting, plus the leading-apostrophe guard against CSV injection. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (value: unknown): string => {
    let s = value === null || value === undefined ? '' : String(value);
    // A cell starting with =, +, - or @ is executed as a formula by Excel and
    // LibreOffice; prefixing an apostrophe neutralizes it.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = columns.map(escape).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(',')).join('\n');
  // BOM so Excel opens Cyrillic and Latin-with-diacritics correctly.
  return `﻿${head}\n${body}\n`;
}
