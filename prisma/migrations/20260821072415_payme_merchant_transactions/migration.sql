-- CreateTable
CREATE TABLE "payme_transactions" (
    "id" UUID NOT NULL,
    "paymeId" VARCHAR(64) NOT NULL,
    "intentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 1,
    "reason" INTEGER,
    "paymeTime" BIGINT NOT NULL,
    "createTime" BIGINT NOT NULL,
    "performTime" BIGINT NOT NULL DEFAULT 0,
    "cancelTime" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payme_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payme_transactions_paymeId_key" ON "payme_transactions"("paymeId");

-- CreateIndex
CREATE INDEX "payme_transactions_intentId_idx" ON "payme_transactions"("intentId");

-- CreateIndex
CREATE INDEX "payme_transactions_organizationId_state_idx" ON "payme_transactions"("organizationId", "state");

-- AddForeignKey
ALTER TABLE "payme_transactions" ADD CONSTRAINT "payme_transactions_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "billing_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payme_transactions" ADD CONSTRAINT "payme_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
