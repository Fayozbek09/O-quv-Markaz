# Changelog

All notable changes to this project are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Scheduling conflict detection.** A lesson is refused when it overlaps an
  existing one for the same group, the same teacher or the same room. The check
  is a true interval overlap (`newStart < existingEnd && newEnd > existingStart`)
  rather than an equal-start comparison, so an 18:00-19:30 lesson and a
  19:00-20:30 lesson in room 204 now clash as they should. A cancelled lesson
  releases its slot, back-to-back lessons are allowed, and a lesson never
  conflicts with itself when edited. The error names which of the three clashed,
  in all three languages.
- **Announcements.** A centre posts a notice to everyone, to all staff, to
  teachers, to students, or to a single group; it can be pinned and given an
  expiry. The audience is resolved server-side both when the notice is posted
  (to decide who is notified) and when it is read (to decide whose list it
  appears in) — a reader never states which audience they belong to, and a
  group notice is checked against the centre that owns the group. Notices are
  withdrawn rather than deleted, every action is audited, and posting is gated
  on `notifications.send`, which a teacher does not hold. Shown on the student
  portal, on the teaching dashboard and on a staff page at `/announcements`.
- **Profile photos.** `POST /api/uploads/avatar` sets the signed-in account's
  own photo — every role, students included — or a student's photo when staff
  send a `studentId` and hold `students.update`. The student is resolved inside
  the caller's centre, so an id from another centre is a 404 rather than a
  cross-tenant write. A student's account profile and student record are pointed
  at the same file, the replaced photo is soft-deleted and its bytes removed,
  and the image goes through the same decode / strip / re-encode pipeline as the
  centre logo. Wired into profile settings, the student detail page and the
  student portal.
- **Homework attachments, end to end.** The domain already accepted `fileIds`
  and submissions already had a `fileId`, but nothing could create those files.
  `POST /api/uploads/attachment` now does: images are re-encoded, PDFs are
  accepted only when the declared type, the extension and the leading `%PDF-`
  bytes all agree, and Office formats and SVG are refused outright. A stored PDF
  is served as a download inside a sandbox, never rendered in the page. Teachers
  attach files when setting homework; students attach one when handing in, with
  an optional note.
- **Click payment adapter**, alongside the existing Payme one, proving the
  provider interface is genuinely modular. It verifies Click's MD5 callback
  signature in constant time, refuses a callback addressed to another shop, and
  handles the two-phase callback honestly: `action=0` (Prepare) is recorded as
  **pending** and buys nothing, only `action=1` (Complete) settles the term, and
  the two phases carry distinct event ids so replaying either is a no-op. The
  `WebhookVerification` contract gained a `pending` outcome for this, and the
  shared webhook route acknowledges it without touching the intent.
- A per-user upload rate bucket, and the lapsed-subscription write gate applied
  explicitly to both upload routes — they are hand-rolled rather than wrapped in
  `orgMutation`, so they would otherwise have skipped it.

- **Lesson change notifications.** Cancelling a lesson, or moving it to another
  time, writes an in-app notification to every active student in the group.
  Re-cancelling an already cancelled lesson does not notify twice, editing a
  lesson without moving it stays quiet, and a student who muted the type gets
  nothing.

### Fixed

- A lesson overlapping an existing one was accepted whenever the two did not
  start at the same instant. Found while extending the schedule, and covered by
  a regression test for each of the three resources that can clash.
- `announcementsForStudent` and `announcementsForMember` combined an expiry
  filter and an audience filter by spreading two objects that both carried an
  `OR` key, so the expiry clause was silently discarded and an expired notice
  stayed on the page. Both now compose through `AND`. Caught by a test written
  alongside the feature, before it shipped.
- The end-to-end logout test located the account menu with a name regex loose
  enough to match unrelated buttons, and failed intermittently as the interface
  grew. It now addresses the control by its ARIA relationship and waits for the
  menu.

## [0.1.0] — 2026-08-20

First working version. Everything below is implemented and covered by tests.

### Added

**Product**
- Students: create, edit, archive and restore, with search, status filtering,
  pagination and sorting.
- CSV import with a server-side preview, per-row validation, duplicate detection
  and a downloadable template.
