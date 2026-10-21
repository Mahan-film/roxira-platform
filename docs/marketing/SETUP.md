# Marketing engine (F6) - setup

Code: `scripts/marketing/` (stdlib Python, runs on the server as root). Brand profiles:
`config/marketing/<brand>.yaml`. State: SQLite `/var/lib/roxira-marketing/marketing.db`. Images:
`/var/lib/roxira-marketing/media/`.

## Flow

```
mkt.py plan <brand> --week      # LLM drafts from real source items; claim check; status=draft
mkt.py propose <brand>          # each draft -> owner bot with [approve][reject]; status=proposed
   (owner presses a button)     # control_bot -> mkt.py approve|reject <id>; status=approved|rejected
mkt.py publish-due [--dry-run]  # timer every 15 min; only status=approved and due; status=published
mkt.py inbox <brand>            # new comments -> drafted replies -> bot [send reply][reject]
```

Nothing is published without an approval click. `touch /var/lib/roxira-marketing/PAUSE` stops all
publishing at once.

## Timers

`scripts/marketing/install.sh` installs the units (dry-run by default; add `--apply` to install and
enable them):

- `roxira-marketing-publish.timer` - every 15 min, publishes owner-approved posts/replies that are due.
- `roxira-marketing-plan.timer` - every Thursday 08:00 UTC, runs the weekly content cycle:
  `mkt.py plan ghazihoushmand --week` (draft next week's posts) and then
  `mkt.py propose ghazihoushmand --platform telegram`, which sends only the Telegram drafts to the
  owner bot. Re-running is idempotent: a week that already has drafts is not planned again, so a
  duplicate timer run never duplicates drafts.

## Environment

Put tokens in `/etc/roxira-marketing.env` (root, chmod 600), never in the repo. The key pool key
`KEYPOOL_MASTER_KEY` is read from `/opt/roxira_platform/.env` as for the other factory tools. The
weekly plan service also needs `KEYPOOL_MASTER_KEY` for the text model and the owner bot's
`NOTIFY_*` for `propose`; both are read from `/opt/roxira_platform/.env` (`/etc/roxira-marketing.env`
stays optional and can override e.g. `MKT_MODEL_GROUP`).

| Variable | Meaning |
| --- | --- |
| `MKT_MODEL_GROUP` | key-pool model group for text (default `agent-strong-free`) |
| `MKT_IMAGE_GROUP` | key-pool group for images; empty = branded text card (Pillow) or no image |
| `MKT_DB`, `MKT_MEDIA_DIR` | override state paths |
| `IG_ACCESS_TOKEN`, `IG_USER_ID` | Instagram (business account) |
| `FB_PAGE_TOKEN`, `FB_PAGE_ID` | Facebook Page |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` (`LINKEDIN_API_VERSION`, default 202510) | LinkedIn |
| `X_ACCESS_TOKEN` | X API v2, OAuth 2.0 user-context token with `tweet.write` |
| `TELEGRAM_CHANNEL_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID` | Telegram channel (a separate bot from the owner control bot) |

A platform without its variables is skipped (posts stay `approved`, nothing fails).

## Accounts the owner must create

1. **Meta (Instagram + Facebook)**: a Facebook Page, an Instagram Professional (Business) account
   linked to it, a Meta Business portfolio, a developer app at developers.facebook.com. Permissions:
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `pages_manage_posts`,
   `pages_read_engagement`, `pages_manage_engagement`. Posting to your own account needs no app review
   while you are an app admin/tester; a long-lived Page token is generated from the Graph API Explorer.
   Instagram requires a **public https image URL** (serve `/var/lib/roxira-marketing/media/` from nginx).
2. **LinkedIn**: a Company Page, a developer app at linkedin.com/developers with the "Share on
   LinkedIn" / Community Management product (organization posting needs `w_organization_social`;
   Community Management approval can take days). Author URN `urn:li:organization:<id>`.
3. **X**: developer account, a project/app with OAuth 2.0 user context, scope `tweet.write
   tweet.read users.read offline.access`. Free tier is write-only and small (about 500 posts/month);
   reading replies needs a paid tier, so `inbox` returns nothing for X on free.
4. **Telegram**: a channel, a new bot from @BotFather added as channel admin with "post messages".
5. **Nginx** (document only): an `alias` location such as `/media/marketing/` ->
   `/var/lib/roxira-marketing/media/`, matching `media_base_url` in the brand file.

## Rules we follow

- Only our own, real, disclosed brand accounts. No fake accounts, no bought engagement, no scraping.
- No mass DMs and no unsolicited messages. Replies only to comments on our own posts, each one
  approved by the owner. DMs are not implemented (Meta allows them only inside the 24h window via
  webhooks).
- Every number/law reference in a draft must appear in the source guide (automatic check); banned
  claims per brand (never promise legal outcomes, never replace a lawyer).
- AI disclosure: add the platform's "AI-generated" label to generated images where the platform
  provides one (Meta/LinkedIn do); the owner sees every image prompt before approving.
- Rate limits: conservative caps per platform per 24h (IG 20, FB 20, LinkedIn 20, X 12, Telegram
  20), a minimum gap between calls, HTTP 429 -> retry in 1h. Meta's own limit is 100 API posts/24h.
- Iranian platform note: Instagram/X/LinkedIn are filtered inside Iran; the server posts from
  outside Iran. Telegram works for both.

## خلاصه به فارسی

1. برای اینستاگرام و فیسبوک: یک صفحهٔ فیسبوک، حساب حرفه‌ای اینستاگرام متصل به آن و یک اپ در
   developers.facebook.com بسازید؛ توکن بلندمدت صفحه و شناسهٔ حساب را در فایل
   `/etc/roxira-marketing.env` بگذارید (نه داخل مخزن).
2. لینکدین: صفحهٔ شرکت و اپ توسعه‌دهنده؛ تأیید Community Management ممکن است چند روز طول بکشد.
3. ایکس: حساب توسعه‌دهنده با OAuth 2.0؛ پلن رایگان فقط انتشار محدود دارد و خواندن کامنت‌ها پولی است.
4. تلگرام: یک کانال و یک ربات جدید از @BotFather (جدا از ربات کنترل) که ادمین کانال باشد.
5. هیچ پستی بدون زدن دکمهٔ «تأیید» منتشر نمی‌شود؛ برای توقف کامل فایل
   `/var/lib/roxira-marketing/PAUSE` را بسازید.
6. قوانین ما: فقط حساب‌های واقعی خودمان، بدون حساب جعلی، بدون پیام انبوه و بدون اسکرپ؛ هر عدد یا
   مادهٔ قانونی در متن باید در راهنمای منبع باشد؛ هیچ وعدهٔ نتیجهٔ حقوقی داده نمی‌شود.
