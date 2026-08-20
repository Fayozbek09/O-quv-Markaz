# Security

This document describes the controls that are actually implemented, where they
live in the code, and which test proves each one. It does not claim the
application is free of vulnerabilities — only that these specific properties are
built in and verified.

**Reporting a vulnerability:** email the maintainer. Please do not open a public
issue.

---

## 1. Security architecture

Defence is arranged so that no single mistake is sufficient:

| Layer | Control |
|---|---|
| Network | HSTS, HTTPS-only cookies in production |
| Edge (`middleware.ts`) | CSP with a per-request nonce, `frame-ancestors 'none'`, same-origin gate on every mutation |
| Transport (`lib/api.ts`) | Session check, CSRF token, 256 KB body ceiling, uniform error shape |
| Tenancy (`lib/tenant.ts`) | Workspace scope and role check on every call |
| Validation (`lib/validation`) | Strict allow-list schemas; unknown keys rejected |
| Domain (`lib/domain`) | Ownership re-verified for every related id |
| Data | Parameterized queries, foreign keys, unique and check constraints |
| Observability | Audit log with secret scrubbing and hashed IPs |

---

## 2. Authentication

### Registration and login

Three routes in, all converging on the same session:

| Method | Verification |
|---|---|
| Phone | 6-digit SMS code |
| Email | 6-digit email code |
| Google | OAuth 2.0 + PKCE; the provider's `email_verified` claim is required |

### Passwords

- **Argon2id**, m=19 MiB, t=2, p=1 — the OWASP Password Storage baseline.
- Plaintext is never stored, never logged, never returned.
- Minimum 10 characters, must contain a letter and a digit. The browser shows a
  strength meter; the server is what enforces the rule.
- A failed login against a non-existent account still runs a dummy Argon2
  verification, so timing does not reveal whether an account exists
  (`fakeVerify` in `lib/auth/password.ts`).

### One-time codes

| Property | Value |
|---|---|
| Length | 6 digits, generated with rejection sampling (no modulo bias) |
| Lifetime | 5 minutes |
| Storage | Argon2id hash of `pepper : identifier : code` — never plaintext |
| Attempts | 5, then the code is locked even if guessed correctly afterwards |
| Reuse | Consumed inside a guarded `updateMany`, so a replay or a concurrent double-submit cannot both succeed |
| Scope | Bound to both the identifier and the purpose |
| Issuance | Requesting a new code consumes the previous one |
| Rate limit | 3 per identifier / 15 min, 10 per IP / 15 min |

In development the code is also returned to the caller so signup works without
an SMS gateway. This is gated on `NODE_ENV !== 'production'`.

### Sessions

- Opaque 256-bit token; only its SHA-256 is stored.
- Cookie: `__Host-ustozly_session`, `HttpOnly`, `Secure` (production),
  `SameSite=Lax`, `Path=/`, no `Domain`.
- Sliding 7-day idle window inside a hard 30-day ceiling.
- A new session row on every login — session fixation has nothing to fix.
- Logout revokes the row server-side; replaying the old cookie fails.
- A password change or reset revokes every other session.
- `revokeAllSessions` is exposed in the UI as "log out all other devices".

---

## 3. Authorization

Three questions are answered on every request, always on the server:

1. **Who is this?** — a centre session (`__Host-omarkaz_session`) or a platform
   admin session (`__Host-omarkaz_admin`). They are different cookies, different
   tables and different resolvers; neither can be read as the other.
2. **Which centre?** — `ctx.orgId` comes from the session row, never from the
   URL, the body or a header.
3. **What may this member do?** — an explicit permission set, not a rank.

### The permission matrix

Rank comparison was removed because the roles do not order on a single axis: a
receptionist may create students but not write grades, and a teacher may write
grades but not take payments. `src/lib/rbac.ts` holds a flat catalogue of
permission strings and a map from role to the set it holds. Every route names
the permission it needs:

```ts
export const POST = orgMutation(async (ctx, request) => { … }, 'payments.create');
```

| Role | Holds |
|---|---|
| `OWNER` | Everything except the three `platform.*` capabilities |
| `ADMIN` | Owner minus `center.delete` and `center.billing` |
| `RECEPTIONIST` | Students, groups, enrolment, payments, invoices, schedules, read-only teachers and reports |
| `TEACHER` | Their own groups: lessons, attendance, homework, grades, plus `salary.read` scoped to themselves |
| `STUDENT` | Nothing. The portal reads through `lib/domain/portal.ts` instead |

