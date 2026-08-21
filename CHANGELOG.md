# Changelog

All notable changes to this project are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The Payme Merchant API, in full.** Payme is not a notify-once gateway: it
  drives a JSON-RPC state machine and expects the merchant to hold the state and
  to answer a repeated call identically. What existed was the security half —
  constant-time credential check, amount reconciliation — answering
  `{ ok: true }` to every method, which Payme reads as no answer at all and
  retries forever. `lib/payments/payme-merchant.ts` now implements
  `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`,
  `CancelTransaction`, `CheckTransaction` and `GetStatement` against a new
  `payme_transactions` table, including the 12-hour timeout (cancel with reason
  4 rather than settle an abandoned charge), idempotent retries, and refusing a
  second transaction against an order already being paid. Every reply is HTTP
  200, errors included, because a non-200 is read as a transport fault. 29 tests
  play the gateway.
- **Reply envelopes each gateway can actually read.** A correct decision
  returned in a shape the gateway does not recognise is not an acknowledgement:
  Click looks for `error`, and on Prepare it keeps `merchant_prepare_id` to send
  back on Complete, where it forms part of the next signature. Answering
  `{ ok: true }` left the payment unconfirmed on Click's side while the ledger
  here said it settled. Each adapter now renders its own reply.
- **A production preflight.** The process refuses to start if a secret still
  reads like the one in `.env.example`, if two secrets share a value, if
  `APP_URL` is not https, if the SMS or e-mail provider is `console`, or if a
  named payment or challenge provider has no credentials. It prints the
  offending keys and the reason, never a value. Four deliberate choices —
  `manual` payments, no challenge, local storage, no Telegram — are warnings
  logged at boot instead, so nobody discovers them from a customer. It runs from
  `instrumentation.ts` at server start rather than at module scope, and is
  skipped during `next build`: compiling is not serving, and a build machine
  legitimately has no production secrets.
- **Two-step verification for the platform administrator.** TOTP (RFC 6238),
  written out rather than pulled in — the algorithm is thirty lines and this is
  the account that reaches every centre's data. A session that has passed the
  password but not the code reaches the challenge screen and nothing else,
  enforced in `requireAdmin()` so the API is closed to it too and not merely
  redirected. A used step is burned, so a code seen over a shoulder cannot be
  replayed inside its own window. Eight single-use recovery codes, stored as
  Argon2id hashes. Turning it off costs the password *and* a live code.
- **A human-verification challenge** on registration and password reset, the two
  endpoints that send an SMS and therefore cost money to abuse. Turnstile,
  hCaptcha or reCAPTCHA, verified server-side; a provider that is slow, broken
  or unreachable produces a **refusal**, never an approval. Ships as `none`,
  which the preflight warns about. The CSP is widened only for the provider
  actually configured.
- **`scripts/db-harden.sql`** — creates the role the application connects as with
  `SELECT/INSERT/UPDATE/DELETE` and nothing else: no `CREATE`, no `TRUNCATE`, no
  ownership, plus a 30-second statement timeout, an idle-in-transaction timeout
  and a connection cap. The application never issues DDL, so it loses nothing;
  an injection can no longer drop a table. Idempotent, and verified against a
  real database — including that `has_table_privilege(..., 'TRUNCATE')` is false.
- **`scripts/db-backup.sh`** — takes the dump *and restores it into a scratch
  database to count the rows*, because a backup nobody has restored is a hope
  rather than a backup. Fails loudly on a suspiciously small dump and prunes by
  age.
- Indexes for the teacher-scoped queries, and a deploy checklist reorganised
  into what the process enforces at boot, what it warns about, and what a person
  still has to check.

- **The product is now O'QUV MARKAZ.** The rename went past the title bar: the
  logo mark, the favicon, page metadata, the marketing and auth headers, the
  privacy policy and terms (which still described a record-keeping tool for
  private tutors rather than a platform for education centres), the FAQ, the
  Telegram bot's replies, the CSV template and report filenames, the data-export
  filename, the locale and OAuth cookie names, the deployment examples and the
  documentation. `tests/unit/branding.test.ts` walks the repository and fails on
  any reappearance, with a short allowlist for the local Postgres container and
  databases — renaming those would mean recreating them for no user-visible
  gain, and two are load-bearing safety checks.
