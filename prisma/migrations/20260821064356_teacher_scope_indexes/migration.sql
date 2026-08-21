-- CreateIndex
CREATE INDEX "groups_organizationId_teacherId_idx" ON "groups"("organizationId", "teacherId");

-- CreateIndex
CREATE INDEX "lessons_organizationId_teacherId_startsAt_idx" ON "lessons"("organizationId", "teacherId", "startsAt");
