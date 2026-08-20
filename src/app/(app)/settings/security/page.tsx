import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/tenant';
import { getLocale, getTranslator } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SecurityForms } from './SecurityForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t('settings.securityTitle'), robots: { index: false } };
}

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const t = await getTranslator();
  const locale = await getLocale();

  const [sessions, account] = await Promise.all([
    prisma.session.findMany({
      where: { userId: user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
      take: 20,
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { passwordHash: true, googleSub: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <SecurityForms
        hasPassword={Boolean(account.passwordHash)}
        hasGoogle={Boolean(account.googleSub)}
        otherSessionCount={sessions.filter((s) => s.id !== user.sessionId).length}
      />

      <Card>
        <CardHeader title={t('auth.sessions')} />
        <CardBody className="p-0">
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
                  {session.userAgent ?? '—'}
                </span>
                <span className="tnum text-[12px] text-ink-faint">
                  {t('auth.lastSeen')}: {formatDate(session.lastSeenAt, locale, { dateStyle: 'short', timeStyle: 'short' }, user.timezone)}
                </span>
                {session.id === user.sessionId && <Badge tone="brand">{t('auth.currentSession')}</Badge>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
