# Owner control bot (`scripts/ops/notify/`)

A single, owner-only bot for alerts, status and two approvals. Telegram and Bale
expose the same bot API (`https://api.telegram.org/bot<TOKEN>/<method>` and
`https://tapi.bale.ai/bot<TOKEN>/<method>`), so one implementation serves both.
Python 3 standard library only (`urllib`), no new dependencies.

## Parts

- `notify.py` — one-way sender: `send(text, buttons=None)` and the CLI
  `python3 notify.py "text"`. Reads `NOTIFY_BOT_TOKEN`, `NOTIFY_CHAT_ID` and
  `NOTIFY_BOT_API` from the server `.env`. If the token or chat id is missing the
  feature is **off**: it exits 0 silently. 10 s timeout, never raises into callers,
  and scrubs tokens/phones/e-mails/IPs before sending.
- `control_bot.py` — long-poll `getUpdates` loop (timeout 50, offset kept in
  `/root/deploy-state/notify_offset.json`). It only answers the single owner chat
  (`NOTIFY_CHAT_ID`); every other chat is ignored with a one-line warning. It never
  runs shell text taken from a message and never echoes environment values.
- `install.sh` / `roxira-control-bot.service` — install the bot as a root systemd
  service (`Restart=always`, `WorkingDirectory=/opt/roxira_platform`).
- `tests/test_notify.py` — offline tests (fake HTTP, no network).

Hooks that feed the bot (best effort, never change exit codes): monitor alert e-mails
(`monitor_common.send_email`), the autodeploy result, and the end of each server-agent run.

## Commands

| Command | Action |
|---|---|
| `/status` | Last autodeploy (time, short target sha, result), docker health of `roxira_app_prod`, `roxira_enterprise_backend`, `roxira_enterprise_frontend`, `roxira_keypool`, running `run_task.sh` agent slugs, and whether `.deploy-freeze` exists. |
| `/freeze` | Inline buttons `[✅ تأیید] [❌ لغو]`; on confirm `touch /opt/roxira_platform/.deploy-freeze`. |
| `/unfreeze` | Same confirmation; on confirm `rm -f` that file. |
| `/cost` | Runs `scripts/infra/key_pool/cost_report.py --today --short` when present; replies with its stdout (first 3500 chars). |
| `/help` | Lists the commands. |

## Create the bot and get the chat id

1. Telegram: open **@BotFather**, send `/newbot`, follow the prompts, copy the token.
   Bale: open **@botfather** inside Bale and do the same.
2. Send the new bot a message (for example `/start`) from your own account, so the
   bot has a chat to answer.
3. Get your chat id. The simplest way: open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` (Bale: replace the host with
   `https://tapi.bale.ai`) after messaging the bot and read `result[].message.chat.id`.
   Alternatively message **@userinfobot**. Prefer a private chat id; group ids are
   negative and the bot will happily use them if you set one.

## Configure (on the server)

Values are stored in `/opt/roxira_platform/.env` without ever printing them:

```bash
scripts/ops/set_server_env.sh NOTIFY_BOT_TOKEN        # paste the token (hidden) + --replace
scripts/ops/set_server_env.sh NOTIFY_CHAT_ID          # numeric chat id
scripts/ops/set_server_env.sh NOTIFY_BOT_API          # optional: https://tapi.bale.ai for Bale
```

`NOTIFY_BOT_API` may be left unset; the default is `https://api.telegram.org`.

## Install / enable

```bash
scripts/ops/notify/install.sh           # dry-run: prints what it would do
scripts/ops/notify/install.sh --apply    # install the unit, enable + start the service
```

Check with `systemctl status roxira-control-bot` and `journalctl -u roxira-control-bot`.
To turn the bot off, `set_server_env.sh` the empty/`--replace` values away or
`systemctl disable --now roxira-control-bot`.

Run the tests locally:

```bash
python3 -m pytest -q scripts/ops/notify/tests/
```

## بخش فارسی (برای مالک)

- ربات را با **@BotFather** در تلگرام یا **@botfather** در بله بسازید و توکن را بگیرید.
- به ربات یک پیام بدهید، سپس شناسهٔ گفتگو (`chat.id`) را از `getUpdates` یا **@userinfobot** بردارید.
- روی سرور، مقادیر را با `scripts/ops/set_server_env.sh` ذخیره کنید:
  `NOTIFY_BOT_TOKEN`، `NOTIFY_CHAT_ID` و در صورت بله `NOTIFY_BOT_API=https://tapi.bale.ai`.
- نصب: `scripts/ops/notify/install.sh` (فقط نمایش) و سپس `scripts/ops/notify/install.sh --apply`.
- دستورها: `/status` وضعیت، `/freeze` توقف استقرار خودکار، `/unfreeze` فعالکردن آن،
  `/cost` هزینهٔ امروز و `/help` راهنما. فقط پیامهای گفتگوی خودتان پردازش میشوند.