`platform.centers`, `platform.impersonate` and `platform.audit` are held by no
centre role, and a test asserts that for every role.

### Per-member overrides

An owner may widen a member slightly — for example letting a receptionist mark
attendance. Overrides are filtered through `GRANTABLE`, a per-role allow-list,
so writing `{"center.delete": true}` onto a receptionship is ignored even if it
reaches the database column. Revocations are always honoured, because they can
only narrow an account.

### Row-level scoping on top of permissions

A permission is necessary but not sufficient. A teacher holds `grades.write`,
but `createGrade` still checks that the group is one they teach; `listHomework`
adds `group: { teacherId: ctx.memberId }` to the query rather than filtering in
the UI. The same is true of `salary.read`: the salaries endpoint returns one
line — their own — when the caller is a teacher.

**Missing rows return 404, not 403.** A 403 would confirm that an id exists,
which is itself a disclosure.

### The platform administrator

`/admin` is a separate authentication system:

- its own table (`platform_admins`), so no column on `users` can be flipped to
  gain it;
- its own cookie, `SameSite=Strict`, 2-hour idle / 8-hour absolute lifetime;
- its own rate-limit buckets plus a per-account lockout after 8 failures;
- a 16-character password floor and a rotation flow that revokes every session.

A signed-in centre user hitting an admin route gets 403 and an
`admin.access.denied` audit entry; an anonymous one gets 401. Both see the same
response body.

**Overrides are never silent.** To work inside a centre the admin must start an
impersonation with a written reason, which is audited *before* the session
flips. Every page then carries a red `YOU ARE VIEWING AS CENTRE ADMIN` bar, and
every write made in that state is stored with `actorAdminId` and
`isOverride = true`.

### Subscription state is not an authorization bypass

A lapsed subscription holds *new writes* (402) but never hides or deletes
anything. `center.billing`, `center.settings` and `reports.export` stay
available so an owner can always pay and always leave with their data. Platform
admins working in support are not blocked.

---

## 4. Tenant isolation

Every tenant-owned table carries `organizationId` with a foreign key and
`ON DELETE CASCADE`. Access goes through three helpers:

- `scope.org(ctx)` / `scope.orgLive(ctx)` — list filters,
- `scope.byId(ctx, id)` — single-row filter, which also rejects a malformed UUID
  before it reaches the driver,
- `assertAllOwned(ctx, model, ids)` — bulk pre-check, so a crafted array cannot
  smuggle a foreign id into a batch operation.

Writes use `updateMany` with the tenant filter, so a mismatched workspace
updates zero rows rather than one wrong row.

Verified by `tests/security/tenant-isolation.test.ts` and
`tests/security/tenant-isolation-extended.test.ts`, which repeat the exercise
for every entity the platform added — homework, submissions, grades, courses,
staff records, salary sheets, payouts and expenses — and by
`tests/http/auth-http.test.ts` and `tests/http/admin-http.test.ts` at the HTTP
layer. Reading, updating, archiving, relating, aggregating, credential
re-issuing and reminder-sending are each attempted across a tenant boundary.

**The student portal is scoped by identity, not by parameter.** Every function
in `lib/domain/portal.ts` starts from the session's own `users.id`, resolves the
single `students` row linked to it, and filters by that id. There is no student
id argument anywhere in the portal API, so there is nothing for a student to
tamper with — one student cannot request another student's grades because the
request has no field in which to name them.

---

## 5. Input handling

- Every route parses its body or query with a **`.strict()`** Zod schema.
  Unknown keys are rejected outright — this is the mass-assignment defence, and
  it is why `organizationId`, `id` and `deletedAt` cannot be injected.
- Query strings are collapsed to the last value per key before parsing, so a
  repeated parameter cannot turn an expected string into an array.
- Numeric bounds are enforced (`page`, `perPage`, `minutesLate`, amounts).
- Control characters are stripped from free text so they cannot corrupt a CSV
  export or a log line.
- HTML is deliberately **not** stripped: React escapes on output, and a student
  legitimately named `O'Brien <3` must round-trip unchanged. Stripping would
  corrupt real data while providing no additional safety.

---

## 6. Injection

