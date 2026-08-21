import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { audit } from '@/lib/security/audit';

/**
 * The daily subscription job, as an HTTP route so a serverless host can call it.
 *
 * `scripts/subscription-cron.ts` does the same work from a shell, for a
 * deployment with a real cron daemon. Both exist because the hosting decides
 * which is possible: a VPS runs the script from systemd, and a platform without
 * long-lived processes calls this instead.
 *
 * It is not public. Vercel signs its scheduled requests with CRON_SECRET as a
 * bearer token, and without that secret configured the route refuses everything
 * — an open endpoint that rolls subscription states and sends messages is not
 * something to leave to obscurity.
 *
 * Running it twice in a day changes nothing and sends nothing twice: the state
 * ladder is idempotent and each reminder is recorded before it goes out.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!offered || !safeEqual(offered, env.CRON_SECRET)) {
    await audit({ action: 'cron.subscriptions', outcome: 'denied' });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { currentSubscription, sendDueReminders } = await import('@/lib/domain/subscription');

  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  let evaluated = 0;
  for (const org of orgs) {
    // Evaluating reads the ladder and writes any state change it implies.
    await currentSubscription(org.id);
    evaluated += 1;
  }

  const reminders = await sendDueReminders();

  await audit({
    action: 'cron.subscriptions',
    outcome: 'success',
    meta: { evaluated, reminders },
  });

  return NextResponse.json(
    { ok: true, evaluated, reminders },
    { headers: { 'cache-control': 'no-store' } },
  );
}
