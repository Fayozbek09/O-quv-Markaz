# Threat model

Scope: the Ustozly web application, its database, its file storage and its three
outbound integrations (Telegram, an SMS/email gateway, a payment provider).

Out of scope: the hosting provider's own security, the teacher's device, and
Telegram's own infrastructure.

---

## 1. What is worth protecting

| Asset | Sensitivity | Why an attacker wants it |
|---|---|---|
| Student and parent records | **High** — names and phone numbers of minors and their families | Directly abusable for fraud or harassment; a breach ends the product |
| Financial records | High | Reveals a teacher's income; can be altered to hide or invent payments |
| Attendance history | Medium | Reveals a child's routine and whereabouts |
| Teacher credentials | High | Full access to everything above |
| Session tokens | High | Same, without needing the password |
| Telegram chat ids | Medium | A channel straight to a parent's phone |
| Server secrets | Critical | Forge sessions, forge file URLs, decrypt nothing but bypass everything |
| Uploaded files | Low–Medium | A vector for stored XSS or remote execution if mishandled |

The unusual property of this product: **most of the personal data belongs to
people who are not users.** Students and parents never log in and cannot audit
what is stored about them. That asymmetry drives several decisions below.

---

## 2. Who might attack it

| Actor | Capability | Motivation |
|---|---|---|
| **Curious tenant** | A legitimate account, full knowledge of the API | See a competitor's student list or pricing |
| **Opportunistic scanner** | Automated, no account | Commodity vulnerabilities, credential stuffing |
| **Targeted attacker** | Skilled, may have a teacher's phone number | A specific teacher's records |
| **Compromised parent contact** | Holds a linked Telegram chat | Abuse the messaging channel |
| **Insider (workspace member)** | An ASSISTANT or TEACHER role | Alter payments to conceal cash |
| **Malicious payment webhook** | Can reach the public webhook URL | Free plan upgrade |

The **curious tenant** is the primary adversary. They are authenticated, they
know the shape of every endpoint, and the only thing between them and another
teacher's data is the tenancy check.

---

## 3. Trust boundaries

```
   untrusted                    │  semi-trusted        │  trusted
 ──────────────────────────────┼──────────────────────┼──────────────────
  browser input                │  authenticated       │  server process
  uploaded files               │  session             │  database
  Telegram updates             │  workspace member    │  secrets in env
  payment webhooks             │                      │
  Accept-Language, headers     │                      │
```

Everything crossing left-to-right is validated. An authenticated session is
**semi**-trusted: it establishes identity, never authority.

---

## 4. Threats and mitigations

Grouped by STRIDE.

### Spoofing

| Threat | Mitigation | Residual risk |
|---|---|---|
| Password guessing | Argon2id; 8 attempts / 15 min per identifier; uniform error message | Credential stuffing with a known-good password still works — no MFA |
| OTP brute force | 10^6 space, 5 attempts, 5-minute lifetime, throttled requests | A determined attacker with many phone numbers can still enumerate slowly |
| Session theft via XSS | `HttpOnly`, CSP with nonce + `strict-dynamic`, no `dangerouslySetInnerHTML` | A browser-level compromise defeats this |
| Session fixation | New session row per login; token never accepted from a URL | — |
| Forged Telegram webhook | Constant-time secret-token check before parsing | Secret leak = full webhook access |
| Forged payment webhook | Signature/credential check, idempotency, amount reconciliation | Provider-side key compromise |
| Account enumeration | Identical response and timing for known/unknown accounts on login and reset | Registration must reject a duplicate, which does confirm existence — accepted, since the alternative is worse UX |

### Tampering

| Threat | Mitigation | Residual risk |
|---|---|---|
| Mass assignment (`organizationId`, `role`, `id`) | `.strict()` schemas reject unknown keys | — |
| Editing a payment to hide cash | Payments immutable; corrections are append-only adjustments; reversal needs ADMIN and a reason | An ADMIN can still reverse legitimately — the log records who and why |
| Altering another tenant's row | Tenant filter on every write; `updateMany` affects zero rows on mismatch | — |
| SQL injection | Parameterized queries; the one raw query is a tagged template | — |
| Malicious upload | Type + extension allow-list, decode, re-encode, random name, `0600` | A `sharp` decoder vulnerability |
| Parameter pollution | Last-value-wins collapse before parsing | — |

### Repudiation