| Vector | Control |
|---|---|
| SQL | Prisma parameterizes everything. The single `$queryRaw` (the debtor report) is a tagged template, so every interpolation is a bound parameter. |
| XSS | React escapes by default; no `dangerouslySetInnerHTML` anywhere in the codebase. CSP with `strict-dynamic` means an injected script without the nonce cannot execute even if escaping failed. |
| CSV formula injection | Cells beginning `= + - @` or a tab/CR are prefixed with an apostrophe in `toCsv`. |
| Template injection | Telegram messages are built from structured values; teacher input is interpolated, never used as a template. |
| Path traversal | `resolveSafe` decodes, resolves and refuses anything outside the storage root. |
| Open redirect | The OAuth callback only ever redirects to a path on `APP_URL`. |
| SSRF | The application makes outbound requests to two fixed hosts (Telegram, Google). No user-supplied URL is ever fetched. |

---

## 7. CSRF

Three independent layers:

1. `SameSite=Lax` on the session cookie.
2. `Origin`/`Referer` must equal `APP_URL` — checked in middleware and again in
   `assertCsrf`.
3. A per-session CSRF token (`HMAC(SESSION_SECRET, session.csrfSecret)`) echoed
   in the `X-CSRF-Token` header. A custom header cannot be set cross-origin
   without a preflight, and the preflight is not answered permissively.

The token is readable at `GET /api/csrf` by the session that owns it.

---

## 8. File security

Uploads are treated as hostile:

| Check | Behaviour |
|---|---|
| Size | Rejected above 2 MB before decoding |
| MIME | Allow-list: PNG, JPEG, WebP |
| Extension | Allow-list, checked independently of the MIME type |
| Decode | `sharp` must parse it as a raster image, with a 40 Mpx ceiling against decompression bombs |
| SVG | Refused — it is an XML document that can carry script |
| Re-encode | Always converted to WebP, which destroys any appended payload and strips EXIF |
| Name | Discarded; storage keys are 128 bits of randomness |
| Permissions | Files written `0600`, outside any web root |

Delivery requires **both** a valid, unexpired HMAC signature for that exact file
id **and** a session that belongs to the file's workspace. Responses carry
`Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`.

---

## 9. Rate limiting

Counters live in Postgres, keyed by `(rule, hashed subject, window index)`. The
primary key makes the increment atomic, so concurrent requests cannot race past
the limit.

| Rule | Limit |
|---|---|
| OTP request per identifier | 3 / 15 min |
| OTP request per IP | 10 / 15 min |
| OTP verify per identifier | 8 / 15 min |
| Login per identifier | 8 / 15 min |
| Login per IP | 30 / 15 min |
| Password reset per identifier | 3 / hour |
| Registration per IP | 10 / hour |
| Telegram sends per workspace | 60 / hour |
| Telegram sends per student | 2 / day |
| Uploads per workspace | 60 / hour |
| Billing checkouts per centre | 10 / hour |
| Platform-admin login per username | 5 / 15 min |
| Platform-admin login per IP | 10 / 15 min |
| **Any authenticated write, per actor** | **300 / min** |

The last one is applied by the mutation wrappers themselves, so every
state-changing endpoint inherits it without a per-route opt-in. Authentication
is not a licence to hammer: it bounds a compromised or scripted session without
getting in the way of anyone working normally.

The platform account also carries a **per-account lockout** on top of its
buckets: 8 consecutive failures freeze it for 15 minutes, which a distributed
attacker cannot dodge by rotating source addresses.

A 429 carries `Retry-After`.

---

## 10. Payments

- Plan changes happen **only** after a verified webhook or an explicit
  server-side status fetch. A browser response never activates anything.
- Webhook signatures/credentials are compared in constant time.
- `webhook_events` has a unique `(provider, externalId)`, so a replayed event is
  acknowledged without repeating its side effects.
- The event amount is checked against the stored intent; a mismatch fails the
  intent and is audited.
- The default provider is `manual`, which **never reports success**. A stub that
  faked success would let anyone self-upgrade.

---

## 11. Telegram

- A chat is bound to a workspace only when its owner redeems a single-use,
  hashed, 15-minute token inside Telegram.
- Identity is the Telegram user id supplied by Telegram — never guessed from a
  phone number.
- The webhook is authenticated by the `X-Telegram-Bot-Api-Secret-Token` header,
  compared in constant time, before any parsing. Unauthenticated requests get a
  bare 200 so probing reveals nothing.
- `update_id` is recorded for replay protection.
- Every message is previewed by the teacher, rate limited, deduplicated by
  `(workspace, student, template, day)` and written to `outbound_messages` plus
  the audit log.

---

## 12. Secrets management

