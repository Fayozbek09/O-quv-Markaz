# Changelog

All notable changes to this project are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

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
- 227 tests across unit, integration, security and HTTP layers, plus 10
  Playwright end-to-end tests.

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
