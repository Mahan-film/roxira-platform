# Telegram off-site database backup (tier 4)

A daily, encrypted copy of the production Postgres databases delivered as files to the owner's
Telegram bot chat. It is the fourth and **last-resort convenience tier**: the primary DR copy is
the restic set on srv1 (+ the owner's Mac pull), then the Neon restore, then the age-encrypted
e-mail bundle. Telegram is small, convenient and easy to download on a phone, but it is **not**
the primary backup and must never be relied on alone.

Script: `scripts/ops/backup/telegram_offsite.sh`
Units: `roxira-telegram-offsite.service` / `roxira-telegram-offsite.timer` (daily **04:15 UTC**,
`Persistent=true`, `Nice=10`).

## What it does

1. `pg_dump -Fc` inside the `roxira_postgres_prod` container (`docker exec`, no host port) for every
   non-template database (`TELEGRAM_BACKUP_DBS` overrides the list). Compression is built into `-Fc`.
2. Verifies each dump with `pg_restore -l`, then tars the dumps (already compressed, no extra
   compression) and encrypts the tarball with `age -R /etc/roxira-backup-age.pub` to the owner's
   public key. **If the recipient file is missing the run refuses**: an unencrypted dump is never
   sent. The private key exists only on the owner's Mac.
3. Splits the encrypted file into numbered 45 MB parts (`split -b 45m`).
4. Sends each part with the Bot API `sendDocument` using `curl --fail` and retries. The token/chat
   come from the same env the notify bot uses (`NOTIFY_BOT_TOKEN` / `NOTIFY_CHAT_ID`, optional
   `NOTIFY_BOT_API`); `TELEGRAM_BACKUP_CHAT_ID` overrides the chat. The token is never printed.
5. Appends one line (date, size, sha256, ok/fail) to `/root/deploy-state/telegram-backup.log` and
   alerts the owner via `scripts/ops/notify/notify.py` on failure.

Temp files live in a `mktemp` dir removed by a trap; nothing is kept on disk.

### Env (names only; values never printed)

| Name | Default | Meaning |
|---|---|---|
| `NOTIFY_BOT_TOKEN` | — | bot token (same as the notify bot) |
| `NOTIFY_CHAT_ID` | — | owner chat id (same as the notify bot) |
| `NOTIFY_BOT_API` | `https://api.telegram.org` | API base (Bale: `https://tapi.bale.ai`) |
| `TELEGRAM_BACKUP_CHAT_ID` | `NOTIFY_CHAT_ID` | optional separate chat for the backups |
| `TELEGRAM_BACKUP_DBS` | all non-template DBs | optional space-separated database list |
| `TELEGRAM_PG_CONTAINER` | `roxira_postgres_prod` | source container |
| `TELEGRAM_AGE_RECIPIENTS_FILE` | `/etc/roxira-backup-age.pub` | public age recipients file |
| `TELEGRAM_PART_MB` | `45` | part size in MB |
| `TELEGRAM_BACKUP_LOG` | `/root/deploy-state/telegram-backup.log` | local log line |

## Install (on the production server, once)

```bash
install -m 644 scripts/ops/backup/roxira-telegram-offsite.service /etc/systemd/system/
install -m 644 scripts/ops/backup/roxira-telegram-offsite.timer   /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now roxira-telegram-offsite.timer
systemctl start roxira-telegram-offsite.service          # first run
journalctl -u roxira-telegram-offsite -n 60 --no-pager
```

`TELEGRAM_BACKUP_CHAT_ID` (optional) and the `NOTIFY_*` names are set with
`scripts/ops/set_server_env.sh` (hidden input). Ensure `/etc/roxira-backup-age.pub` exists (it does
when the DR e-mail bundle works). `--dry-run` prints the plan and touches nothing.

## Restore on the Mac

1. In the bot chat, download every `part-NNN` document of the same backup into one folder, e.g.
   `~/restore-tg/`. The caption of every part carries the date, host, `part i/n`, size and the
   **sha256 of the full encrypted file**.
2. Rebuild and verify the encrypted file (parts are zero-padded, so filename order is byte order):

   ```bash
   cd ~/restore-tg
   cat part-* > roxira-pg-<stamp>.tar.age
   shasum -a 256 roxira-pg-<stamp>.tar.age        # must equal the caption's sha256
   ```

3. Decrypt with the private key (only on the Mac) and unpack:

   ```bash
   age -d -i ~/Secrets/roxira/backup-age.key roxira-pg-<stamp>.tar.age | tar -xf - -C ~/restore-tg/
   ```

   The dumps, one per database, land as `~/restore-tg/<db>.dump`.

4. Restore each one (this writes data — point it at the right database):

   ```bash
   # on a host/container with the matching Postgres version and pg_restore:
   pg_restore --clean --if-exists --no-owner --no-acl -d <db> ~/restore-tg/<db>.dump
   # or against the production container (only when you really mean it):
   docker exec -i roxira_postgres_prod pg_restore -U <user> -d <db> --clean --if-exists < ~/restore-tg/<db>.dump
   ```

## Limits

- **Bot API file limit is 50 MB per document**; parts are 45 MB to stay under it. A large database
  set means more parts and more messages (Telegram may rate-limit the bot for many quick sends).
- Telegram retention/availability is outside our control: treat it as a **convenience tier**, not
  the primary copy. The server never keeps the plaintext or the encrypted file on disk.
- Restoring needs `age` and the private key `backup-age.key`; without it the parts are useless
  (and that is by design). If a backup is needed, use the restic set first (`DISASTER_RECOVERY.md`).

## Tests

Offline, no docker/network/real secrets: `cd scripts/ops/backup && python3 -m unittest test_offsite -v`
(dry-run plan, the never-send-unencrypted guard and token redaction). Shell lint:
`shellcheck -x scripts/ops/backup/telegram_offsite.sh`.
