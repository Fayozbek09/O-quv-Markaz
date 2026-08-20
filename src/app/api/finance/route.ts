import { NextResponse } from 'next/server';
import { json, orgRoute, readQuery } from '@/lib/api';
import { financeQuerySchema } from '@/lib/validation/schemas';
import { yearlyFinance } from '@/lib/domain/finance';
import { orgTimezone } from '@/lib/domain/org';
import { toCsv } from '@/lib/domain/reports';
import { formatMoney } from '@/lib/money';
import { orgCurrency } from '@/lib/domain/org';

export const GET = orgRoute(async (ctx, request) => {
  const query = readQuery(request, financeQuerySchema);
  const [tz, currency] = await Promise.all([orgTimezone(ctx), orgCurrency(ctx)]);
  const result = await yearlyFinance(ctx, query.year, tz);

  if (query.format === 'csv') {
    const rows = result.months.map((m) => ({
      month: `${m.year}-${String(m.month).padStart(2, '0')}`,
      revenue: formatMoney(m.revenueMinor, currency, 'en-US'),
      invoiced: formatMoney(m.invoicedMinor, currency, 'en-US'),
      outstanding: formatMoney(m.outstandingMinor, currency, 'en-US'),
      salaries: formatMoney(m.salaryMinor, currency, 'en-US'),
      expenses: formatMoney(m.expenseMinor, currency, 'en-US'),
      net: formatMoney(m.netMinor, currency, 'en-US'),
    }));
    const csv = toCsv(rows, ['month', 'revenue', 'invoiced', 'outstanding', 'salaries', 'expenses', 'net']);
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="finance-${query.year}.csv"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    });
  }

  return json(result);
}, 'reports.read');
