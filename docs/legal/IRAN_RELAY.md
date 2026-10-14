# Iran relay: official legal texts from an Iranian IP

The government sites we want (`regulation.tax.gov.ir`, `dotic.ir`, `rc.majlis.ir`) refuse foreign
server IPs. So this collector runs on the **owner's Mac**, on an Iranian connection, and publishes
what it finds as a **GitHub PR**. It is a companion to `scripts/legal/law_watch.py` (ekhtebar.ir /
nezamat.ir) and follows the same rules: stdlib only, polite fetching, state outside the repo,
staged output as a new file per day, and everything `proposed` until a human/hub approves it.

Nothing is published to production by this job. It only opens a PR. A change reaches the corpus
only after the hub merges that PR **and** a later collection build/eval approves it.

## Pieces

| path | what it does |
|---|---|
| `scripts/legal/iran_relay.py` | `run`: fetch new documents from every reachable source, append rows to `data/legal/staged/iran_relay_<YYYY-MM-DD>.jsonl` |
| `scripts/legal/relay_publish.sh [checkout]` | commit only the staged `law_watch_*.jsonl` / `iran_relay_*.jsonl` files on a `relay/<stamp>` branch and open a PR (default checkout `~/Developer/roxira-lawwatch`) |
| `scripts/legal/relay/ir.roxira.iranrelay.plist.template` | launchd agent, `StartInterval` 43200 (12 h): runs `iran_relay.py run` then `relay_publish.sh` |
| `scripts/legal/relay/install_mac.sh` | renders/installs the agent (dry-run by default; `--yes` installs and loads) |
| `config/iran_relay.json` | `rc_law_ids`: the list of `rc.majlis.ir/fa/law/show/<id>` ids to fetch (empty by default; add ids over time) |
| `scripts/legal/split_rc_law_articles.py` | split the FULL `rcmajlis` relay rows into one staged row per article (see below) |
| `scripts/legal/tests/test_iran_relay.py` | offline tests (fixtures + monkeypatched fetch, no network) |
| `scripts/legal/tests/test_split_rc_law_articles.py` | offline tests for the article splitter (inline fixture, no network) |

## Sources (all allow crawling in robots.txt)

* **taxreg** — `regulation.tax.gov.ir` list pages `lws3?act=last_nz|last_ry|last_mq|usable_*` and
  document pages `lwvi?lid=<id>&ty=<ty>`.
* **dotic** — `https://dotic.ir/view/sitemap.php?page=N`; news pages whose slug names a rule
  (بخشنامه / آیین‌نامه / دستورالعمل / تصویب‌نامه / مصوبه / قانون).
* **rcmajlis** — `https://rc.majlis.ir/fa/law/show/<id>` for the ids configured in
  `config/iran_relay.json` (`rc_law_ids`).

`qavanin.ir` is **excluded**: it sits behind an ArvanCloud JavaScript challenge.

**Never solve a bot challenge.** If a source answers with a non-200 or a challenge page (including
`"Transferring to the website"` or a captcha gate), it is logged and skipped for that run, and the
program exits 0.

## Politeness and state

* One request every 3 s, 25 s timeout, identifying User-Agent
  `Mozilla/5.0 (RoxiraLegalRelay; contact info@roxira.ir)`.
* At most 40 new documents per source per run.
* Seen ids/urls and run metadata live in `~/.roxira/iran_relay/state.json` (outside the repo), so a
  re-run never re-fetches the same document.
* Output is **append-only** to `data/legal/staged/iran_relay_<YYYY-MM-DD>.jsonl` (a new file each
  day; existing files are never rewritten).

Each row has: `source` (`taxreg`/`dotic`/`rcmajlis`), `source_tier` (`official`), `url`, `doc_id`,
`title`, `doc_type` (`circular`/`bylaw`/`law`/`ruling`/`other`), `number`, `date`, `issuer`, `text`
(cleaned plain text, Persian digits kept), `fetched_at`, `staging_status` (`proposed`),
`needs_review` (`true`).

## Install (once, on the Mac)

```bash
scripts/legal/relay/install_mac.sh          # dry-run: prints the rendered plist
scripts/legal/relay/install_mac.sh --yes    # installs into ~/Library/LaunchAgents and loads it
launchctl kickstart -k gui/$(id -u)/ir.roxira.iranrelay   # run it now
```

Logs: `~/.roxira/iran_relay/{out,err}.log`. Uninstall:

