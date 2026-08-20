-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SalaryModel" AS ENUM ('FIXED', 'PER_LESSON', 'PERCENTAGE', 'MIXED');

-- CreateEnum
CREATE TYPE "GradeScheme" AS ENUM ('POINTS_100', 'POINTS_5', 'LETTER');

-- CreateEnum
CREATE TYPE "HomeworkStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'LATE', 'MISSING', 'GRADED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'EQUIPMENT', 'TAX', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileKind" ADD VALUE 'HOMEWORK_ATTACHMENT';
ALTER TYPE "FileKind" ADD VALUE 'HOMEWORK_SUBMISSION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LESSON_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'LESSON_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'HOMEWORK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'HOMEWORK_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'GRADE_POSTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'STUDENT_REGISTERED';
ALTER TYPE "NotificationType" ADD VALUE 'SALARY_PAID';
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgRole" ADD VALUE 'RECEPTIONIST';
ALTER TYPE "OrgRole" ADD VALUE 'STUDENT';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorAdminId" UUID,
ADD COLUMN     "isOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "courseId" UUID,
ADD COLUMN     "endDate" DATE,
ADD COLUMN     "startDate" DATE;

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
ADD COLUMN     "hireDate" DATE,
ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "salaryAmountMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "salaryModel" "SalaryModel" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "salaryPercentBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "specialization" VARCHAR(160),
ADD COLUMN     "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "subject" VARCHAR(120);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "city" VARCHAR(80),
ADD COLUMN     "description" VARCHAR(2000),
ADD COLUMN     "district" VARCHAR(80),
ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "instagram" VARCHAR(80),
ADD COLUMN     "legalName" VARCHAR(200),
ADD COLUMN     "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" VARCHAR(300),
ADD COLUMN     "website" VARCHAR(200),
ADD COLUMN     "workingHours" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "address" VARCHAR(300),
ADD COLUMN     "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "studentNo" VARCHAR(24),
ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credentialsExpireAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "username" VARCHAR(64);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320),
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" VARCHAR(64) NOT NULL,
    "userAgent" VARCHAR(400),
    "ipHash" VARCHAR(64),
    "impersonatingOrgId" UUID,
    "impersonationStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "catalogKey" VARCHAR(40),
    "description" VARCHAR(1000),
    "defaultFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "durationMonths" INTEGER,
    "color" VARCHAR(9) NOT NULL DEFAULT '#2563eb',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "teacherId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(4000),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "HomeworkStatus" NOT NULL DEFAULT 'PUBLISHED',
    "maxScore" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_attachments" (
    "id" UUID NOT NULL,
    "homeworkId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_submissions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "homeworkId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "submittedAt" TIMESTAMP(3),
    "note" VARCHAR(2000),
    "fileId" UUID,
    "score" INTEGER,
    "feedback" VARCHAR(2000),
    "markedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "groupId" UUID,
    "lessonId" UUID,
    "homeworkId" UUID,
    "teacherId" UUID,
    "scheme" "GradeScheme" NOT NULL DEFAULT 'POINTS_100',
    "valueNumeric" INTEGER,
    "valueLetter" VARCHAR(4),
    "maxValue" INTEGER,
    "weightBp" INTEGER NOT NULL DEFAULT 10000,
    "title" VARCHAR(160),
    "comment" VARCHAR(1000),
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_payments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "model" "SalaryModel" NOT NULL DEFAULT 'FIXED',
    "basis" JSONB NOT NULL DEFAULT '{}',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(300),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "title" VARCHAR(200) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "spentAt" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(300),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_username_key" ON "platform_admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminId_revokedAt_idx" ON "admin_sessions"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "admin_sessions_expiresAt_idx" ON "admin_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "courses_organizationId_isActive_idx" ON "courses"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organizationId_name_key" ON "courses"("organizationId", "name");

-- CreateIndex
CREATE INDEX "homework_organizationId_dueAt_idx" ON "homework"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "homework_organizationId_groupId_dueAt_idx" ON "homework"("organizationId", "groupId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "homework_attachments_homeworkId_fileId_key" ON "homework_attachments"("homeworkId", "fileId");

-- CreateIndex
CREATE INDEX "homework_submissions_organizationId_studentId_idx" ON "homework_submissions"("organizationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_submissions_homeworkId_studentId_key" ON "homework_submissions"("homeworkId", "studentId");

-- CreateIndex
CREATE INDEX "grades_organizationId_studentId_gradedAt_idx" ON "grades"("organizationId", "studentId", "gradedAt");

-- CreateIndex
CREATE INDEX "grades_organizationId_groupId_gradedAt_idx" ON "grades"("organizationId", "groupId", "gradedAt");

-- CreateIndex
CREATE INDEX "salary_payments_organizationId_periodYear_periodMonth_idx" ON "salary_payments"("organizationId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "salary_payments_organizationId_memberId_paidAt_idx" ON "salary_payments"("organizationId", "memberId", "paidAt");

-- CreateIndex
CREATE INDEX "expenses_organizationId_spentAt_idx" ON "expenses"("organizationId", "spentAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorAdminId_createdAt_idx" ON "audit_logs"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "organization_members_organizationId_role_removedAt_idx" ON "organization_members"("organizationId", "role", "removedAt");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_organizationId_studentNo_key" ON "students"("organizationId", "studentNo");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_impersonatingOrgId_fkey" FOREIGN KEY ("impersonatingOrgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_attachments" ADD CONSTRAINT "homework_attachments_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_attachments" ADD CONSTRAINT "homework_attachments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "homework"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

