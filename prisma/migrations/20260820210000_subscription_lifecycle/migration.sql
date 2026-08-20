-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'STANDARD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'TRIAL';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAYMENT_DUE';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'GRACE_PERIOD';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "amountMinor" BIGINT NOT NULL DEFAULT 300000,
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "lastPaymentAt" TIMESTAMP(3),
ADD COLUMN     "nextPaymentAt" TIMESTAMP(3),
ADD COLUMN     "remindersSent" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStartedAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartedAt" TIMESTAMP(3),
ALTER COLUMN "plan" SET DEFAULT 'STANDARD',
ALTER COLUMN "status" SET DEFAULT 'TRIAL';

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "provider" VARCHAR(40) NOT NULL,
    "providerTransactionId" VARCHAR(160),
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "failureReason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(300),
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "subscription_payments_organizationId_createdAt_idx" ON "subscription_payments"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_payments_status_paidAt_idx" ON "subscription_payments"("status", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_provider_providerTransactionId_key" ON "subscription_payments"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "subscriptions_status_subscriptionEndsAt_idx" ON "subscriptions"("status", "subscriptionEndsAt");

-- CreateIndex
CREATE INDEX "subscriptions_status_trialEndsAt_idx" ON "subscriptions"("status", "trialEndsAt");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

