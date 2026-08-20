# Architecture

## Shape of the system

One Next.js application, one PostgreSQL database, one optional object store.
There is no separate API service: route handlers and server components share
the same domain layer, so authorization cannot diverge between them.

```
browser
   │  HTTPS
   ▼
┌──────────────────────────────────────────────────────────┐
│ middleware.ts        CSP nonce · security headers        │
│                      same-origin gate on mutations        │
├──────────────────────────────────────────────────────────┤
│ app/                 server components (read)             │
│                      route handlers   (read + write)      │
├──────────────────────────────────────────────────────────┤
│ lib/api.ts           auth · CSRF · body limits · errors   │
│ lib/tenant.ts        organization scope · role checks     │
│ lib/validation/      Zod schemas, strict allow-lists      │
├──────────────────────────────────────────────────────────┤
│ lib/domain/          students · groups · lessons ·        │
│                      attendance · payments · billing ·    │
│                      reports · reminders · plan           │
├──────────────────────────────────────────────────────────┤
│ lib/db.ts            Prisma 7 + pg driver adapter         │
└──────────────────────────────────────────────────────────┘
   │                    │                    │
   ▼                    ▼                    ▼
PostgreSQL         local/S3 files      Telegram · SMS · payments
```

## Layers

| Layer | Directory | Responsibility | Never does |
|---|---|---|---|
| Presentation | `src/app`, `src/components` | Rendering, form state, navigation | Talk to Prisma directly in a client component; decide authorization |
| Transport | `src/lib/api.ts` | Session lookup, CSRF, body-size limits, error shaping | Contain business rules |
| Tenancy | `src/lib/tenant.ts` | Resolve the workspace, check the role, scope every query | Trust anything from the request body |
| Validation | `src/lib/validation` | Parse and normalize input at the boundary | Run after a write has started |
| Domain | `src/lib/domain` | Business rules, invariants, audit writes | Read cookies or headers |
| Data | `src/lib/db.ts`, `prisma/` | Connection, schema, migrations | Hold business logic |
| Integrations | `src/lib/integrations`, `src/lib/payments`, `src/lib/notifications` | External systems behind interfaces | Be called without a tenant context |

The rule that keeps this honest: **a domain function takes an `OrgContext` as
its first argument.** It cannot be called without one, and the context can only
come from a verified session.

## Request lifecycle

A mutation, end to end:

1. **middleware** mints a CSP nonce, attaches the security headers, and rejects
   a non-GET request whose `Origin` is not this app.
2. **route handler** is wrapped in `orgMutation(...)`, which:
   - resolves the session from the `__Host-` cookie (`getSessionUser`),
   - loads the membership and role for the active workspace (`requireOrg`),
   - verifies `Origin`/`Referer` plus the per-session CSRF token (`assertCsrf`),
   - reads the body under a 256 KB ceiling and parses it with a `.strict()`
     Zod schema (`readJson`).
3. **domain function** receives `(ctx, input)`. Every query it issues carries
   `organizationId: ctx.orgId`. Related ids in the payload are verified to
   belong to the tenant before they are used.
4. **audit** records what happened, with secrets scrubbed and the IP stored only
   as a keyed hash.
5. **response** is serialized with `json()`, which converts `BigInt` money to
   decimal strings and sets `cache-control: no-store`.

A read is the same minus steps for CSRF.

## Where state lives

| State | Where | Why there |
|---|---|---|
| Session | `sessions` table, opaque token in a cookie | Server-side revocation; a stolen cookie dies the moment the row is revoked |
| CSRF secret | `sessions.csrfSecret`, token derived per session | Double-submit without a second cookie |
| Locale | `ustozly_locale` cookie + `profiles.locale` | The cookie is read during SSR so the first paint is already correct |
| Rate limits | `rate_limit_counters` table | Survives restarts and holds across processes |
| Active workspace | `sessions.activeOrgId` | Switching workspaces cannot be done from the client |
| Files | Filesystem or S3, never the database | Blobs do not belong in a row; access goes through a signed, checked route |

## Money

Money is an integer count of minor units plus an ISO-4217 code. No float ever
touches a balance. UZS has no subunit, so `400000` means 400 000 so'm; USD has
two, so `1234` means $12.34. `BigInt` is used end to end and serialized as a
decimal string in JSON, because `Number` loses precision above 2^53.

The ledger has three kinds of row:

- **invoices** — what is expected (a debit),
- **payments** — what arrived (a credit), immutable once written,
- **payment_adjustments** — corrections, append-only.

Debt is `expected − (paid + adjustments)`. Nothing is ever deleted, so a figure
can always be explained.

## Internationalization

Dictionaries are plain typed objects in `src/lib/i18n/dictionaries`. The English
one defines the key type; the other two must structurally match it, which the
compiler enforces and a test re-checks at runtime for empty strings.

Locale resolution: explicit cookie → `Accept-Language` → Uzbek. It happens on
the server, so the first HTML response is already in the right language and
there is no flash of the wrong text.

**Dates and month names for Uzbek are composed from the dictionary, not from
`Intl`.** Chromium ships no `uz` locale data and renders `2026 M08 20, Thu`
where Node's full ICU renders `payshanba, 20-avgust, 2026`. Relying on `Intl`
therefore produced both a broken interface for the primary market and a
hydration mismatch between server and client. `formatDate` takes a named format
(`'date'`, `'dateFull'`, `'monthYear'`, …) rather than raw `Intl` options, so
every call site is covered by the same guarantee. Russian and English continue
to use `Intl`, where the data is reliable.

## Integration boundaries

Each external system sits behind an interface with a driver that works offline:

- `PaymentProvider` — `manual` is the default and **never reports success**.
- `SmsSender` / `EmailSender` — `console` prints to stdout in development.
- Telegram — every send is recorded in `outbound_messages`, whether or not a bot
  token is configured.

This is what lets the whole application be developed, tested and demonstrated
without a single external credential, while the production adapters remain thin.

## Performance

- Every list is paginated; nothing loads an unbounded set.
- Indexes exist for the access patterns that matter: `(organizationId, status)`,
  `(organizationId, startsAt)`, `(organizationId, paidAt)`.
- Reports resolve per-group money with three `groupBy` queries, not N+1.
- The debtor report is a single query with lateral joins rather than a fan-out.
- Images are re-encoded to WebP and capped at 512 px, so a workspace logo is a
  few kilobytes on a slow connection.
- Server components fetch data during render, so a page arrives complete instead
  of empty-then-populated.