| Threat | Mitigation | Residual risk |
|---|---|---|
| "I never sent that reminder" | Every send recorded with actor, recipient, body and time | — |
| "I never reversed that payment" | Reversal is a row with `createdByUserId` and a mandatory reason | — |
| Log tampering | Audit rows are insert-only from the application | A database-level compromise can rewrite history — ship logs off-host in production |

### Information disclosure

| Threat | Mitigation | Residual risk |
|---|---|---|
| **Cross-tenant read (primary risk)** | `organizationId` on every query; 404 for foreign rows; 24 dedicated tests | A future endpoint written without `scope.*` would reintroduce this — hence the helpers and the test suite |
| IDOR by changing an id | Ownership check, plus UUIDv4 ids that cannot be enumerated | — |
| File URL leak | Signature bound to file id, 10-minute expiry, **and** a session-based ownership check | — |
| Stack traces / driver errors | `AppError` with translation keys; generic 500 | — |
| Secrets in the client bundle | Server-only env module; a test scans `.next/static` | — |
| Personal data in logs | Key-based scrubbing, hashed IPs, query logging off in production | — |
| Timing side channel on login | Dummy Argon2 verification for missing accounts | Network jitter dominates anyway |

### Denial of service

| Threat | Mitigation | Residual risk |
|---|---|---|
| Credential-stuffing flood | Per-identifier and per-IP limits | Distributed attack still consumes capacity |
| SMS cost abuse | 3 OTPs per identifier per 15 min, 10 per IP | An attacker with many IPs can still burn credit — set a gateway-side cap |
| Large upload | 2 MB ceiling checked before decode; 40 Mpx limit against decompression bombs | — |
| Huge request body | 256 KB JSON ceiling | — |
| Unbounded queries | Mandatory pagination; date enumeration capped at 400 days | — |
| Telegram spam through the product | Per-workspace hourly cap, per-student daily cap, dedupe key, mandatory preview | A determined teacher can still message their own parents — that is the product working |

### Elevation of privilege

| Threat | Mitigation | Residual risk |
|---|---|---|
| ASSISTANT performing an ADMIN action | `requireOrg(minRole)` on the route; tested over HTTP | — |
| Self-upgrading a plan | Only a verified webhook activates a subscription; `manual` never succeeds | — |
| Switching to another workspace | `switchOrganization` verifies membership; `activeOrgId` lives in the session row | — |
| Role escalation via payload | Role is never a request field | — |

---

## 5. Attack scenarios walked through

**Scenario A — a teacher tries to read a competitor's roster.**
They log in, open dev tools, copy a student id pattern and call
`GET /api/students/<uuid>`. The handler resolves their session, derives
`ctx.orgId` from the session row, and queries
`WHERE id = ? AND organizationId = ?`. No row matches; they get 404 with a
translation key. They try `PUT` and `DELETE` on the same id: zero rows updated,
404 again. They try adding that student to their own group: `assertAllOwned`
rejects it. They try a Telegram reminder: `buildReminder` cannot find the
student. Covered by 24 tests.

**Scenario B — a phishing page tries to add a student to a victim's workspace.**
The page posts to `/api/students` with `credentials: 'include'`. `SameSite=Lax`
suppresses the cookie on a cross-site POST. Even if it were sent, middleware
compares `Origin` against `APP_URL` and returns 403, and `assertCsrf` would
require a header the attacker cannot read. Covered by four CSRF tests.

**Scenario C — someone tries a free Pro upgrade.**
They call `POST /api/billing/checkout`, get a pending intent, and then post a
fabricated success to `/api/billing/webhook`. Without the provider credential
the signature check fails, the attempt is recorded with `signatureOk: false`,
and the response is 401. With a stolen credential but a tampered amount, the
intent comparison fails and the intent is marked `FAILED`. Replaying a genuine
event hits the unique `(provider, externalId)` index.

**Scenario D — an upload tries to become a web shell.**
`shell.php` renamed to `logo.png` fails the decode step. A polyglot — a real PNG
with PHP appended — decodes, but the stored file is a fresh WebP re-encode, so
the payload is gone. An SVG with `<script>` is refused at the MIME and the
decode stage. Even a valid image is served from a route that sets
`default-src 'none'; sandbox` and `nosniff`. Covered by 17 tests.

---

## 6. Assumptions

- TLS terminates in front of the application, and the proxy sets
  `X-Forwarded-For` from the real connection rather than passing through a
  client-supplied value.
- The database is not reachable from the public internet.
- `.env` is readable only by the application user.
- The operator applies dependency updates.
- The teacher's own device is not compromised.

