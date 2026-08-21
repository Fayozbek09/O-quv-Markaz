# Deployment

## Requirements

| Component | Version | Notes |
|---|---|---|
| Node.js | 20 LTS or newer | Built and tested on 24 |
| PostgreSQL | 15 or newer | Tested on 17 |
| TLS | required in production | `Secure` cookies and HSTS depend on it |
| Persistent storage | required if `STORAGE_DRIVER=local` | Uploaded logos and avatars |

`sharp` needs no system packages on x64 Linux (it ships prebuilt binaries).

---

## 1. Secrets

Generate four independent secrets:

```bash
for name in SESSION_SECRET OTP_PEPPER FILE_URL_SECRET IP_HASH_SECRET; do
  echo "$name=\"$(openssl rand -hex 32)\""
done
```

Put them in `.env` (or the platform's secret store) together with
`DATABASE_URL`, `APP_URL` and `NODE_ENV=production`.

The application validates these at startup and refuses to boot if one is
missing or shorter than 32 characters. The error names the offending keys and
never prints their values.

`APP_URL` must be the exact public origin. CSRF `Origin` checks and the OAuth
redirect are both derived from it — a mismatch makes every mutation fail with
403.

---

## 2. Database

```bash
npm ci
npx prisma generate
npm run db:deploy        # applies migrations, does not create them
```

Do **not** run `db:seed` in production.

### Least privilege

Run `scripts/db-harden.sql` once, as the database owner, **after** the
migrations:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v app_role=oquv_markaz_app \
  -v app_password="$(openssl rand -base64 32)" \
  -f scripts/db-harden.sql
```

It creates the role the application connects as and gives it exactly
`SELECT, INSERT, UPDATE, DELETE` — no `CREATE`, no `TRUNCATE`, no ownership.
The application never issues DDL, so it loses nothing; what it gains is that an
injection or a compromised process cannot drop a table. The script also sets a
30-second `statement_timeout`, a 60-second idle-in-transaction timeout and a
connection cap, so one bad query cannot starve the pool.

Re-running is safe, and `ALTER DEFAULT PRIVILEGES` means the next migration's
tables inherit the same grants rather than arriving unreadable.

It ends by printing what it did. Confirm:

```sql
SELECT has_table_privilege('oquv_markaz_app','students','TRUNCATE');  -- f
SELECT has_schema_privilege('oquv_markaz_app','public','CREATE');     -- f
```

**Migrations run as the owner, not as this role.** Keep the two connection
strings separate: the app's in `DATABASE_URL`, the owner's used only by
`db:deploy`.

### Row-level security

RLS is **not** enabled, and the honest reason is worth stating rather than
leaving as a checkbox.

Tenant isolation here is enforced in the application: every query goes through
`scope.*` helpers that carry `organizationId`, a teacher's rows are narrowed
further by their membership id, and roughly a hundred tests assert that a
crafted id from another centre answers 404. A GUC-based RLS policy would put a
second wall behind that — but only if the application sets the tenant on the
connection for every request, which with a pooled client means wrapping every
query in an interactive transaction. That is a large change to the hot path,
and it would not address the threat people usually reach for RLS to solve: an
attacker holding the database credential can set the GUC themselves.

What does address that threat is the restricted role above, network isolation,
and backups you have actually restored.

If you are on a platform where RLS is cheap — Supabase, where the client
connects per-user — the policies are in [DATABASE.md](DATABASE.md).

### Backups

`scripts/db-backup.sh` takes the dump **and restores it into a scratch database
to count the rows**, because a backup nobody has restored is a hope rather than
a backup:

```bash
DATABASE_URL="postgresql://..." BACKUP_DIR=/var/backups/oquv-markaz \
  ./scripts/db-backup.sh
```

Schedule it daily. It fails loudly on a suspiciously small dump, prunes anything
older than `KEEP_DAYS` (30 by default), and `--no-verify` skips the restore
check for the rare case where there is no room for a second copy.

---

## 3. Build and run

```bash
npm run build
npm start                # listens on :3000
```

Behind a reverse proxy:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    # Overwrite, never append: a client-supplied value would defeat
    # per-IP rate limiting.
    proxy_set_header   X-Forwarded-For   $remote_addr;
    proxy_set_header   X-Forwarded-Proto $scheme;
    client_max_body_size 5m;
}
```

**The `X-Forwarded-For` line matters.** The application reads the left-most hop
for per-IP rate limiting. If the proxy appends to a client-supplied header
instead of overwriting it, an attacker can rotate that value and evade per-IP
limits. Per-identifier limits are unaffected either way.

### systemd

```ini
[Unit]
Description=O'quv Markaz
After=network.target postgresql.service

[Service]
Type=simple
User=oquvmarkaz
WorkingDirectory=/srv/oquv-markaz
EnvironmentFile=/srv/oquv-markaz/.env
ExecStart=/usr/bin/npm start
Restart=on-failure

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/oquv-markaz/storage
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

`ReadWritePaths` is the only writable location, which is where uploads go.

---

## 4. External services

Everything below is optional. The application runs fully without any of it,
degrading visibly rather than silently.

### SMS (verification codes)

| Variable | Value |
|---|---|
| `SMS_PROVIDER` | `console` \| `eskiz` \| `playmobile` |

`console` prints codes to the server log — development only.

Both gateways are implemented. Switching to one is a matter of credentials, not
code: set `SMS_PROVIDER` and fill in the variables below.

**Eskiz.uz** (`SMS_PROVIDER=eskiz`) — the gateway most Uzbek businesses use.

| Variable | Where it comes from |
|---|---|
| `ESKIZ_EMAIL` | the e-mail you registered at my.eskiz.uz |
| `ESKIZ_PASSWORD` | that account's password |
| `ESKIZ_FROM` | approved sender nickname; leave at `4546` until one is granted |

Steps, in order — the last two are where deployments usually stall:

1. Register at **my.eskiz.uz** and sign the contract (a legal entity is
   required; an individual account is limited to their test numbers).
2. Top up the balance. Roughly 50–70 so'm per SMS segment at the time of
   writing; a Cyrillic or Latin-with-diacritics message costs more segments than
   plain Latin, so keep the OTP text short and unaccented.
3. **Register the message template in the cabinet and wait for moderation.**
   Eskiz rejects any text that does not match an approved template — this is the
   single most common cause of a code that never arrives. Submit the exact
   wording the application sends, with the code as a placeholder.
4. Optionally request a sender nickname; until then messages come from `4546`.

The adapter (`src/lib/notifications/providers/eskiz.ts`) signs in once, caches
the bearer token, and re-authenticates a single time on a 401 before giving up —
a wrong password fails fast instead of looping. Failures name the gateway's own
reason (`eskiz_send_failed:400:template not approved`) so a misconfiguration is
identifiable from the log without the message body ever being written to it.

**Play Mobile** (`SMS_PROVIDER=playmobile`) — set `PLAYMOBILE_LOGIN`,
`PLAYMOBILE_PASSWORD` and `PLAYMOBILE_ORIGINATOR`. HTTP Basic per request, no
token to hold, same approval requirement for the originator.

**Until an SMS provider is configured, phone registration cannot complete in
production.** Email registration and Google login still work. Neither gateway
ever reports success it did not get: with credentials missing, `sms.send` throws
rather than resolving, so a half-finished deployment fails at the first code
instead of leaving people waiting for one that was never sent.

### Email

| Variable | Value |
|---|---|
| `EMAIL_PROVIDER` | `console` \| `smtp` \| `resend` |

Same shape: implement `EmailSender`.

### Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web.
2. Authorized redirect URI: `${APP_URL}/api/auth/google/callback`
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Unset, the "Continue with Google" button is hidden and the route returns 501.

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather); copy the token.
2. Generate a webhook secret: `openssl rand -hex 32`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
4. Register the webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"${APP_URL}/api/telegram/webhook\",
       \"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",
       \"allowed_updates\":[\"message\"]}"
```

The webhook rejects any request whose secret token does not match, before
parsing anything.

### Payments

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `manual` (default) \| `payme` \| `click` |

`manual` **never reports a successful payment**. Plan changes must be made by an
operator until a real provider is configured. This is deliberate: a stub that
faked success would let anyone self-upgrade.

#### Payme

You need a merchant account, `PAYME_MERCHANT_ID` and `PAYME_SECRET_KEY`, and the
**Endpoint** in the merchant cabinet set to `${APP_URL}/api/billing/webhook`.

Payme is not a notify-once gateway. It drives a JSON-RPC state machine against
your endpoint and expects the merchant to hold the state and to answer a
repeated call *identically*. `src/lib/payments/payme-merchant.ts` implements the
whole method set:

| Method | Behaviour |
|---|---|
| `CheckPerformTransaction` | Confirms the order exists, is unpaid, and that the quoted amount matches the intent |
| `CreateTransaction` | Reserves it; a repeated call returns the same transaction rather than a second reservation |
| `PerformTransaction` | Settles once and extends the term; a retry replays the same answer; anything past the 12-hour window is cancelled with reason 4 instead |
| `CancelTransaction` | State −1 before settlement, −2 after, and the charge is marked refunded |
| `CheckTransaction` | The full state record, including `reason` |
| `GetStatement` | Reconciliation over a time window |

Two properties are worth knowing because they are what certification checks:
**every reply is HTTP 200**, errors included — a non-200 is read as a transport
fault and retried forever — and **the amount is never taken from the request**;
it is compared against the intent the centre actually created, and a mismatch is
`-31001`. Amounts arrive in **tiyin** and the ledger counts so'm, so everything
crossing the boundary is converted.

Authentication is `Basic base64("Paycom:$PAYME_SECRET_KEY")`, compared in
constant time. A wrong or missing credential is `-32504`.

29 tests in `tests/security/payme-merchant.test.ts` play the gateway against
this endpoint, including the retries, the timeout and the double-payment
attempt.

#### Click

For Click you need a shop in the Click merchant cabinet, `CLICK_MERCHANT_ID`
(the `service_id` Click issues) and `CLICK_SECRET_KEY`, with both the Prepare
and Complete URLs pointed at `${APP_URL}/api/billing/webhook`. The adapter in
`src/lib/payments/providers/click.ts` verifies the MD5 signature in constant
time, refuses a callback addressed to another shop, and treats Click's two-phase
callback correctly: `action=0` (Prepare) is recorded as **pending** and extends
nothing, and only `action=1` (Complete) with a non-negative `error` settles the
term. The two phases are stored under distinct event ids so replaying either is
a no-op. Click quotes amounts in so'm; the adapter converts to tiyin, and the
webhook route still refuses any amount that disagrees with the stored intent.

Click also reads the *reply*, not the HTTP status: it looks for `error`, and on
Prepare it stores `merchant_prepare_id` to send back on Complete, where it forms
part of the next signature. Answering `{ ok: true }` is not an acknowledgement
to Click — the payment stays unconfirmed on their side while the ledger here
says it settled — so each adapter renders its own envelope.

Whichever provider is configured, no browser response ever activates a plan —
only a signed callback does. In production the process refuses to start if a
provider is named without its credentials, so a half-configured gateway cannot
reach a paying customer.

---

## 5. File storage

`STORAGE_DRIVER=local` writes to `STORAGE_LOCAL_DIR` with mode `0600`.

Requirements:

- The directory must persist across deploys (a volume, not the container layer).
- It must **not** be served by the web server. Files are delivered only through
  `/api/files/[id]`, which checks a signature and the caller's workspace.
- Include it in backups; it holds workspace logos and avatars.

For S3-compatible storage, implement the same three functions
(`putObject`, `getObject`, `deleteObject`) in `src/lib/files/storage.ts`. Keep
the bucket private and keep delivery going through the application route.

---

## 6. Data residency

**Say where the data physically is. Do not claim compliance with any particular
law — document the facts and let a lawyer draw conclusions.**

Record, for your deployment:

| What | Where | Retention |
|---|---|---|
| Application database (students, parents, payments, attendance) | _region / provider_ | until the account is deleted |
| Uploaded files (logos, avatars) | _region / provider_ | until replaced or the account is deleted |
| Audit logs | same database | _your policy_ |
| Backups | _region / provider_ | _your policy_ |
| Verification codes | database | 24 h after expiry |
| Telegram messages | Telegram's infrastructure | outside your control |
| SMS | the gateway's infrastructure | outside your control |

For an Uzbekistan launch, the relevant question is whether personal data of
citizens must be stored on servers inside the country. The architecture supports
it — the application, the database and file storage can all run on local
infrastructure, and nothing requires a foreign managed service. Confirm the
current legal requirement and your registration obligations with a local
adviser; this document does not and cannot do that.

Data subjects here are mostly **not** users: students and parents cannot log in.
Requests about their data arrive through the teacher, who can export or delete
from Settings → Security.

---

## 7. Pre-launch checklist

Most of the first section is enforced by the application itself. In production
the process runs a **preflight** at boot (`src/lib/env.ts`) and **refuses to
start** if any of it is wrong — a server that will not start is a deployment
that gets fixed, while one that starts wrong is an incident. It prints the
offending keys and the reason, never a value.

`SKIP_ENV_PREFLIGHT=1` exists for the test harnesses, which run the production
build against test configuration deliberately. Setting it on a server that faces
real people defeats the check.

### Enforced at boot — the process will not start otherwise

- [ ] `NODE_ENV=production`
- [ ] All four secrets generated fresh (`openssl rand -hex 32`), none from
      `.env.example`, none repeated
- [ ] `APP_URL` is `https://` and is not localhost
- [ ] `SMS_PROVIDER` is a real gateway, with credentials
- [ ] `EMAIL_PROVIDER` is a real sender
- [ ] A named payment provider has its merchant credentials
- [ ] A Telegram bot token, if set, has a webhook secret
- [ ] A named `CAPTCHA_PROVIDER` has both its keys

### Warned about at boot — deliberate choices, logged so nobody is surprised

- [ ] `PAYMENT_PROVIDER=manual` — no online payment can complete; a platform
      admin settles each centre by hand
- [ ] `CAPTCHA_PROVIDER=none` — registration is rate limited but not challenged
- [ ] `STORAGE_DRIVER=local` — uploads live on this machine's disk
- [ ] No Telegram bot — reminders are disabled

### Checked by a person

- [ ] TLS terminating; HTTP redirects to HTTPS
- [ ] `X-Forwarded-For` set by the proxy, not passed through
- [ ] Database not reachable from the internet
- [ ] Migrations applied (`npm run db:deploy`)
- [ ] `scripts/db-harden.sql` run, and the application connecting as the
      restricted role — verify `can_truncate` is false (§2)
- [ ] Seed **not** run
- [ ] Upload directory persistent, writable, not web-served
- [ ] `scripts/db-backup.sh` scheduled, and its restore check passing
- [ ] `npm test` and `npm run e2e` green against a staging database
- [ ] `npm audit` clean (the repo ships `overrides` that keep it at zero)
- [ ] Platform administrator created (`npm run admin:create`) and the temporary
      password changed
- [ ] **Two-step verification switched on for the platform administrator**
      (`/admin/security`), and the recovery codes stored somewhere that is not
      the same laptop
- [ ] Privacy Policy and Terms updated with real contact details
- [ ] `NEXT_PUBLIC_CONTACT_*` set to the details you actually answer
- [ ] Data residency table above filled in
- [ ] Housekeeping job scheduled (`purgeExpiredOtps`, `purgeExpiredRateLimits`)
- [ ] Subscription job scheduled (`npm run subscriptions:remind`, §11)

### If a payment provider is configured

- [ ] Merchant cabinet points at `https://your-domain/api/billing/webhook`
- [ ] A real payment taken end to end on staging, and the centre's term extended
- [ ] The same webhook replayed, and the term **not** extended twice
- [ ] A cancellation exercised, and the charge shown as refunded

---

## 8. Verifying a deployment

```bash
# Security headers
curl -sI https://your-domain/login | grep -iE 'content-security|strict-transport|x-frame|x-content-type'

# Unauthenticated API access is refused
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/api/students   # 401

# No secret in the client bundle
grep -rE 'SESSION_SECRET|OTP_PEPPER|postgresql://' .next/static || echo 'clean'
```

---

## 9. Monitoring

Worth alerting on:

- 5xx rate,
- a spike in 429s (an attack, or a limit set too tight),
- `audit_logs` rows with `outcome = 'denied'`,
- `webhook_events` with `signatureOk = false`,
- `outbound_messages` with `status = 'FAILED'`,
- database connection saturation.

Ship application logs off-host. They contain no secrets and no raw IPs by
design, so they are safe to centralize.


---

## 10. Platform administrator

The platform account is created by a script, never by a migration and never by a
seeded constant:

```bash
npm run admin:create
```

It prints the username and password once and stores only the Argon2id hash.
Options:

| Variable | Effect |
|---|---|
| `ADMIN_FULL_NAME` | Display name (default: `Iskandarov Fayozbek`) |
| `ADMIN_USERNAME` | Use a specific handle instead of generating one |
| `ADMIN_PASSWORD` | Use a specific password (must be ≥16 characters) |

The generated username is the name plus a random tail (`f.iskandarov.k3m9x`)
rather than a bare surname: a guessable admin handle is half of a brute-force
attempt.

**Rotation.** Re-running the script replaces the password and revokes every live
admin session. The same is available in the UI at `/admin` → change password,
which also signs the current session out. Rotate:

- on any suspicion of exposure,
- when a person with access leaves,
- on a schedule your policy defines.

There is no password-recovery flow for this account by design. If it is lost,
run the script again from a host with database access.

---

## 11. Subscription jobs

One daily job keeps subscription state and reminders moving:

```bash
npm run subscriptions:remind
```

It rolls every centre through the trial → payment due → grace → suspended
ladder and sends the 7 / 3 / 1 / 0-day warnings. Both halves are idempotent, so
running it twice in a day changes nothing and sends nothing twice.

Missing a run is not harmful: statuses are also evaluated whenever a
subscription is read, so a centre is never in a stale state for longer than one
request. The job exists so that *reminders* go out on time.

A systemd timer:

```ini
# /etc/systemd/system/oquv-markaz-subscriptions.timer
[Unit]
Description=O'quv Markaz subscription maintenance

[Timer]
OnCalendar=*-*-* 06:00:00 Asia/Tashkent
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/oquv-markaz-subscriptions.service
[Unit]
Description=O'quv Markaz subscription maintenance

[Service]
Type=oneshot
WorkingDirectory=/srv/oquv-markaz
EnvironmentFile=/srv/oquv-markaz/.env
ExecStart=/usr/bin/npm run subscriptions:remind
User=oquv
```

---

## 12. Pricing configuration

Price, trial length and grace period are **not** environment variables and not
constants. They live in `platform_settings` and are edited at `/admin/pricing`.

Defaults on a fresh installation:

| Key | Default |
|---|---|
| `monthly_price_minor` | `300000` (UZS has no subunit, so this is 300 000 so'm) |
| `currency` | `UZS` |
| `trial_days` | `30` |
| `grace_period_days` | `7` |

Changing the price affects new centres and renewals. Existing subscriptions keep
the `amountMinor` snapshotted on their own row, so a live customer is never
silently re-priced.

---

## 13. Settling a centre without a payment provider

Until Payme or Click credentials are configured, `PAYMENT_PROVIDER=manual` is
used. That provider never reports success — a stub that faked one would let any
centre self-upgrade.

To settle a centre that paid by transfer:

1. Sign in at `/admin/login`.
2. Open `/admin/centers/<id>`.
3. **Record an offline payment**, entering the amount and the bank reference.

The term is extended by `applySuccessfulPayment`, exactly as a verified webhook
would, and the action is written to the audit log with the admin's id and the
reference supplied. This is the only path that extends a subscription without a
signed provider event, and it is available to platform staff only.
