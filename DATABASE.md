# Database

PostgreSQL 17, accessed through Prisma 7 with the `@prisma/adapter-pg` driver
adapter. The schema lives in `prisma/schema.prisma`; migrations in
`prisma/migrations`.

---

## Tenancy

**Every tenant-owned table carries `organizationId`**, with a foreign key to
`organizations` and `ON DELETE CASCADE`. Deleting a workspace removes its
students, groups, lessons, attendance, invoices, payments, files and audit rows
in one operation.

Tables *not* scoped to a workspace, and why:

| Table | Scope |
|---|---|
| `users`, `profiles`, `sessions` | A person, who may belong to several workspaces |
| `otp_codes` | An identifier, before any account exists |
| `rate_limit_counters` | A rule and a subject |
| `webhook_events` | A provider and its event id |
| `files` | `organizationId` is nullable — user avatars are personal, workspace logos are not |

---

## Tables

### Identity

| Table | Purpose | Notable columns |
|---|---|---|
| `users` | Login identity | `email`/`phone` unique, `passwordHash` (Argon2id, nullable for Google-only), `googleSub` unique |
| `profiles` | Display and preferences | `locale`, `timezone`, `teachingSubject` |
| `sessions` | Server-side sessions | `tokenHash` unique, `csrfSecret`, `ipHash`, sliding `expiresAt` inside `absoluteExpiresAt` |
| `otp_codes` | One-time codes | `codeHash` (Argon2id), `attempts`, `maxAttempts`, `consumedAt` |
| `rate_limit_counters` | Fixed-window counters | `key` primary key = rule + hashed subject + window index |

### Tenancy

| Table | Purpose |
|---|---|
| `organizations` | A workspace: name, logo, address, currency, timezone, locale |
| `organization_members` | Membership and role, unique on `(organizationId, userId)` |

### Teaching

| Table | Purpose | Constraints |
|---|---|---|
| `students` | Roster | Soft states: `status`, `archivedAt`, `deletedAt` |
| `student_parents` | Parent/guardian contacts | `telegramChatId` set only after consent |
| `groups` | A class | Unique `(organizationId, name)`; `weekdays Int[]`, `startTime`/`endTime` as `HH:MM` |
| `group_members` | Enrolment | Unique `(groupId, studentId)`; `feeOverrideMinor` |
| `lessons` | A scheduled occurrence | Unique `(groupId, startsAt)` — makes generation idempotent |
| `attendance` | One mark per student per lesson | Unique `(lessonId, studentId)` |

### Money

| Table | Purpose | Notes |
|---|---|---|
| `invoices` | Expected amount for a period | Unique `(studentId, groupId, periodYear, periodMonth)` — makes charge generation idempotent |
| `payments` | Received money | **Immutable.** Status flips to `REVERSED`; the row is never edited or deleted |
| `payment_adjustments` | Corrections | Append-only; signed `deltaMinor`, mandatory `reason`, `createdByUserId` |
| `subscriptions` | Plan per workspace | Unique on `organizationId` |
| `billing_intents` | A pending purchase | `idempotencyKey` unique |
| `webhook_events` | Replay protection | Unique `(provider, externalId)` |

All amounts are `BigInt` minor units plus a `CHAR(3)` currency. Never a float.

### Integrations, notifications, files, audit

| Table | Purpose |
|---|---|
| `telegram_accounts` | Consented chat mapping, unique `(organizationId, telegramUserId)` |
| `telegram_link_tokens` | Single-use hashed tokens with an expiry |
| `outbound_messages` | Every message attempted, with `dedupeKey` unique |
| `notifications` / `notification_preferences` | In-app notices and per-type opt-outs |
| `files` | Metadata only; bytes live in storage. `storageKey` unique, `sha256` recorded |
| `audit_logs` | Who did what, `ipHash` only, scrubbed `meta` |

---

## Indexes

Added for the access patterns the product actually has:

