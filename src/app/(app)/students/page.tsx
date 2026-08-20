import Link from 'next/link';
import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { listStudents } from '@/lib/domain/students';
import { planUsage } from '@/lib/domain/plan';
import { studentListQuerySchema } from '@/lib/validation/schemas';
import { getTranslator } from '@/lib/i18n/server';
import { Card } from '@/components/ui/Card';
import { TableWrap, Th, Td, EmptyState } from '@/components/ui/Table';
import { Badge, Dot } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { StudentsToolbar } from './StudentsToolbar';
import { StudentRowActions } from './StudentRowActions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('students.title'), robots: { index: false } };
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireOrg();
  const t = await getTranslator();
  const raw = await searchParams;

  // Unknown or malformed parameters fall back to defaults rather than erroring.
  const parsed = studentListQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(raw)
        .filter(([key]) => key !== 'new')
        .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
        .filter(([, value]) => value !== undefined && value !== ''),
    ),
  );
  const query = parsed.success ? parsed.data : studentListQuerySchema.parse({});

  const [{ rows, total, page, perPage }, usage] = await Promise.all([
    listStudents(ctx, query),
    planUsage(ctx.orgId),
  ]);

  const statusTone = { ACTIVE: 'ok', PAUSED: 'warn', ARCHIVED: 'neutral' } as const;
  const statusLabel = {
    ACTIVE: t('students.statusActive'),
    PAUSED: t('students.statusPaused'),
    ARCHIVED: t('students.statusArchived'),
  } as const;

  return (
    <>
      <StudentsToolbar
        query={{ q: query.q ?? '', status: query.status }}
        usage={{ used: usage.activeStudents, limit: usage.limit }}
        openNew={raw.new === '1'}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('students.empty')} hint={t('students.emptyHint')} />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  <Th>{t('students.phone')}</Th>
                  <Th>{t('students.groups')}</Th>
                  <Th>{t('students.parentName')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th className="w-px text-right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((student) => (
                  <tr key={student.id} className="hover:bg-surface-muted/50">
                    <Td>
                      <Link
                        href={`/students/${student.id}`}
                        className="font-medium text-ink hover:text-brand-600 hover:underline"
                      >
                        {[student.firstName, student.lastName].filter(Boolean).join(' ')}
                      </Link>
                    </Td>
                    <Td className="tnum text-ink-soft">{student.phone ?? '—'}</Td>
                    <Td>
                      {student.memberships.length === 0 ? (
                        <span className="text-[13px] text-ink-faint">{t('students.noGroups')}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {student.memberships.map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px]"
                            >
                              <Dot color={m.group.color} />
                              {m.group.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-soft">
                      {student.parents[0] ? (
                        <span className="text-[13px]">
                          {student.parents[0].fullName}
                          {student.parents[0].phone && (
                            <span className="tnum ml-1.5 text-ink-faint">{student.parents[0].phone}</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <Badge tone={statusTone[student.status]}>{statusLabel[student.status]}</Badge>
                    </Td>
                    <Td className="text-right">
                      <StudentRowActions
                        studentId={student.id}
                        name={[student.firstName, student.lastName].filter(Boolean).join(' ')}
                        archived={student.status === 'ARCHIVED'}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={page} perPage={perPage} total={total} />
          </>
        )}
      </Card>
    </>
  );
}
