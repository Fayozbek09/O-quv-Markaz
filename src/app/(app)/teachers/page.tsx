import type { Metadata } from 'next';
import { requireOrg } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/page';
import { listStaff } from '@/lib/domain/staff';
import { currentOrg } from '@/lib/domain/org';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/i18n';
import { INTL_LOCALE } from '@/lib/i18n/config';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, TableWrap, Th, Td } from '@/components/ui/Table';
import { PageHeader } from '@/components/layout/PageHeader';
import { StaffDialog } from './StaffDialog';
import { StaffRowActions } from './StaffRowActions';
import type { TKey } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('staff.title'), robots: { index: false } };
}

export default async function TeachersPage() {
  const ctx = await requireOrg();
  requirePagePermission(ctx, 'staff.read');

  const t = await getTranslator();
  const locale = await getLocale();
  const [rows, org] = await Promise.all([listStaff(ctx), currentOrg(ctx)]);

  const canCreate = ctx.permissions.has('teachers.create') || ctx.permissions.has('staff.create');
  const canSeeSalary = ctx.permissions.has('salary.read') && ctx.role !== 'TEACHER';
  const money = (v: bigint) => formatMoney(v, org.defaultCurrency, INTL_LOCALE[locale]);

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        subtitle={`${rows.length}`}
        actions={canCreate ? <StaffDialog canCreateAdmin={ctx.role === 'OWNER'} /> : null}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('staff.noStaff')} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('staff.role')}</Th>
                <Th>{t('staff.subject')}</Th>
                <Th>{t('staff.username')}</Th>
                <Th className="text-right">{t('staff.groupsTaught')}</Th>
                {canSeeSalary && <Th className="text-right">{t('salary.amount')}</Th>}
                <Th>{t('staff.lastLogin')}</Th>
                <Th className="text-right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => {
                const profile = member.user.profile;
                const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '—';
                return (
                  <tr key={member.id}>
                    <Td className="text-sm font-medium">{name}</Td>
                    <Td>
                      <Badge tone={member.role === 'OWNER' ? 'brand' : 'neutral'}>
                        {t(`roles.${member.role}` as TKey)}
                      </Badge>
                    </Td>
                    <Td className="text-[13px] text-ink-soft">
                      {member.subject ?? profile?.teachingSubject ?? '—'}
                    </Td>
                    <Td className="font-mono text-[12px] text-ink-soft">
                      {member.user.username ?? '—'}
                      {member.user.mustChangePassword && (
                        <Badge tone="warn" className="ml-2">
                          {t('changePassword.title')}
                        </Badge>
                      )}
                    </Td>
                    <Td className="tnum text-right text-[13px]">{member._count.groups}</Td>
                    {canSeeSalary && (
                      <Td className="tnum text-right text-[13px]">
                        {member.salaryAmountMinor === null
                          ? '—'
                          : member.salaryModel === 'PERCENTAGE'
                            ? `${(member.salaryPercentBp ?? 0) / 100}%`
                            : money(member.salaryAmountMinor)}
                      </Td>
                    )}
                    <Td className="tnum whitespace-nowrap text-[12px] text-ink-faint">
                      {member.user.lastLoginAt
                        ? formatDate(member.user.lastLoginAt, locale, 'dateNumeric')
                        : t('staff.neverLoggedIn')}
                    </Td>
                    <Td className="text-right">
                      <StaffRowActions
                        memberId={member.id}
                        role={member.role}
                        canManage={canCreate}
                        canWriteSalary={ctx.permissions.has('salary.write')}
                        salaryModel={member.salaryModel}
                        salaryAmount={member.salaryAmountMinor?.toString() ?? null}
                        salaryPercent={
                          member.salaryPercentBp === null ? null : member.salaryPercentBp / 100
                        }
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