- Groups with a recurring weekly schedule, a monthly fee and per-student fee
  overrides.
- Lesson generation from a group schedule, plus one-off lessons; day, week and
  month calendar views.
- Attendance marking (present, absent, late, excused) with a one-tap
  "mark all present" and per-student statistics.
- Payment recording with an immutable ledger; corrections are appended as
  adjustments rather than edits.
- Monthly charge generation, per-student and workspace balances, and a
  "who owes me money?" report with overdue filtering.
- Monthly reports per group with CSV export and a print stylesheet.
- Seven-step onboarding: name, subject, workspace, logo, first student, first
  group, monthly fee.
- Dashboard with today's figures, this month's figures and five quick actions.

**Languages**
- Full Uzbek, Russian and English interface with no hardcoded strings.
- Locale from an explicit cookie, then `Accept-Language`, then Uzbek — resolved
  server-side so the first paint is already correct.

**Authentication**
- Registration by phone or email with a 6-digit code, and Google OAuth 2.0 with
  PKCE.
- Argon2id password hashing; server-side sessions with rotation, revocation and
  a "log out other devices" control.
- Password reset, password change, data export and account deletion.

**Integrations**
- Telegram: consent-based account linking through single-use tokens, previewed
  payment and lesson reminders, per-student and per-workspace rate limits, and a
  full audit trail.
- `PaymentProvider` interface with a Payme adapter skeleton and a `manual`
  default that never reports success.
- `SmsSender` / `EmailSender` interfaces with console drivers for local use.

**Security**
- Tenant isolation enforced server-side on every read and write.
- CSP with a per-request nonce and `strict-dynamic`; full security header set.
- Per-session CSRF tokens plus same-origin checks on every mutation.
- Rate limiting on OTP, login, password reset, registration, uploads, messaging
  and billing.
- Upload pipeline that decodes, re-encodes and renames every image, and refuses
  SVG.
- Private file delivery behind both a signed URL and a workspace check.
- Audit log with recursive secret scrubbing and hashed IP addresses.

**Documentation**
- README, ARCHITECTURE, SECURITY, THREAT_MODEL, DATABASE, DEPLOYMENT.
- Privacy Policy and Terms of Service pages, in all three languages.

**Tests**
- 250 tests across unit, integration, security and HTTP layers, of which 171
  are security tests, plus 14 Playwright end-to-end tests in a real browser.

### Fixed during development

These were found by the test suite as it was written, and each has a regression
test:

- A malformed UUID in a path parameter reached the driver and produced a 500
  that echoed the query. `scope.byId` now rejects a non-UUID and returns 404.
- The application-wide CSP overwrote the stricter sandbox policy on
  `/api/files/*`. User content now gets `default-src 'none'; sandbox` from the
  middleware itself, so a route cannot be silently relaxed.
- A payment recorded without an explicit charge stayed unallocated, leaving a
  fully paid invoice `OPEN`. Payments now apply to the oldest open charge for
  that student and group.
- The skip link was labelled "Continue" instead of naming its destination.
- **A browser could not log in during development.** The session cookie uses the
  `__Host-` prefix, which requires the `Secure` attribute, but `Secure` was only
  set in production - so Chrome silently discarded the cookie and every login
  bounced straight back to the login page. The cookie is now always `Secure`
  (browsers treat `http://localhost` as a trustworthy origin). The HTTP suite
  had missed this because its cookie jar accepts anything; only a real browser
  enforces the prefix rules, so an end-to-end login test was added.
- **Uzbek dates rendered as `2026 M08 20, Thu`.** Chromium ships no `uz` locale
  data, so `Intl` fell back to a root pattern in the browser while Node's full
  ICU formatted correctly on the server. That broke the interface for the
  primary market and caused a hydration mismatch. Uzbek dates and month names
  are now composed from the dictionary; Russian and English still use `Intl`,
  where the data is present everywhere.
- The Next.js dev indicator covered the sidebar's Settings link.
- `GET /api/reports?format=csv` returned 422. The strict query schema did not
  know about `format`, so the export button produced a validation error instead
  of a file. Found by driving the running application rather than by a test.
- `npm audit` reported six high-severity issues from older `sharp`, `postcss`
  and `deepmerge-ts` copies nested inside framework packages. `overrides` now
  pin all three to patched versions; the audit is clean. The image pipeline
  already resolved the patched `sharp`, but the nested copy is now gone too.

