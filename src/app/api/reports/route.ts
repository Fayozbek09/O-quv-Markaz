import { NextResponse } from 'next/server';
import { json, orgRoute, readQuery } from '@/lib/api';
import { reportQuerySchema } from '@/lib/validation/schemas';
import { monthlyReport, toCsv } from '@/lib/domain/reports';
import { orgTimezone } from '@/lib/domain/org';
import { formatMoney } from '@/lib/money';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, reportQuerySchema);
  const tz = await orgTimezone(ctx);
  const report = await monthlyReport(ctx, query.year, query.month, tz, query.groupId);

  if (query.format === 'csv') {
    const rows = report.groups.map((g) => ({
      group: g.name,
      students: g.students,
      lessons: g.lessons,
      expected: formatMoney(g.expectedMinor, g.currency, 'en-US'),
      received: formatMoney(g.receivedMinor, g.currency, 'en-US'),
      debt: formatMoney(g.debtMinor, g.currency, 'en-US'),
    }));
    const csv = toCsv(rows, ['group', 'students', 'lessons', 'expected', 'received', 'debt']);
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        // `attachment` plus a fixed filename: the browser never renders this.
        'content-disposition': `attachment; filename="ustozly-report-${query.year}-${String(query.month).padStart(2, '0')}.csv"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  }

  return json(report);
});