- **A real footer.** The contact details used to be three items in a single row
  of small print, between a copyright notice and two legal links, where they
  read as decoration. They now have a column of their own in a four-column
  layout (identity · Platform · Help · Contact) that stacks on a phone, with a
  legal bar beneath. Phone and e-mail are `tel:` and `mailto:` links, so a tap
  dials; the landing page gained `#features`, `#pricing` and `#faq` anchors for
  the Platform and Help columns to point at. A Telegram row appears only when
  `NEXT_PUBLIC_CONTACT_TELEGRAM` is set — this deployment has no support channel
  and the footer says nothing rather than linking to one that does not exist.
- **Responsive coverage as a test, not a claim.** Every role's own area and
  every public page, at 1920, 1280, 1024, 768, 390 and 360 px, asserting the
  document never grows wider than the viewport. It found two real faults on the
  first run (below).
- **An empty browser console, asserted.** Every screen each of the four roles
  reaches is loaded with the console and the network watched; an error, a
  warning or a failed request fails the test.
- Indexes on `groups(organizationId, teacherId)` and
  `lessons(organizationId, teacherId, startsAt)`. Teacher scoping made both
  columns hot on every list a teacher opens, and neither was indexed. Measured
  on a 1200-student centre: a teacher's student list 12 ms, their timetable
  3 ms, the owner dashboard 34 ms, a twelve-month finance report 68 ms.

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
- **Contact details** on the marketing footer and at the foot of the privacy
  and terms pages, from one overridable source (`src/lib/contact.ts`) rather
  than pasted around the interface.
- **SMS delivery, implemented.** `senders.ts` said Eskiz was "left
  unimplemented on purpose", which meant phone registration could not complete
  anywhere but a developer's console. Both Uzbek gateways now work: **Eskiz.uz**
  (token-based, cached, re-authenticating once on a 401 so a wrong password
  fails fast instead of looping) and **Play Mobile** (HTTP Basic per request).
  Phone numbers are normalised to `998XXXXXXXXX` from whatever shape they are
  stored in, and a gateway with no credentials throws rather than resolving — a
  sender that silently swallowed a message would leave someone waiting for a
  code that was never sent. The message body carries a one-time code and is
  never written to a log, on success or on failure; a test asserts it.
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

#### Row-level scoping for teachers

`students.read`, `groups.read` and `lessons.read` are permissions a teacher
genuinely needs — they cannot take a register without them — so the permission
could never be the boundary. The queries were scoped by organization only, and
a teacher holding them could:

- list every student in the centre and open any profile, with the parent's
  phone number, the outstanding debt and the full payment history;
- read any group's roster, including students' phone numbers;
- see the whole centre's timetable rather than their own;
- **mark a register for a class they do not teach, and cancel another teacher's
  lesson** — both write paths, not merely reads.

`teacherScope()` existed in `lib/tenant.ts` for exactly this and was called from
nowhere; the CHANGELOG entry claiming groups were "filtered by their membership
id in the query itself" was true of homework, grades and payroll but not of
students, groups, lessons or attendance. It is now applied in `listStudents`,
`getStudent`, `listGroups`, `getGroup`, `listLessons`, `getLesson`,
`updateLesson`, `setLessonStatus`, `deleteLesson`, `markAttendance` and
`attendanceSummary`, with a new `studentTeacherScope()` for students, which hang
off a teacher through their group membership rather than a `teacherId` column.
A row outside a teacher's classes answers 404, the same reply another centre's
id gets, so the response never confirms the row exists.

#### Pages that scoped nothing

Several pages ran their own inline Prisma query for a dropdown or a picker and
filtered by organization alone, so the fix above did not reach them. None of it
was clickable and all of it was readable:

- the calendar's group filter named every class in the centre;
- the attendance picker listed every lesson that day;
- a group page shipped the centre's entire student roll to populate an "add
  student" control a teacher is not permitted to use — that query is now gated
  on `groups.members`.

#### Other access-control fixes

- **`/reception` served the centre's money to teachers.** The page named
  `students.read`, which matched its sidebar link and satisfied the existing
  page-guard test — but its loader reads the day's takings and every debtor with
  what they owe. The gate is now `payments.read`. The guard test was checking
  that *a* permission was named; it now checks the named permission is one a
  teacher does not hold.