```bash
launchctl bootout gui/$(id -u)/ir.roxira.iranrelay 2>/dev/null || true
rm -f ~/Library/LaunchAgents/ir.roxira.iranrelay.plist
```

## Runbook

1. **The Mac must be on, and the VPN OFF for at least one run in Iranian office hours (Sat-Thu 09:30 and 11:00 Tehran time).** With the VPN on, the
   sites are unreachable; the run then skips them and exits 0, and the next run catches up (state
   is kept, nothing is lost).
2. The job stages new rows and opens a PR titled `data(legal): relay batch <date> (N files)`.
3. The hub reviews and merges the PR. Only then does a later collection build/eval decide whether
   the texts enter production.
4. To add laws manually, put their numeric ids in `config/iran_relay.json` → `rc_law_ids`. The next
   run fetches each unseen id once.

Tests (offline, no network):

```bash
python3 -m pytest -q scripts/legal/tests/test_iran_relay.py
```

## Staging rc.majlis laws as articles (v6)

The `rc_law_ids` in `config/iran_relay.json` are whole laws (100k-200k chars). The relay row for
`source: "rcmajlis"` therefore keeps the **FULL** text (taxreg/dotic stay clipped at
`MAX_TEXT_CHARS=20000`). Split that row into one row per article before building:

```bash
# 1. on the Mac (Iranian IP): fetch the configured law ids -> one row per law
python3 scripts/legal/iran_relay.py run

# 2. peek at the split, without writing (article counts per law)
python3 scripts/legal/split_rc_law_articles.py \
  data/legal/staged/iran_relay_<date>.jsonl --dry-run

# 3. split the rcmajlis rows into article rows (cover letter dropped; هر تبصره با مادهٔ خود می‌ماند)
python3 scripts/legal/split_rc_law_articles.py \
  data/legal/staged/iran_relay_<date>.jsonl \
  --out data/legal/staged/rc_laws_<date>.jsonl

# 4. build/eval v6 from v3 + the new file, on the server
#    the new file is already listed in FILES of build_v4_on_server.sh
#    (update the date, or pass BUILD_FILES="... rc_laws_<date>.jsonl")
cd /opt/roxira_platform
DST=iran_laws_v6 bash scripts/legal/build_v4_on_server.sh --rebuild
```

`split_rc_law_articles.py` writes the `data/legal/phase1_canonical.jsonl` schema (`law_type`
`"STATUTE"`, `status` `"VALID"`, `source_tier` `"official"`, `source` `"rc.majlis.ir relay"`), one
row per «ماده N» / «ماده N مکرر». Add the law names to `config/legal_allowlist.json` first, or the
build's validate gate will block them (`not_in_allowlist`).

---

## یادداشت فارسی برای مالک

جاب «ایران ریله» روی **مک خودتان** و با **آی‌پی ایران** اجرا می‌شود، چون سایت‌های
`regulation.tax.gov.ir` و `dotic.ir` و `rc.majlis.ir` به آی‌پی سرورهای خارجی جواب نمی‌دهند.

* مک باید روشن باشد و **فیلترشکن حداقل یک‌بار در هر ۱۲ ساعت خاموش** شود تا سندهای جدید جمع‌آوری شوند.
* هر سند فقط یک‌بار خوانده می‌شود؛ وضعیت در `~/.roxira/iran_relay/` ذخیره می‌شود و خروجی هر روز در
  `data/legal/staged/iran_relay_<تاریخ>.jsonl` به‌صورت «پیشنهادی» نوشته می‌شود.
* هیچ چیز مستقیماً وارد نسخهٔ نهایی نمی‌شود: جاب یک Pull Request می‌سازد، هاب آن را بازبینی و merge
  می‌کند و بعد در ساخت/ارزیابی بعدی مجموعه تصمیم گرفته می‌شود. تا آن مرحله هیچ سندی به تولید نمی‌رود.
* شناسهٔ قوانین `rc.majlis.ir` را برای جمع‌آوری دستی در فایل `config/iran_relay.json` و کلید
  `rc_law_ids` اضافه کنید.

### Which law ids are configured (2026-10-15)

`801835` customs affairs 1390, `94011` guild system 1382, `866380` guild amendment 1392 (text of the amending law
itself; its «ماده N» rows are the amended articles of the 1382 law).
**Direct taxes 1366 (`91488`) is deliberately not listed:** rc.majlis.ir serves the original 1366 text (e.g. article 131
still has the 4% rate replaced in 1394), so it would give wrong answers. It needs a consolidated, amended source first.
The 1403 guild amendment has no rc.majlis.ir id yet.