### Known limitations

- No multi-factor authentication beyond the registration OTP.
- Tenant isolation is enforced in the application; Postgres row-level security
  is documented but not enabled by default.
- Rate limiting uses fixed windows, so a burst at a window boundary can briefly
  exceed the nominal rate.
- The `manual` payment provider cannot complete a purchase by design.

## O'quv Markaz — education-centre platform

The single-tutor workbook became a multi-tenant platform for education centres.
Everything that already worked was kept; this records what changed around it.

### Roles and authorization

- Added `RECEPTIONIST` and `STUDENT` roles alongside `OWNER`, `ADMIN` and
  `TEACHER`. The legacy `ASSISTANT` value is retained and reads as a
  receptionist.
- **Replaced rank-based authorization with an explicit permission matrix**
  (`src/lib/rbac.ts`). `orgRoute` / `orgMutation` now take a permission string
  instead of a minimum role, so a route that does not say what it needs fails to
  compile. The roles genuinely cross — a receptionist takes money but never
  grades, a teacher grades but never takes money — which a single rank could not
  express.
- Per-member permission overrides, filtered through a per-role `GRANTABLE`
  allow-list so an override can never mint an owner.
- Row-level scoping on top of permissions: a teacher's group, homework, grade
  and salary queries are filtered by their membership id in the query itself.

### Platform administration

- New `/admin` area with its own table (`platform_admins`), its own cookie, its
  own rate-limit buckets, a per-account lockout and a 16-character password
  floor. A centre session can never be read as an admin session.
- Centre lifecycle: create (with generated owner credentials), inspect, edit,
  suspend, reactivate and soft-delete. Suspension revokes live sessions; nothing
  is destroyed.
- Explicit, audited "view as centre" override with a mandatory reason, a
  persistent red banner and `actorAdminId` / `isOverride` on every resulting
  audit row.
- Platform dashboard, audit browser and runtime pricing configuration.
- `npm run admin:create` creates or rotates the administrator, printing the
  credentials once and storing only the Argon2id hash.

### Accounts and login

- Added globally unique usernames. One login page resolves username, e-mail or
  phone, decides the role server-side and returns the landing route; there is no
  `?role=` and no client-side switching.
- Centres provision teachers, receptionists and student portal accounts with
  generated usernames and cryptographically random temporary passwords, shown
  exactly once. Collisions are resolved with readable suffixes and the creator is
  told which handle was actually issued.
- Forced password change at first sign-in, and temporary credentials expire after
  14 days if unused.

### New domains

- **Courses** with a built-in catalogue and per-centre additions.
- **Homework** with per-group assignments, deadlines, attachments, per-student
  submission rows and scoring.
- **Grades** with 0–100, 5-point and letter schemes stored per mark.
- **Payroll** with fixed, per-lesson, percentage and mixed salary models,
  computed server-side and paid out as immutable rows.
- **Expenses** and a finance page with monthly revenue, costs, net and CSV
  export.
- **Student portal** at `/student`, scoped entirely from the session's own user
  id — there is no student id parameter anywhere in it.

### Subscription

- 30-day free trial with **no student, teacher or group limits**, then a flat
  monthly price for the whole centre (300 000 UZS by default).
- Price, trial length and grace period live in `platform_settings` and are
  edited at `/admin/pricing`; nothing hardcodes the number. Existing centres keep
  the price snapshotted on their own subscription row.
- Status ladder `TRIAL → PAYMENT_DUE → GRACE_PERIOD → SUSPENDED`, evaluated on
  read as well as by a nightly job, so a missed cron never leaves a stale state.
- **A lapsed subscription deletes nothing.** Writes are held; billing, settings
  and export stay available.
- Payments are applied only from a signature-verified webhook or an audited
  platform-admin offline entry. `subscription_payments` is unique on
  `(provider, providerTransactionId)`, so a replayed event cannot buy a second
  month.
- Removed the old 10-student free-plan ceiling entirely.

### Removed

- `src/app/(app)/settings/billing` — replaced by `/billing`, which reflects the
  new model. `/dashboard` now forwards to the role's landing area.