- **`/api/account/export` handed any member the whole tenant.** Billed as
  "export my data" and reachable by every signed-in account, it returned every
  student (with parents), group, lesson, attendance row, payment and invoice for
  any organization the caller belonged to — so a student portal login downloaded
  the centre. The export is now scoped: a member holding `reports.export` takes
  the centre, everyone else takes their own rows.
- **A forced password change was a redirect, not a control.** The layouts sent a
  temporary-credential account to `/change-password`, but a redirect only
  governs a browser that follows it; the same session could work the entire API
  with the issued password indefinitely. `requireOrg()` and `requireStudent()`
  now refuse until the person picks their own password.
- **Closing an account destroyed the centre's books.** Deleting an account
  cascaded the organization row away with every student, payment, invoice, grade
  and attendance record under it, and deleting the membership rows cascaded into
  `salary_payments` — so a teacher leaving a *shared* centre erased their payroll
  history from that centre's accounts. A centre is now closed the way a platform
  administrator closes one, with `deletedAt`; memberships are marked as left;
  identifiers are released and the profile scrubbed. Someone who is the last
  owner of a centre that still has other members is refused rather than leaving
  it with nobody able to run it.
- **Password reset could not recover the account it exists for.** It set the new
  hash but left `mustChangePassword` and `credentialsExpireAt` untouched, so
  anyone whose issued password lapsed before first use reset it and was still
  turned away at login. Both now clear, as they already did in
  `/api/auth/change-password`.
- **A member of staff opening `/student` got a 500.** The portal layout let
  `requireStudent`'s 403 escape to the client error boundary, which cannot tell
  a refusal from a crash: the reader saw "Something went wrong" and a Try again
  button that could never work. It routes through `loadPage` to `/forbidden`.
- The platform dashboard's monthly figure took its month boundary in UTC while
  the rest of the platform bills in Tashkent time, dropping payments made
  between midnight and 05:00 local on the first of the month. It now uses
  `monthBounds` like everything else, and reports collected-this-year alongside.
- The `/admin` impersonation banner printed a literal em dash where the centre's
  name belongs, warning that an override was running without saying over whom.
- `npm run admin:create` left `mustChangePassword` untouched, so a generated
  password stayed valid indefinitely. A generated one is now temporary; a
  password set deliberately through `ADMIN_PASSWORD` is not.
- A signature test flipped the last character of an HMAC to a fixed `'0'`, so
  one run in sixteen tested a *valid* signature and passed for the wrong reason.
- **A forged-session test had never tested a forged session.** It sent a cookie
  named `__Host-ustozly_session`; the application reads `__Host-omarkaz_session`.
  The request therefore carried no session at all, and the 401 it asserted meant
  "anonymous", not "rejected". The name now comes from the source, and a second
  test tampers with a *real* token.
- **The end-to-end harness could test the previous build.** `prepare-e2e.ts`
  existed to build before `next start` — its own comment explains why the build
  cannot wait for `globalSetup` — and nothing ever called it. A CSS change was
  duly tested against the stale build and passed. It is now part of the
  webServer command.
- **Cards would not shrink on a phone.** A grid item is `min-width: auto` by
  default, so a card holding one long unbreakable row widened its column past
  the viewport and the whole page scrolled sideways, with the `truncate` inside
  it never getting a chance to act. The teacher and student dashboards — the two
  the product most expects to be used on a phone — both did this. `.card` now
  sets `min-width: 0`.
- The header's call to action fell off a 360px screen once the wordmark grew
  from `Ustozly` to `O'QUV MARKAZ`. The wordmark now gives way to the mark alone
  below 380px.
- Six dead landing-page keys survived the move to flat pricing, one of them
  reading "Up to 10 active students" — a ceiling this product removed.
- **A forged-session test had never tested a forged session** — and neither had
  the payment webhook tests tested a reply any gateway would accept. Both were
  green.
- **The test harness could leave a suite depending on the one before it.**
  `truncateAll()` did not clear `platform_admins`, which has no foreign key to
  an organization and so was never reached by CASCADE: a suite that created an
  administrator left it for the next, which then collided on the unique
  username. The HTTP harness also now runs `prisma migrate deploy` before
  anything reads the database — adding a migration and forgetting that step
  surfaced as `column … does not exist` halfway through an unrelated suite.