If any of these does not hold, the corresponding controls degrade — see
"Known limitations" in SECURITY.md.

---

## 7. Residual risks accepted at this stage

| Risk | Why accepted | What would change it |
|---|---|---|
| No MFA | A single-teacher tool; OTP already gates registration | TOTP once workspaces have staff |
| No CAPTCHA | Adds friction on a slow connection for modest benefit | Evidence of automated signup abuse |
| Application-level tenancy only | Simpler to reason about and fully tested | Enable Postgres RLS as a second layer (policies in DATABASE.md) |
| Fixed-window rate limiting | Adequate against the actual threats | Move to a token bucket if boundary bursts matter |
| Audit log in the same database | One operator, one host | Ship logs to append-only external storage |


---

## 8. Threats introduced by the platform roles

The move from a single-tutor workspace to a multi-role centre adds actors who
are *inside* the tenant. These are the threats that come with them.

### A teacher reading what they should not

**Threat.** A teacher opens another teacher's group, another teacher's salary or
the centre's payment ledger.

**Mitigations.**
- `TEACHER` does not hold `payments.read`, `payments.create`, `expenses.read` or
  `salary.write` — asserted in `tests/unit/rbac.test.ts`.
- `salary.read` is held, but the salaries endpoint branches on the role and
  returns one line, the caller's own.
- Group, homework and grade queries add `teacherId: ctx.memberId` to the *query*,
  so another teacher's rows are never fetched, not merely hidden.

**Residual.** A teacher assigned to a group can see every student in it,
including their contact details. That is the job.

### A receptionist escalating through a permission override

**Threat.** An override is written that grants a receptionist `center.delete` or
`salary.write`.

**Mitigation.** `permissionsFor()` filters overrides through `GRANTABLE`, a
per-role allow-list. A permission outside it is ignored even if it is present in
the database column, so a stray SQL edit or a compromised settings form cannot
mint an owner.

### A student reaching another student

**Threat.** A student changes an id in a request to read someone else's grades,
attendance or balance.

**Mitigation.** There is no id to change. Every portal function derives the
student from `session.userId`; the only id a student ever sends is a homework id
when handing work in, and that is matched against their own submission rows.
`tests/security/portal.test.ts` asserts this for attendance, grades, payments,
homework and submission.

**Residual.** A student who shares their password shares their own record. The
forced first-login change and the 14-day expiry on temporary credentials narrow
the window in which an unused issued password is useful.

### A centre user reaching the platform area

**Threat.** A signed-in owner or teacher navigates to `/admin` or calls
`/api/admin/*`.

**Mitigations.**
- Platform staff live in a separate table; there is no column on `users` that
  grants platform access.
- The admin resolver reads a different cookie and never falls back to the centre
  session.
- The attempt is refused with 403 and recorded as `admin.access.denied`.
- Asserted over real HTTP in `tests/http/admin-http.test.ts`.

### A platform admin acting inside a centre

**Threat.** Support access is used to read or change centre data unaccountably.

**Mitigations.** The capability is deliberate and cannot be removed without
removing support, so the control is accountability rather than prevention:
- impersonation requires a written reason, audited *before* the session flips;
- a red banner names the centre on every page for the duration;
- every write carries `actorAdminId` and `isOverride = true`;
- the centre's own owner sees those entries in their activity feed, flagged.

**Residual.** A platform admin with database access can edit the audit log
itself. Mitigated operationally — restricted database credentials, off-host log
shipping — not in the application.

### Subscription state abused as a denial of service

**Threat.** A billing bug, or a hostile actor with admin access, suspends a
centre and takes its data with it.

**Mitigations.**
- Suspension is a status field; no deletion, archival or expiry job is tied to
  it anywhere in the schema.
- `center.billing`, `center.settings` and `reports.export` stay reachable while
  suspended, so an owner can always pay and always export.
- Suspension and closure both require a reason and are audited.
- Closing a centre is a soft delete: financial and academic records are retained
  for audit, and the action says so in the confirmation dialog.

### A forged payment activating a subscription

**Threat.** A crafted request marks a centre as paid.

**Mitigations.**
- No endpoint accepts a payment outcome from a browser. `applySuccessfulPayment`
  is called only from the verified-webhook path and from the platform admin's
  offline-payment action.
- The webhook checks the provider signature, the event id (idempotency) and the
  amount against the stored intent before anything moves.
- `subscription_payments` is unique on `(provider, providerTransactionId)`, so
  replaying a captured event cannot buy a second month.
