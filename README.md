# Ustozly

**Repetitorning darsi, davomati va to'lovlari — bir joyda.**

A digital work notebook for private tutors: students, groups, lessons,
attendance, payments and debt in one small, fast panel. Uzbek, Russian and
English throughout.

It is deliberately **not** an LMS, a CRM or a marketplace. There is no video
hosting, no course catalogue, no student social feed.

---

## What it does

| Area | What you get |
|---|---|
| **Students** | CRUD with archive-not-delete, search, filters, pagination, CSV import with preview and duplicate detection |
| **Groups** | Recurring weekly schedule, monthly fee, per-student fee override, colour coding |
| **Lessons** | Generated from the group schedule, or added one by one; day / week / month calendar |
| **Attendance** | Present · Absent · Late · Excused, one-tap "mark all present", per-student statistics |
| **Payments** | Expected / paid / remaining per student and per month; payments are immutable, corrections go to an adjustment ledger |
| **Debt** | "Who owes me money?" with overdue filtering, per-student and workspace totals |
| **Telegram** | Consent-based account linking, previewed payment reminders to parents, rate limited and audited |
| **Reports** | Monthly figures per group, CSV export, print-friendly layout |
| **Languages** | Uzbek / Russian / English, switchable at any time, no hardcoded UI text |

---

## Tech stack

- **Next.js 15** (App Router, React 19, server components)
- **TypeScript 5** in strict mode, with `noUncheckedIndexedAccess`
- **PostgreSQL 17** via **Prisma 7** (driver adapter, parameterized everywhere)
- **Tailwind CSS 4** with a small hand-built token system
- **Zod 4** for every request boundary
- **Argon2id** (`@node-rs/argon2`) for passwords and OTP codes
- **sharp** for image decode-and-re-encode on upload
- **Vitest** for unit, integration, HTTP and security tests

---

## Quick start

```bash
# 1. Database (Docker) - local development only; the container
#    credentials in this script are not used anywhere else
npm run db:up

# 2. Install and generate
npm install
npx prisma generate

# 3. Schema and development data
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev          # http://localhost:3000
```

### Seeded logins

Both accounts use the password **`Ustozly2026!`**

| Workspace | Email | Phone |
|---|---|---|
| Aziza English Studio | `ustoz@ustozly.uz` | `+998901112233` |
| Bobur Math Center | `boshqa@ustozly.uz` | `+998907776655` |

The second workspace exists so you can confirm by hand that one teacher can
never see another teacher's data.

Seeded data: 1 teacher, 3 groups, 10 students, ~36 lessons, attendance history,
two months of charges, and a realistic spread of paid / partly paid / unpaid.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:up` | Start the Postgres container |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Load development data |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Full test suite |
| `npm run test:security` | Security tests only |
| `npm run e2e` | Playwright end-to-end tests |

---

## Testing

```bash
npm test
```

The suite has four layers:

1. **Unit** — money arithmetic, phone normalization, CSV parsing and export,
   timezone conversion, translation completeness.
2. **Integration** — students, groups, lessons, attendance and the payment
   ledger, against a real Postgres database.
3. **Security (domain)** — cross-tenant access, OTP, injection payloads, file
   uploads, webhook signatures, reminder throttling, log redaction.
4. **HTTP** — boots the production build and drives it over real HTTP:
   authentication, CSRF, cookie flags, security headers, CORS, IDOR, role
   checks and a scan of the client bundle for leaked secrets.

Tests run against a separate `ustozly_test` database. `tests/setup.ts` refuses
to run if `DATABASE_URL` does not point at it.

```bash
docker exec ustozly-pg psql -U ustozly -d postgres -c "CREATE DATABASE ustozly_test;"
DATABASE_URL="postgresql://ustozly:ustozly_dev_pw@localhost:5433/ustozly_test?schema=public" npx prisma migrate deploy
```

---

## Configuration

Copy `.env.example` to `.env` and fill it in. Generate each secret with
`openssl rand -hex 32`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_URL` | yes | Canonical origin; used for CSRF and redirect checks |
| `SESSION_SECRET` | yes | Derives per-session CSRF tokens |
| `OTP_PEPPER` | yes | Server-side pepper mixed into OTP hashes |
| `FILE_URL_SECRET` | yes | HMAC key for signed file URLs |
| `IP_HASH_SECRET` | yes | HMAC key used to pseudonymize IPs in logs |
| `SMS_PROVIDER` | no | `console` (default) / `eskiz` / `playmobile` |
| `EMAIL_PROVIDER` | no | `console` (default) / `smtp` / `resend` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enables "Continue with Google" |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | no | Enables Telegram reminders |
| `PAYMENT_PROVIDER` | no | `manual` (default) / `payme` / `click` |

Anything left unset degrades cleanly: Google login is hidden, Telegram
reminders queue and report "not configured", and plan upgrades tell the user
online payment is not enabled rather than pretending to succeed.

In development `SMS_PROVIDER=console` prints verification codes to the server
console and the registration screen shows them, so you can complete a signup
without an SMS gateway. This never happens when `NODE_ENV=production`.

---

## Documentation

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layering, request lifecycle, module map |
| [SECURITY.md](SECURITY.md) | Security architecture and control-by-control detail |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Assets, actors, threats and mitigations |
| [DATABASE.md](DATABASE.md) | Schema, indexes, tenancy, Supabase RLS notes |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production setup, external credentials, data residency |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

---

## Licence

Not yet licensed. All rights reserved.