- Four secrets are required: `SESSION_SECRET`, `OTP_PEPPER`, `FILE_URL_SECRET`,
  `IP_HASH_SECRET`. All are validated at startup for minimum length.
- `lib/env.ts` is server-only; importing it from a client component is a build
  error.
- No `NEXT_PUBLIC_*` secret exists. A test walks `.next/static` and fails if any
  secret name or value appears in shipped JavaScript.
- `.env`, `.env.test` and `*.pem`/`*.key` are gitignored.
- On a validation failure the error names the offending keys, never their values.

---

## 13. Logging

Written to the audit log: who, what, which entity, outcome, a keyed hash of the
IP, and a truncated user agent.

Never written anywhere: passwords, password hashes, OTP codes, session tokens,
CSRF tokens, API keys, raw IP addresses. `scrub()` redacts by key name
recursively and truncates long values; `hashIp` is HMAC-SHA-256 with a dedicated
secret.

Prisma query logging is disabled in production because queries carry personal
data.

---

## 14. Error handling

- `AppError` carries a status and a **translation key**, never prose and never
  internal detail.
- Any unexpected throw is logged server-side and answered with a generic 500.
- Zod issues become field-level translation keys under a 422.
- 404, 403 and 500 pages are user-facing and contain no stack trace.
- The client error boundary shows only the digest.

---

## 15. Incident response basics

1. **Contain** — revoke the affected sessions (`revokeAllSessions`), and rotate
   the leaked secret. Rotating `SESSION_SECRET` invalidates every CSRF token;
   rotating `FILE_URL_SECRET` invalidates every outstanding signed file URL.
2. **Assess** — `audit_logs` is the primary evidence. It is ordered by
   `(organizationId, createdAt)` and `(actorUserId, createdAt)`.
3. **Eradicate** — fix, add a regression test, deploy.
4. **Notify** — if student or parent data was exposed, tell the affected
   teachers what was accessed and when. Do not wait for certainty about the
   cause.
5. **Review** — record what the control gap was and which test now covers it.

Secrets that may need rotation: `SESSION_SECRET`, `OTP_PEPPER`,
`FILE_URL_SECRET`, `IP_HASH_SECRET`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, payment provider keys, and
the database password.

---

## 16. OWASP Top 10 (2021) coverage

