-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'STAFF', 'TEACHERS', 'STUDENTS', 'GROUP');

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "authorMemberId" UUID,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'EVERYONE',
    "groupId" UUID,
    "expiresAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_organizationId_deletedAt_createdAt_idx" ON "announcements"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "announcements_organizationId_groupId_idx" ON "announcements"("organizationId", "groupId");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
