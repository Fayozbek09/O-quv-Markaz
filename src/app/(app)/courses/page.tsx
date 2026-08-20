import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { listCourses } from '@/lib/domain/courses';
import { currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Badge, Dot } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { CourseDialog } from './CourseDialog';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('courses.title'), robots: { index: false } };
}

export default async function CoursesPage() {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'courses.read');

  const t = await getTranslator();
  const locale = await getLocale();
  const [rows, org] = await Promise.all([listCourses(ctx), currentOrg(ctx)]);
  const canWrite = ctx.permissions.has('courses.write');

  return (
    <>
      <PageHeader
        title={t('courses.title')}
        subtitle={`${rows.length}`}
        actions={canWrite ? <CourseDialog /> : null}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('common.empty')} hint={canWrite ? t('courses.catalog') : undefined} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('courses.name')}</Th>
                <Th>{t('courses.description')}</Th>
                <Th className="text-right">{t('courses.fee')}</Th>
                <Th className="text-right">{t('courses.duration')}</Th>
                <Th className="text-right">{t('nav.groups')}</Th>
                <Th>{t('common.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((course) => (
                <tr key={course.id}>
                  <Td className="text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Dot color={course.color} />
                      {course.name}
                    </span>
                  </Td>
                  <Td className="max-w-xs truncate text-[13px] text-ink-soft">
                    {course.description ?? '—'}
                  </Td>
                  <Td className="tnum text-right text-[13px]">
                    {formatMoney(course.defaultFeeMinor, course.currency || org.defaultCurrency, INTL_LOCALE[locale])}
                  </Td>
                  <Td className="tnum text-right text-[13px]">{course.durationMonths ?? '—'}</Td>
                  <Td className="tnum text-right text-[13px]">{course._count.groups}</Td>
                  <Td>
                    <Badge tone={course.isActive ? 'ok' : 'neutral'}>
                      {course.isActive ? t('courses.active') : t('courses.inactive')}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
