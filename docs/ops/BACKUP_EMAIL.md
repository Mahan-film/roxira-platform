# Backup e-mail reports and offsite-by-email

**مقدمه (فارسی):** هر روز یک ایمیل گزارش با دو فایل پیوست می‌رسد: `backup-report-<date>.md` (خلاصه خوانا) و
`manifest-<date>.json` (ماشین‌خوان). اگر حالت offsite روشن باشد، داده‌های مهم (دامپ Postgres، فایل‌های env و
تنظیمات، JSONL حقوقی) با کلید عمومی age رمز می‌شوند و در چند قطعه (هر قطعه یک ایمیل، حداکثر ۱۷ مگابایت)
ارسال می‌شوند. هیچ داده‌ی رمزنشده‌ای هرگز ایمیل نمی‌شود. برای بازیابی: همه‌ی پیوست‌ها را در یک پوشه بریزید و
`restore_from_email.sh` را اجرا کنید. کلید خصوصی `backup-age.key` فقط روی مک شماست؛ بدون آن بازیابی ممکن نیست.

## Recommended format

- Report: **Markdown** (`.md`, readable in Gmail preview and any editor) plus **JSON** manifest.
- Data: one **age-encrypted tar.gz** split into raw byte parts `*.tar.age.partNN` (one part per mail), each with its
  SHA-256 in `offsite-manifest-<date>.json`. A single stream is better than many small encrypted files: one
  checksum, one decrypt. Parts are plain binary slices, so `cat part* > file` rebuilds them.

## What is sent

| Mail | Attachments | Plaintext? |
|---|---|---|
| Daily report | `backup-report-<date>.md`, `manifest-<date>.json` | yes: status, sizes, checksums, timings; no secrets/PII |
| Offsite part k/N | `roxira-offsite-<date>.tar.age.partKK`, `offsite-manifest-<date>.json` | data is age-encrypted; the file is refused if it lacks the age header |

Payload: latest `pg/` dumps (all DBs + globals), `.env` files, compose and nginx configs, `/etc/roxira/backup.env`,
plus `BACKUP_EMAIL_EXTRA_PATHS` (put the staged legal-corpus JSONL directory there). Note that `.env` files are
secrets: they are only mailed encrypted. Without `BACKUP_AGE_RECIPIENT` nothing is sent.

## Limits and caps

Gmail: 25 MB per message after base64 (+37 %), about 500 mails/day. Defaults: 17 MB raw per part,
`BACKUP_EMAIL_MAX_MAILS=10` per run, `BACKUP_EMAIL_MAX_DAY_MB=150` per UTC day (counted in
`/var/lib/roxira-backup/email_day.json`). If the encrypted payload needs more than the cap, **no data parts are sent**
(a partial age stream cannot be decrypted, so truncating would only waste quota) and the report states
`OVER_CAP` with the reason. Raise the caps or trim `BACKUP_EMAIL_EXTRA_PATHS`. Typical use: `weekly`
(mail count about 10 per week) rather than `daily`.

## Configure (server, owner approves)

In `/etc/roxira/backup.env` (names only here):
`BACKUP_EMAIL_OFFSITE=weekly`, `BACKUP_EMAIL_EXTRA_PATHS="<corpus staged dir>"`. The existing
`roxira-backup-dr-report.timer` (06:30 UTC) triggers it; no new unit is needed.
Test now (one run, uses mail quota): `FORCE_OFFSITE=1 /opt/roxira_platform/scripts/ops/backup/server_backup.sh report`.
Dry run (sends nothing): add `--dry-run`.

## Restore

1. Save all attachments (parts + `offsite-manifest-*.json`) into one folder, e.g. `~/restore-2026-10-12/`.
2. `scripts/ops/backup/restore_from_email.sh --dir ~/restore-2026-10-12 --key ~/Secrets/backup-age.key --out ~/restored`
   - verifies each part's SHA-256 and the joined file, then runs `age -d | tar -xz`.
3. It prints the `pg_restore` commands; it never touches a live database itself.

Manual equivalent: `cat roxira-offsite-*.tar.age.part* > p.tar.age; sha256sum p.tar.age` (compare with the manifest),
then `age -d -i backup-age.key p.tar.age | tar -xz -C out`.

## Tests

`python3 -m pytest scripts/ops/backup/test_backup_email.py -q` (offline, mocked SMTP). Never run pytest over `src/`.
