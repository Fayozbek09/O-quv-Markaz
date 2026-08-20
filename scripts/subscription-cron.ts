import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Periodic subscription maintenance. Run daily (cron, systemd timer, k8s job):
 *
 *   npm run subscriptions:remind
 *
 * Two jobs: roll every subscription forward through the trial → payment due →
 * grace → suspended ladder, and send the 7/3/1/0-day reminders. Both are
 * idempotent, so running twice in a day changes nothing and sends nothing
 * twice. Statuses are also evaluated on read, so a missed run never leaves a
 * centre in a stale state.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Imported lazily so this script does not pull in the Next request context.
  const { currentSubscription, sendDueReminders } = await import('../src/lib/domain/subscription');

  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  let evaluated = 0;
  for (const org of orgs) {
    await currentSubscription(org.id);
    evaluated += 1;
  }

  const reminders = await sendDueReminders();
  console.info(`subscriptions: evaluated ${evaluated} centre(s), sent ${reminders} reminder(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