| # | Risk | How it is addressed here |
|---|---|---|
| **A01** | Broken access control | Explicit permission matrix checked server-side on every route; row-level scoping on top of it (a teacher's queries carry their own membership id); tenant filter applied through `scope` helpers rather than by hand; 404 instead of 403 for foreign ids; the student portal takes no student id at all; `/admin` is a separate table, cookie and resolver. Asserted by `tests/security/rbac-enforcement.test.ts`, `tenant-isolation*.test.ts`, `portal.test.ts` and `tests/http/admin-http.test.ts`. |
| **A02** | Cryptographic failures | Argon2id (OWASP baseline parameters) for passwords, admin passwords and OTP codes; opaque session tokens stored only as SHA-256; HMAC-signed file URLs; IPs hashed with a keyed secret before they reach the audit log; `__Host-` + `Secure` + `HttpOnly` cookies; HSTS in production. |
| **A03** | Injection | Prisma parameterizes every query; no string-built SQL anywhere; malformed UUIDs are rejected before reaching the driver; React escapes on output and no `dangerouslySetInnerHTML` exists in the codebase; CSV export prefixes formula-triggering cells. |
| **A04** | Insecure design | Immutable payment and payout ledgers with a separate adjustment table; subscription state gates writes but never deletion; overrides require a reason and are audited before they take effect; credentials are generated, never chosen by the creator, and shown once. |
| **A05** | Security misconfiguration | Environment validated at boot with a fail-closed schema; CSP with a per-request nonce and `strict-dynamic`; user content served under `default-src 'none'; sandbox`; a full header set applied in middleware and asserted by `tests/http/headers-http.test.ts`. |
| **A06** | Vulnerable components | Small dependency surface, versions pinned, `overrides` used to hold transitive packages at patched releases. |
| **A07** | Authentication failures | Rate limits per identifier and per IP, tighter buckets plus a lockout for the platform account; uniform responses and constant-ish timing for unknown accounts; session rotation on login; temporary credentials expire and force a change; re-issuing a password revokes every live session. |
| **A08** | Software and data integrity | Subscriptions move only on a signature-verified webhook or an audited admin action; webhook events are idempotent by external id; `subscription_payments` is unique on `(provider, transaction id)`; amounts are checked against the stored intent, never taken from the event. |
| **A09** | Logging and monitoring | Every sensitive operation writes an audit row with actor, target, outcome, hashed IP and user agent; admin actions additionally carry `actorAdminId` and `isOverride`; a key-name filter redacts anything password-, token- or code-shaped, asserted by `tests/security/logging.test.ts`. |
| **A10** | SSRF | The server makes no outbound request to a user-supplied URL. The only egress targets are fixed provider hosts read from environment variables. |

---

## 17. Known limitations

- **Trusted proxy assumption.** IP-based rate limiting reads the left-most hop of
  `X-Forwarded-For`. Behind a proxy that does not strip client-supplied values,
  per-IP limits can be evaded. Per-identifier limits are unaffected. See
  DEPLOYMENT.md.
- **Application-level tenancy.** Isolation is enforced in the application, not by
  Postgres row-level security. On Supabase, RLS should be enabled as a second
  layer — policies are given in DATABASE.md.
- **Rate limiting is per-window, not token-bucket.** A burst at a window boundary
  can briefly exceed the nominal rate.
- **No CAPTCHA.** Registration is rate limited per IP but not challenged.
- **The `manual` payment provider cannot complete a purchase.** This is
  deliberate; a real provider must be configured before charging anyone.
- **Dependency pinning via `overrides`.** `sharp`, `postcss` and `deepmerge-ts`
  are forced to patched versions because framework packages ship older copies.
  Re-check these after every framework upgrade: an override can silently hold a
  package back as well as forward.

---

## 18. Test coverage of these claims

**459 automated tests across 32 files**, plus 34 Playwright browser tests. Every
claim above is backed by at least one of them. The counts below are the numbers
the runner reports, not estimates.

| Area | File | Tests |
|---|---|---|
| Injection, mass assignment, parameter pollution | `tests/security/injection.test.ts` | 28 |
| Cross-tenant access — students, groups, lessons, payments | `tests/security/tenant-isolation.test.ts` | 24 |
| File uploads, magic bytes, path traversal, signed URLs | `tests/security/uploads.test.ts` | 25 |
| Cross-tenant access — homework, grades, courses, staff, payroll, expenses | `tests/security/tenant-isolation-extended.test.ts` | 19 |
| Server-side permission enforcement per role | `tests/security/rbac-enforcement.test.ts` | 19 |
| Webhook signatures (Payme, Click), amounts, link tokens | `tests/security/webhooks.test.ts` | 28 |
| Student portal self-scoping | `tests/security/portal.test.ts` | 12 |
| OTP issuance, verification and throttling | `tests/security/otp.test.ts` | 12 |
| Reminder consent and rate limiting | `tests/security/reminders.test.ts` | 8 |
| Log redaction | `tests/security/logging.test.ts` | 3 |
| SMS delivery: the code never reaches a log | `tests/security/sms.test.ts` | 9 |
| HTTP auth, CSRF, cookies, IDOR, throttling | `tests/http/auth-http.test.ts` | 35 |
| Admin/centre boundary, role routing, impersonation audit | `tests/http/admin-http.test.ts` | 18 |
| Cross-tenant file access, avatar and attachment uploads | `tests/http/files-http.test.ts` | 18 |
| Headers, CORS, roles, bundle secrets | `tests/http/headers-http.test.ts` | 17 |
| Report export and query validation | `tests/http/reports-http.test.ts` | 5 |
| Permission matrix and override filtering | `tests/unit/rbac.test.ts` | 15 |
| Subscription state machine | `tests/unit/subscription.test.ts` | 12 |
| Username and password generation | `tests/unit/credentials.test.ts` | 10 |
| **Security-focused total** | | **317** |

Supporting layers: 50 unit tests (money, dates, i18n, CSV, phone, timezones) and
92 integration tests (students, lessons and attendance, scheduling conflicts,
the payment ledger, staff provisioning, announcements and the subscription
lifecycle). **459 in total.**

The browser suite (`npm run e2e`) covers the landing page, the login flow for
all four centre roles, the admin boundary, per-role page access, an announcement
posted by an owner and read by the student it was addressed to, and a
cross-tenant URL attempt — in a real browser, which is also the only place the
`__Host-` cookie rules are genuinely enforced.

Run them with `npm run test:security` (domain), `npm test` (everything) or
`npm run e2e` (browser).
