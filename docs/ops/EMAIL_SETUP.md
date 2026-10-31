# E-mail sign-in: SMTP setup

Smart Judge accepts e-mail + password accounts (for users without an Iranian SIM). The
verification and password-reset mails are sent over SMTP by `email_sender.py` (stdlib smtplib).
Until SMTP is configured the e-mail endpoints answer 503 and the login modal hides the «ایمیل» tab
(`GET /api/v1/apps/judge/auth/methods` returns `{"phone": true, "email": false}`).

Default path: a **self-hosted, send-only relay** (open source, no third-party account). Brevo or
another provider is only an optional fallback (last section).

## Self-hosted relay (default)

Container `roxira_mail` (Postfix + OpenDKIM, image `boky/postfix:5.1.0`), files in `services/mail/`:

- `docker-compose.mail.yml`: sends for `ghazihoushmand.ir`, `roxira.ir` and `roxira.net`, HELO `mail.ghazihoushmand.ir`,
  DKIM selector `rx1`. **No host port is published** (AGENTS.md section 7): it is reachable only on the app's
  docker network as `roxira_mail:25`, and Postfix trusts only the private docker ranges, so no login is needed.
  It does not receive mail.
- `install.sh`: dry-run by default, `--apply` generates 2048-bit DKIM keys for those three domains (only the missing ones, once, in
  `/var/lib/roxira-mail/dkim`, mode 600, never in git), starts the container and prints the DNS records and `.env` values.
- `send_test.py`: sends one test mail through the relay.

### Steps (hub, on srv1; DNS and rDNS are owner actions)

```bash
cd /opt/roxira_platform && git pull --ff-only
bash services/mail/install.sh              # dry-run: preconditions and plan
bash services/mail/install.sh --apply      # keys, container, then prints the exact DNS records
```

1. **DNS**. Live state checked 2026-10-31: all three domains (`ghazihoushmand.ir`, `roxira.ir`, `roxira.net`)
   already have Cloudflare Email Routing MX records, an SPF record, a DKIM TXT at selector `rx1`
   (`rx1._domainkey.<domain>`) and DMARC `p=none`. **No DNS work is needed.** Do not add a second SPF record
   (two make both invalid); if SPF ever needs `ip4:91.107.248.99`, merge it into the existing record.
   - Inbound mail is handled by Cloudflare Email Routing (the MX records). `roxira_mail` is send-only and never receives mail.
   - **DKIM key must match the published record.** The relay signs with `/var/lib/roxira-mail/dkim/<domain>.private`
     (key file name = domain, selector `rx1`). `install.sh` only creates a key when the file is missing, and a newly
     generated key does not match the TXT already in DNS. Before `--apply`, check `ls /var/lib/roxira-mail/dkim`
     for all three `.private` files. If one is missing (in particular `roxira.net`, which `install.sh` did not cover
     before 2026-10-31), recover the original key from backup rather than regenerating, or publish the new public
     key the script prints (replacing the old `rx1` TXT) as an owner DNS action.
   - Later DMARC step (owner decision, not done): move `p=none` to `quarantine` once `rua` reports show clean alignment.
   - **Host**: A `mail.ghazihoushmand.ir` -> `91.107.248.99` (DNS only, not proxied by Cloudflare) is the HELO name.
2. **Reverse DNS** (Hetzner Cloud console > Servers > srv1 > Networking > the IPv4 > Edit reverse DNS):
   `91.107.248.99` -> `mail.ghazihoushmand.ir`. Must match the A record above (forward-confirmed).
3. Server `.env` (never in git), then restart the app container (needs the owner's OK):

| Variable | Value |
|---|---|
| `SMTP_HOST` | `roxira_mail` |
| `SMTP_PORT` | `25` |
| `SMTP_USER` | empty (no login, no STARTTLS inside the private network) |
| `SMTP_PASSWORD` | empty |
| `SMTP_FROM` | `قاضی هوشمند <no-reply@ghazihoushmand.ir>` |

4. Test: `docker exec -i -e SMTP_HOST=roxira_mail -e SMTP_PORT=25 -e SMTP_FROM='no-reply@ghazihoushmand.ir' roxira_app_prod python3 - you@example.com < services/mail/send_test.py`
   then `docker logs --tail 30 roxira_mail` (look for `status=sent`, or the remote refusal text).
5. Verify DNS: `dig +short TXT rx1._domainkey.ghazihoushmand.ir` (and `.roxira.ir`, `.roxira.net`), `dig +short -x 91.107.248.99`,
   and send a mail to the address shown at <https://www.mail-tester.com> (aim for 9/10 or better; it reports SPF, DKIM, DMARC, rDNS).

### Deliverability notes

- A new IP has no reputation. **Warm up**: start with a handful of real sign-ups per day and grow over 2-4 weeks;
  never blast a list. Gmail/Outlook may spam-folder the first mails; asking the user to mark "not spam" helps.
- rDNS, forward A record, HELO name and SPF/DKIM/DMARC must all agree on `mail.ghazihoushmand.ir` / the domains.
  Without rDNS many providers reject outright.
- Check the IP on public blocklists (<https://mxtoolbox.com/blacklists.aspx>, Spamhaus lookup). Hetzner ranges
  sometimes carry old listings; if listed, delist or fall back to a provider relay.
- Keep sending transactional only (verify, reset). Low bounce rate; watch `docker logs roxira_mail` for `status=bounced/deferred`.
- Iranian/CDN note: do not proxy `mail.` through Cloudflare. Keep DMARC `rua=` reports on during warm-up.
- Back up `/var/lib/roxira-mail/dkim` (losing it only means regenerating keys and updating DNS).

## Optional fallback: a provider relay (Brevo)

If the IP stays blocklisted or Gmail keeps rejecting, use a provider relay instead. Brevo (EU, free
300 mails/day), Mailjet (200/day) and SMTP2GO (1000/month) work. Create the account yourself; the key
goes only into the server env.

1. Brevo > Senders, Domains & dedicated IPs > Domains > add `ghazihoushmand.ir`; add the DNS records it shows
   (merge SPF: `v=spf1 ip4:91.107.248.99 include:spf.brevo.com -all`; its DKIM records; the `brevo-code` TXT).
2. Brevo > SMTP & API > SMTP: note the login and generate an SMTP key.
3. `.env`: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<login>`, `SMTP_PASSWORD=<key>`,
   same `SMTP_FROM`. With a non-empty `SMTP_USER` the sender uses STARTTLS and login automatically
   (`SMTP_STARTTLS=0|1` overrides; port 465 uses implicit TLS).

## Common

`JWT_SECRET` must also be set and stable (verification/reset links are signed with a key
derived from it; without it every restart invalidates all pending links and tokens).
Optional tuning: `EMAIL_AUTH_IP_LIMIT_PER_HOUR` (20), `EMAIL_LOGIN_IP_LIMIT_PER_HOUR` (30),
`EMAIL_LOGIN_LIMIT_PER_HOUR` (10 attempts per address). Restarting the app container is a
separate step that needs the owner's OK.

Smoke test after setting it: `curl https://ghazihoushmand.ir/api/v1/apps/judge/auth/methods`
should return `"email": true`; then register with a real mailbox from the login modal.

## How it works (for the next developer)

- Header safety: `email_sender.send_email` refuses a recipient or subject containing CR/LF/NUL or more than one
  plain address (header injection), on top of `EmailMessage` refusing newlines in header values. The Next.js
  mailers use `lib/mail-safe.ts` (`headerText`, `escapeHtml`); `provision-sandbox` only mails an address that
  passed its anchored `EMAIL_RE`.
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
