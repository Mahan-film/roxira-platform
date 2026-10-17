# E-mail sign-in: SMTP setup

Smart Judge accepts e-mail + password accounts (for users without an Iranian SIM). The
verification and password-reset mails are sent over plain SMTP (STARTTLS). Until SMTP is
configured the e-mail endpoints answer 503 and the login modal hides the «ایمیل» tab
(`GET /api/v1/apps/judge/auth/methods` returns `{"phone": true, "email": false}`).

## Provider (owner action)

Recommended: **Brevo** (EU, free plan 300 mails/day, SMTP relay included). Alternatives
with a free tier: Mailjet (EU, 200/day), SMTP2GO (1000/month). Create the account yourself;
the key stays in your hands and goes only into the server env.

1. Brevo > Senders, Domains & dedicated IPs > Domains > add `ghazihoushmand.ir`.
2. Add the DNS records Brevo shows, at the DNS host of `ghazihoushmand.ir`:
   - **SPF**: a single TXT on the root. If one already exists, merge, never add a second.
     Example: `v=spf1 include:spf.brevo.com ~all` (add other providers' includes to the same line).
   - **DKIM**: the CNAME/TXT record(s) Brevo gives (`brevo1._domainkey`, `brevo2._domainkey`, or one TXT).
   - **Brevo code**: the `brevo-code:...` TXT used to verify domain ownership.
   - **DMARC**: already set by the owner; keep `rua=` reports on for the first weeks.
3. Wait until Brevo shows the domain as authenticated (usually minutes, up to 24 h).
4. Brevo > SMTP & API > SMTP: note the server, port 587, the login, and generate an SMTP key.

## Environment variables (server `.env`, never in git)

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` (STARTTLS; `465` uses implicit TLS) |
| `SMTP_USER` | the SMTP login Brevo shows |
| `SMTP_PASSWORD` | the SMTP key (a secret) |
| `SMTP_FROM` | `قاضی هوشمند <no-reply@ghazihoushmand.ir>` |

`JWT_SECRET` must also be set and stable (verification/reset links are signed with a key
derived from it; without it every restart invalidates all pending links and tokens).
Optional tuning: `EMAIL_AUTH_IP_LIMIT_PER_HOUR` (20), `EMAIL_LOGIN_IP_LIMIT_PER_HOUR` (30),
`EMAIL_LOGIN_LIMIT_PER_HOUR` (10 attempts per address). Restarting the app container is a
separate step that needs the owner's OK.

Smoke test after setting it: `curl https://ghazihoushmand.ir/api/v1/apps/judge/auth/methods`
should return `"email": true`; then register with a real mailbox from the login modal.

## How it works (for the next developer)

- Code: `output_apps/generated_modules/smartjudge/email_auth.py` (accounts, tokens, endpoints),
  `email_sender.py` (smtplib + templates). Routes, under `/api/v1/apps/judge/auth/`:
  `methods` (GET), `email/register`, `email/verify-email`, `email/resend-verification`,
  `email/login`, `email/forgot-password`, `email/reset-password`.
- Table `email_accounts` (created with `CREATE TABLE IF NOT EXISTS` on first use, same convention
  as `payment_orders`): `user_ref` PK (owner key), `tenant` (default `smartjudge`), unique
  `email`, `password_hash` (scrypt, stdlib; argon2/bcrypt are not installed), `email_verified_at`,
  `contact_phone` (unverified), timestamps. No client-supplied tenant or user id is ever trusted:
  the JWT `sub` is the only identity.
- **Entitlement key**: an e-mail user's `user_ref` is `em_` + 16 random hex (19 chars, because
  `chat_conversations.user_phone` is VARCHAR(20)). It travels as the JWT `sub` (claim `auth: "email"`)
  and takes the slot where a phone normally is, so `_hashed_user_ref(user_ref)` is the single
  `user_entitlements` key and plans, payments, conversations and case files work unchanged.
  A phone typed at registration is only stored as a contact detail and never becomes the key, so
  adding a phone later cannot create a second entitlement row. Linking an existing phone-OTP
  account to an e-mail account (to share one plan) is NOT implemented.
- Tokens: stateless HMAC-signed. Verify link 24 h, reset link 1 h. Single use is enforced by state,
  not a table: a verify token only works while `email_verified_at IS NULL`; a reset token embeds a
  fingerprint of the current password hash, so it dies after the password changes.
- No enumeration: register/resend/forgot always return the same success text; wrong password and
  unknown e-mail both give 401; mails are sent from a background task so timing does not leak.
  Registering an address that already exists never modifies that account (it re-sends the
  verification link, or an "already registered" notice if verified). A reset also marks the address
  verified, which wipes any password planted on an unverified account.
- Rate limits reuse `chat_auth` (Redis when configured, else in-process): per-IP hourly caps on every
  endpoint, per-address login cap, and a 60 s cooldown + 5/hour cap on mails per address and kind.
