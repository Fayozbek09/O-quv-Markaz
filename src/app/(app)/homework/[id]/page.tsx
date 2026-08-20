import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { loadPage, requirePagePermission } from '@/lib/page';
import { getHomework } from '@/lib/domain/homework';
import { orgTimezone } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { AttachmentList } from '@/components/ui/AttachmentList';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { SubmissionSheet } from './SubmissionSheet';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('homework.title'), robots: { index: false } };
}

export default async function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'homework.read');

  const { id } = await params;
  const t = await getTranslator();
  const locale = await getLocale();
  const tz = await orgTimezone(ctx);

  const homework = await loadPage(() => getHomework(ctx, id));

  const canGrade = ctx.permissions.has('homework.grade');

  return (
    <>
      <PageHeader
        title={homework.title}
        subtitle={`${homework.group.name} · ${t('homework.due')} ${formatDate(homework.dueAt, locale, 'dateFullTime', tz)}`}
        actions={<Badge tone={homework.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{t(`homework.${homework.status}`)}</Badge>}
      />

      {(homework.description || homework.attachments.length > 0) && (
        <Card className="mb-4">
          <CardHeader title={t('homework.description')} />
          <CardBody className="flex flex-col gap-3">
            {/* Rendered as text, never as markup. */}
            {homework.description && (
              <p className="whitespace-pre-wrap text-[14px] text-ink-soft">{homework.description}</p>
            )}
            <AttachmentList items={homework.attachments} label={t('homework.attachments')} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('homework.submissions')}
          subtitle={`${homework.submissions.length}`}
        />
        {homework.submissions.length === 0 ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <SubmissionSheet
            homeworkId={homework.id}
            maxScore={homework.maxScore}
            canGrade={canGrade}
            rows={homework.submissions.map((s) => ({
              studentId: s.studentId,
              name: [s.student.firstName, s.student.lastName].filter(Boolean).join(' '),
              status: s.status,
              score: s.score,
              feedback: s.feedback,
            }))}
          />
        )}
      </Card>
    </>
  );
}
