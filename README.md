# O'quv Markaz

**Multi-tenant management platform for education centres in Uzbekistan.**

Students, teachers, receptionists, groups, courses, schedules, attendance,
homework, grades, payments, payroll and reporting — one centre, one login page,
five strictly separated roles. Uzbek, Russian and English throughout, UZS and
Asia/Tashkent by default.

It is deliberately **not** an LMS, a marketplace or a video platform. There is
no course catalogue for the public, no student social feed and no content
hosting.

---

## Roles

| Role | Lands on | Can do |
|---|---|---|
| **Platform admin** | `/admin` | Create, inspect, suspend, reactivate and close centres; pricing; audit log; a logged "view as centre" override |
| **Centre owner** | `/center` | Everything inside their own centre, including money, payroll and settings |
| **Centre admin** | `/center` | Everything except deleting the centre and touching billing |
| **Receptionist** | `/reception` | Students, groups, enrolment, payments, schedules — no grades, no salaries, no settings |
| **Teacher** | `/teacher` | Their own groups: lessons, attendance, homework, grades, and their own salary |
| **Student** | `/student` | Their own lessons, attendance, grades, homework and balance — nobody else's |

Authorization is an explicit permission matrix (`src/lib/rbac.ts`), not a rank
comparison: a receptionist may create students but not write grades, and a
teacher may write grades but not take payments. Neither is a superset of the
other.

---

## What it does

| Area | What you get |
|---|---|
| **Centres** | Self-service registration with courses, working hours and contact profile; multi-tenant from the ground up |
| **Staff** | Teachers and receptionists created by the centre, with generated usernames and generated temporary passwords, forced change at first sign-in |
| **Students** | CRUD with archive-not-delete, search, filters, CSV import, per-student portal accounts |
| **Courses & groups** | Course catalogue, recurring weekly schedule, capacity, room, monthly fee, per-student fee override |
| **Lessons** | Generated from the group schedule or added individually; day / week / month calendar; cancellation visible to students |
| **Attendance** | Present · Absent · Late · Excused, one-tap marking, per-student statistics |
| **Homework** | Assignments per group with deadlines and attachments, submission tracking, scoring |
| **Grades** | 0–100, 5-point or letter schemes, stored per mark so a centre can change scheme without a migration |
| **Payments** | Expected / paid / remaining per student and per month; payments are immutable, corrections go to an adjustment ledger |
| **Payroll** | Fixed, per-lesson, percentage or mixed salary models, computed server-side, paid out as immutable rows |
| **Finance** | Monthly and yearly revenue, salaries, expenses and net, with charts and CSV export |
| **Subscription** | 30 days free with no limits, then a flat monthly price for the whole centre |
| **Telegram** | Consent-based account linking, previewed reminders to parents, rate limited and audited |
| **Languages** | Uzbek / Russian / English, switchable at any time, no hardcoded UI text |

---

## Pricing model

- **First 30 days: free.** No student limit, no teacher limit, no group limit.
- **After that: a flat monthly price for the entire centre** — 300 000 UZS by
  default. 50 students and 1000 students cost exactly the same.
- The price, the trial length and the grace period live in the
  `platform_settings` table and are editable at `/admin/pricing`. Nothing in the
  application hardcodes the number.
- A lapsed subscription moves through `PAYMENT_DUE` → `GRACE_PERIOD` →
  `SUSPENDED`. **Nothing is ever deleted.** A suspended centre keeps every
  student, payment, grade and file, can still export all of it, and returns to
  full function the moment a payment is verified.

---

## Tech stack

- **Next.js 15** (App Router, React 19, server components)
- **TypeScript 5** in strict mode, with `noUncheckedIndexedAccess`
- **PostgreSQL 17** via **Prisma 7** (driver adapter, parameterized everywhere)
- **Tailwind CSS 4** with a small hand-built token system
- **Zod 4** for every request boundary
- **Argon2id** (`@node-rs/argon2`) for passwords and OTP codes
- **sharp** for image decode-and-re-encode on upload
- **Vitest** for unit, integration, HTTP and security tests; **Playwright** for E2E

---

## Quick start

```bash
# 1. Database (Docker) — local development only; the container
#    credentials in this script are not used anywhere else
npm run db:up

# 2. Install and generate
npm install
npm run db:generate

# 3. Schema and development data
npm run db:deploy
npm run db:seed        # prints the platform-admin password ONCE

# 4. Run
npm run dev            # http://localhost:3000
```

`npm run db:seed` prints a block like this, once:

```
============================================================
  PLATFORM ADMINISTRATOR (created)
  Iskandarov Fayozbek
------------------------------------------------------------
  URL:       /admin/login
  username:  f.iskandarov.xxxxx
  password:  <24 random characters>
------------------------------------------------------------
```

Copy it then. Only the Argon2id hash is stored, and there is no endpoint that
returns the password again. To issue a new one:

```bash
npm run admin:create                       # generate a new password
ADMIN_PASSWORD='…' npm run admin:create    # set a known one (staging, CI)
```

