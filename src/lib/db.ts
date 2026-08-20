import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env, isProd } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    // Query logs can contain personal data; keep them out of production.
    log: isProd ? ['error'] : ['error', 'warn'],
  });
}

export const prisma = globalForPrisma.prisma ?? create();
if (!isProd) globalForPrisma.prisma = prisma;
