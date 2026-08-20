import { prisma } from '../db';
import { NotFound } from '../errors';
import type { OrgContext } from '../tenant';

/** Cached-per-request lookup of the workspace record. */
export async function currentOrg(ctx: OrgContext) {
  const org = await prisma.organization.findFirst({
    where: { id: ctx.orgId, deletedAt: null },
    include: { logo: { select: { id: true } } },
  });
  if (!org) throw NotFound();
  return org;
}

/** Lessons are scheduled in the workspace's timezone, not the server's. */
export async function orgTimezone(ctx: OrgContext): Promise<string> {
  const org = await prisma.organization.findFirst({
    where: { id: ctx.orgId },
    select: { timezone: true },
  });
  return org?.timezone ?? 'Asia/Tashkent';
}

export async function orgCurrency(ctx: OrgContext): Promise<string> {
  const org = await prisma.organization.findFirst({
    where: { id: ctx.orgId },
    select: { defaultCurrency: true },
  });
  return org?.defaultCurrency ?? 'UZS';
}
