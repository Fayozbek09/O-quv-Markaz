-- AlterTable
ALTER TABLE "admin_sessions" ADD COLUMN     "secondFactorAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpRecoveryHashes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "totpSecret" VARCHAR(64);