Rotating also revokes every live admin session. The same is available in the UI
at `/admin` → change password.

### Seeded centre logins

All seeded **centre** accounts share one development password, printed by the
seed: `Demo-Markaz-2026!`

| Role | Username | Centre |
|---|---|---|
| Owner | `owner.karimova` | Bilim Ziyo o'quv markazi |
| Receptionist | `reception.tosheva` | Bilim Ziyo |
| Teacher (percentage salary) | `teacher.saidova` | Bilim Ziyo |
| Teacher (fixed salary) | `teacher.rustamov` | Bilim Ziyo |
| Students | `student.valiyev`, `student.karimova`, `student.rahimov` | Bilim Ziyo |
| Owner of a second centre | `owner.aliyev` | Zamon Math Center |

The second centre exists so tenant isolation can be checked by hand: sign in as
`owner.aliyev` and try to reach any id from the first centre.

Everyone signs in at **one** page, `/login`. The role is resolved server-side
from the membership row; the landing route is decided there and returned. There
is no `?role=` and no client-side role switching.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` / `start` | Production build and server |
| `npm run lint` / `typecheck` | ESLint and `tsc --noEmit` |
| `npm test` | Full Vitest suite (unit, integration, HTTP, security) |
| `npm run test:security` | Only `tests/security` |
| `npm run e2e` | Playwright end-to-end tests |
| `npm run db:up` | Start the local Postgres container |
| `npm run db:deploy` / `db:migrate` | Apply / create migrations |
| `npm run db:seed` / `db:reset` | Development data |
| `npm run db:studio` | Prisma Studio |
| `npm run admin:create` | Create or rotate the platform administrator |
| `npm run subscriptions:remind` | Daily job: roll subscription states, send 7/3/1/0-day reminders |

---

## Testing

```bash
npm test                 # everything
npm run test:security    # tenant isolation, RBAC, uploads, injection, OTP, logging
npm run e2e              # Playwright
```

The HTTP suite boots a real `next start` process on port 3111 against the test
database, so it exercises the middleware, cookie flags, CSRF handling and error
shapes exactly as a browser sees them.

Test areas:

- **unit** — money, dates, i18n, CSV, phones, RBAC matrix, subscription state machine, credential generation
- **integration** — students, groups, lessons, attendance, payments, staff provisioning, subscription lifecycle
- **security** — cross-tenant access (IDOR/BOLA), RBAC enforcement, student-portal self-scoping, uploads, injection probes, OTP, webhooks, log redaction
- **http** — auth flows, admin/centre boundary, security headers, file serving, reports

---

## Configuration

Copy `.env.example` to `.env`. Every variable is validated at boot by
`src/lib/env.ts`; the process refuses to start if one is missing or malformed,
and only the offending key names are printed, never the values.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `APP_URL` | yes | Public origin; used for CSRF origin checks and OAuth redirects |
| `SESSION_SECRET` | yes | ≥32 chars, derives CSRF tokens |
| `OTP_PEPPER` | yes | ≥32 chars, peppers OTP hashes |
| `FILE_URL_SECRET` | yes | ≥32 chars, signs file URLs |
| `IP_HASH_SECRET` | yes | ≥32 chars, hashes IPs for the audit log |
| `STORAGE_DRIVER` | no | `local` (default) or `s3` |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | no | `console` in development |
| `GOOGLE_CLIENT_ID` / `SECRET` | no | Google sign-in is hidden when unset |
| `TELEGRAM_BOT_TOKEN` / `WEBHOOK_SECRET` | no | Telegram features are hidden when unset |
| `PAYMENT_PROVIDER` | no | `manual` (default), `payme` or `click` |
| `PAYME_*` / `CLICK_*` | no | Required only for the matching provider |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_FULL_NAME` | no | Only read by `npm run admin:create` |

### What still needs real credentials

The integration interfaces are complete and tested against a local mock; these
need real accounts before they do anything in production:

- **Payme / Click** — `PAYME_MERCHANT_ID`, `PAYME_SECRET_KEY` (or the Click
  equivalents). Without them `PAYMENT_PROVIDER=manual` is used, which never
  reports a successful payment: a platform admin settles a centre by recording
  an offline payment at `/admin/centers/<id>`, which is audited with the
  operator's reference.
- **SMS (Eskiz / Play Mobile)** — `SMS_PROVIDER` plus that provider's
  credentials, and a pre-approved template. In development codes are printed to
  the server console.
- **Email (SMTP / Resend)** — same shape.
- **Telegram** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Reminder
  UI is hidden entirely when unset.
- **Google sign-in** — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

---

## Documentation

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, request lifecycle, where state lives |
| [DATABASE.md](DATABASE.md) | Schema, tenancy, indexes, constraints, migrations, RLS notes |
| [SECURITY.md](SECURITY.md) | Authentication, authorization, isolation, uploads, secrets, OWASP review |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Assets, actors, trust boundaries, STRIDE walk-through |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Secrets, database, build, external services, checklists |
| [CHANGELOG.md](CHANGELOG.md) | Notable changes |

---

## Licence

Proprietary. All rights reserved.