- **Refusals were logged as faults.** A page segment renders alongside its
  layout, so every anonymous or refused request logged
  `⨯ Error [AppError]: forbidden` with a stack even though the layout's redirect
  was what the reader actually got — ordinary access-control events filling the
  server log, where a genuine fault then has somewhere to hide. Pages now take
  their context through `requireOrgPage()` / `requireAdminPage()` in
  `lib/page.ts`, which redirect on their own account instead of relying on a
  layout. The browser suite's server log went from 27 such lines to none, and a
  page no longer depends on its parent for the refusal.

- A lesson overlapping an existing one was accepted whenever the two did not
  start at the same instant. Found while extending the schedule, and covered by
  a regression test for each of the three resources that can clash.
- `announcementsForStudent` and `announcementsForMember` combined an expiry
  filter and an audience filter by spreading two objects that both carried an
  `OR` key, so the expiry clause was silently discarded and an expired notice
  stayed on the page. Both now compose through `AND`. Caught by a test written
  alongside the feature, before it shipped.
- **A teacher could read the whole centre's payment ledger and revenue
  reports.** `/payments` and `/reports` called `requireOrg()` and rendered,
  naming no permission at all, so any signed-in member of staff reached them —
  a teacher holds neither `payments.read` nor `reports.read`. Eight pages were
  ungated this way; each now declares the permission its own sidebar link
  already claimed. A source-level test (`tests/security/page-guards.test.ts`)
  now asserts every staff page names a gate, that the gate is a real
  permission, and that it matches the link that leads to it — so a page added
  without one fails the suite rather than waiting to be noticed. That test
  immediately found a ninth inconsistency: the `/reception` link asked for
  nothing while its page asked for `students.read`.
- **A receptionist could read the centre's payroll and profit.** `/center` and
  `/finance` both put salaries paid, expenses and the net result on the page,
  and both were gated on `reports.read` — which a receptionist holds, because
  they need it to chase a payment. The navigation hid the links, but hiding a
  link is not a control: typing either URL worked. The two pages now require a
  new `finance.read`, held by an owner and a centre admin and grantable to a
  receptionist only if the owner decides to. Chasing payments is untouched.
  Found by walking the roles through the running application rather than by a
  test — the browser test that should have caught it only checked that one
  particular phrase was absent, and has been rewritten to assert the refusal
  itself.
- **A refused page said "Something went wrong" and offered a Try again button
  that could never work.** `assertPermission` throws, which is right for an API
  route that owes a 403, but in a server component it escaped to the client
  error boundary — which cannot tell a refusal from a crash, because Next strips
  the detail in production. Pages now use `requirePagePermission`, which
  redirects to `/forbidden`; that page already existed and nothing had ever sent
  anyone to it.
- **Both payment adapters were out by a factor of 100.** The ledger counts
  minor units, and for UZS that unit is the so'm itself (`minorUnits: 0`) — but
  the gateways do not agree: Payme quotes tiyin, Click quotes so'm. Payme was
  sending `a=300000` for a 300 000 so'm term (a 3 000 so'm charge) and reading
  the tiyin figure straight back, and the new Click adapter divided by 100 on
  the way out and multiplied on the way in. Either way the webhook's amount
  check compared 30 000 000 against 300 000 and refused, so **no subscription
  could ever have settled**. Both now convert through shared helpers in
  `money.ts`, and a round-trip test pins the real figures for each gateway.
- The registration page still advertised "Free for up to 10 students", left over
  from the single-tutor pricing that was otherwise removed. It now reads "first
  month free, then {price}/month for the whole centre", with the price read from
  platform settings rather than written into the interface.
- The end-to-end suite failed intermittently, always on whichever test happened
  to run late. The cause was the login throttle doing its job: eight attempts per
  identifier per quarter of an hour, against a suite that signs the same seeded
  owner in far more often than that, so correct credentials started being
  refused part-way through a run. The browser suite now clears the counter before
  each sign-in (`e2e/support/limits.ts`); the limiter itself is unchanged and is
  still tested where the counting is the point, in the security and HTTP suites.
  A first attempt at this misread the symptom as a loose selector on the account
  menu — that selector was worth tightening on its own merits, and now addresses
  the control by its ARIA relationship, but it was not the fault.

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
