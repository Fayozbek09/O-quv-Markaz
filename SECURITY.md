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

Two questions are answered on every request, always on the server:

1. **Which workspace?** — `ctx.orgId` comes from the session row, never from the
   URL, the body or a header.
2. **What may this member do?** — `OWNER > ADMIN > TEACHER > ASSISTANT`, checked
   by `requireOrg(minRole)`.

| Operation | Minimum role |
|---|---|
| Read the roster, calendar, payments | ASSISTANT |
| Create or edit students, groups, lessons, attendance, payments | TEACHER |
| Reverse a payment, edit workspace settings, upload a logo | ADMIN |
| Start a billing checkout | OWNER |

There is no client-side filtering anywhere. A list query that forgot its
`organizationId` would return another tenant's rows, so the filter is applied
through the `scope` helpers rather than written out by hand at each call site.

**Missing rows return 404, not 403.** A 403 would confirm that an id exists,
which is itself a disclosure.

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

Verified by `tests/security/tenant-isolation.test.ts` (24 tests) and
`tests/http/auth-http.test.ts`: reading, updating, archiving, relating,
aggregating and reminder-sending are each attempted across a tenant boundary.

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
| Billing checkouts per workspace | 10 / hour |

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

| Risk | Position |
|---|---|
| **A01 Broken Access Control** | Server-side tenancy and roles on every call; 404 for foreign rows; 24 dedicated isolation tests |
| **A02 Cryptographic Failures** | Argon2id, HMAC-SHA-256, `randomBytes`, constant-time comparison. No invented cryptography |
| **A03 Injection** | Parameterized queries throughout; React escaping; CSP; CSV formula neutralization |
| **A04 Insecure Design** | Immutable payment ledger, consent-based messaging, provider that cannot fake success, archive-not-delete |
| **A05 Security Misconfiguration** | Full header set, no `x-powered-by`, env validated at startup, restrictive CORS |
| **A06 Vulnerable Components** | Small dependency surface; `npm audit` in the release checklist |
| **A07 Auth Failures** | Rate limits, single-use OTPs, session rotation, uniform error messages |
| **A08 Integrity Failures** | Webhook signature verification, idempotency, amount reconciliation |
| **A09 Logging Failures** | Audit log with redaction; secrets never logged |
| **A10 SSRF** | No user-controlled outbound URL exists |

### ASVS notes

Aligned with ASVS 4.0 Level 1 across V2 (authentication), V3 (session),
V4 (access control), V5 (validation), V7 (logging), V12 (files) and V13 (API).

Not implemented, and honestly out of scope for a single-operator product at this
stage: multi-factor authentication beyond the OTP flow, hardware-backed key
storage, and formal cryptographic key rotation automation.

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

---

## 18. Test coverage of these claims

| Area | File | Tests |
|---|---|---|
| Tenant isolation | `tests/security/tenant-isolation.test.ts` | 24 |
| OTP | `tests/security/otp.test.ts` | 12 |
| Injection / mass assignment | `tests/security/injection.test.ts` | 28 |
| File uploads and signed URLs | `tests/security/uploads.test.ts` | 17 |
| Webhooks and link tokens | `tests/security/webhooks.test.ts` | 15 |
| Reminder consent and throttling | `tests/security/reminders.test.ts` | 8 |
| Log redaction | `tests/security/logging.test.ts` | 3 |
| HTTP auth, CSRF, IDOR, cookies | `tests/http/auth-http.test.ts` | 33 |
| Headers, CORS, roles, bundle secrets | `tests/http/headers-http.test.ts` | 17 |
| Cross-tenant file access | `tests/http/files-http.test.ts` | 9 |

Run them with `npm run test:security` (domain) or `npm test` (everything).