| Index | Serves |
|---|---|
| `students (organizationId, status)` | The default roster view |
| `students (organizationId, lastName, firstName)` | Name sort |
| `lessons (organizationId, startsAt)` | Calendar ranges |
| `lessons (organizationId, groupId, startsAt)` | A group's history |
| `attendance (organizationId, studentId, status)` | Per-student statistics |
| `payments (organizationId, paidAt)` | Payment history |
| `payments (organizationId, studentId, paidAt)` | A student's payments |
| `invoices (organizationId, status, dueDate)` | Overdue filtering |
| `invoices (organizationId, periodYear, periodMonth)` | Monthly reports |
| `sessions (userId, revokedAt)`, `sessions (expiresAt)` | Session listing and cleanup |
| `audit_logs (organizationId, createdAt)`, `(actorUserId, createdAt)` | Incident review |

---

## Constraints that carry meaning

| Constraint | What it prevents |
|---|---|
| `lessons (groupId, startsAt)` unique | Double-booking a group; makes schedule generation re-runnable |
| `invoices (studentId, groupId, period…)` unique | Charging twice for one month |
| `attendance (lessonId, studentId)` unique | Two marks for one student in one lesson |
| `groups (organizationId, name)` unique | Two identically named groups in one workspace |
| `outbound_messages.dedupeKey` unique | The same reminder going out twice |
| `webhook_events (provider, externalId)` unique | A replayed payment event being processed twice |
| `billing_intents.idempotencyKey` unique | A duplicate purchase |
| Column length caps (`VarChar`) | Storage abuse through a free-text field |

---

## Soft deletion

Three different behaviours, chosen deliberately:

| Model | Behaviour | Why |
|---|---|---|
| Students | `status = ARCHIVED` + `archivedAt` | Attendance and payment history must stay meaningful |
| Lessons, groups | `deletedAt` | A cancelled lesson still has attendance attached |
| Payments | Never deleted | A financial record that can vanish is not a record |
| Sessions | `revokedAt` | Auditable logout |
| Files | `deletedAt` + the object is removed from storage | Metadata is useful; bytes are not |

Every list query filters on the relevant column. `tests/security/tenant-isolation.test.ts`
verifies that archived and soft-deleted rows stay isolated.

---

## Migrations

```bash
npm run db:migrate      # create + apply in development
npm run db:deploy       # apply only, for production
npm run db:reset        # drop, re-migrate, re-seed
```

Migrations are plain SQL under `prisma/migrations`, reviewable before they run.

---

## Seed data

`npm run db:seed` creates two independent workspaces:

- **Aziza English Studio** — 1 teacher, 3 groups, 10 students, ~36 lessons with
  attendance, two months of charges and a realistic spread of paid, partly paid
  and unpaid.
- **Bobur Math Center** — a second teacher with one student, so cross-tenant
  isolation can be checked by hand.

Both use the password `Ustozly2026!`.

---

## Running on Supabase

The schema works unchanged. Point `DATABASE_URL` at the pooled connection string
and run `npm run db:deploy`.

**Enable row-level security as a second layer.** The application already
enforces tenancy, but RLS means a mistake in application code is not sufficient
to leak data.

The application connects as one database role, so the current workspace must be
communicated per transaction:

```sql
-- Set once per request/transaction by the application:
--   SELECT set_config('app.current_org', $1, true);

ALTER TABLE students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE files             ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;

-- One policy shape for every tenant-owned table:
CREATE POLICY tenant_isolation ON students
  USING      ("organizationId" = current_setting('app.current_org', true)::uuid)
  WITH CHECK ("organizationId" = current_setting('app.current_org', true)::uuid);
-- ... repeat per table.
```

Notes:

- `current_setting(..., true)` returns NULL when unset, so a query that forgot
  to set the workspace returns **nothing** rather than everything.
- Migrations must run as a role with `BYPASSRLS`, or policies must be created
  after the tables.
- If you use Supabase Auth instead of the built-in sessions, replace
  `current_setting('app.current_org')` with a join against
  `organization_members` on `auth.uid()`.

---

## Backups

- Point-in-time recovery, or at minimum a nightly `pg_dump`.
- Test a restore before you need one.
- A dump contains every student's and parent's personal data: encrypt it at
  rest, restrict who can read it, and set a retention period.

---

## Housekeeping

Two functions are provided for a scheduled job:

- `purgeExpiredOtps()` — removes codes 24 hours after expiry.
- `purgeExpiredRateLimits()` — removes finished windows.

Neither is on a timer by default; wire them to whatever scheduler the deployment
has (a cron container, a platform scheduled function, or `pg_cron`).
