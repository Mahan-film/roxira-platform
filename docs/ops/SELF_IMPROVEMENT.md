# Smart Judge self-improvement loop

Measures, reports and proposes. It NEVER changes production code, config or data; humans or the hub apply
changes through PRs. Code: `scripts/ops/selfimprove/`. Units: `deploy/systemd/roxira-selfimprove-*`.

## What runs when

| Unit | When | What | LLM |
|---|---|---|---|
| `roxira-selfimprove-hourly` | every hour at :17 | Retrieval-only golden eval (`data/eval/chat_golden/retrieval_golden.json`) run inside `roxira_app_prod` via `docker exec -i` (read-only Qdrant search); p50/p95 per stage, `[LLM-UNAVAILABLE]` count and `[CLIENT-ERROR]` kinds from the last hour of logs; one JSON line appended to `/var/lib/roxira-selfimprove/metrics.jsonl`. E-mail (alert-on-change, via `monitor_common`) if recall < 7-day median, p95 total > +30 % of the 7-day median, or the probe fails. | none |
| `roxira-selfimprove-daily` | 04:00 Asia/Tehran | (a) up to 20 golden questions (rotating) through the live `/api/v1/apps/judge/chat`, scored on must-mention / must-not-mention; (b) last 24 h of chat turns read with a read-only SELECT inside the app container and anonymised there; TF-IDF clustering; (c) report; (d) e-mail + `/var/lib/roxira-selfimprove/reports/YYYY-MM-DD.md`; (e) optional GitHub issues | cheap role only, on keyword labels only |

First-sight state and silence: the hourly job e-mails only on FAIL / RECOVERED / reminder (2 h), and honours
`MONITOR_SILENCE=1` / the silence file of the monitors.

## Privacy and cost rules

- Raw user text is anonymised (phones, national ids, long numbers, e-mails, URLs, titled/introduced names) inside
  the DB-reading process and never leaves the server except in the owner e-mail as short anonymised examples.
- The LLM sees only keyword labels (3 terms per topic), never questions. Model = first non-`:free`, non-Gemini-Pro id
  of the `cheap` role in `config/models.yaml` (deepseek flash), `reasoning` disabled. No `:free` model is ever used.
- Budget: `SELFIMPROVE_DAILY_USD` (default 0.30) enforced by `budget.py` with an append-only ledger
  `/var/lib/roxira-selfimprove/ledger.jsonl` (Tehran day). Each live chat call is charged an estimate
  (`SELFIMPROVE_EST_USD_PER_CHAT`, default 0.004); a call that would pass the cap is skipped, not run.
- DB access: `SET TRANSACTION READ ONLY` + `SELECT` only. Nothing is written to Postgres/Qdrant.

## Reading the daily report

Sections: golden pass/fail; last-24 h counts (zero-source answers, "not found in sources" answers, p95, slow >20 s);
top missing-law topics (cluster label = top keywords, with optional LLM hint of laws to ingest); candidate
`retrieval_boost.py` keyword rules; candidate new golden cases; repeated topics; prompt issues. Everything legal is
TO-VERIFY by a lawyer. Turn items into PRs (ingest, boost rule, golden case) by hand.

## Install / operate

    sudo scripts/ops/rollout/ops_rollout.sh install-selfimprove            # dry run
    sudo scripts/ops/rollout/ops_rollout.sh install-selfimprove --apply
    systemctl list-timers 'roxira-selfimprove-*'
    sudo systemctl start roxira-selfimprove-hourly.service ; journalctl -u roxira-selfimprove-hourly -n 20
    python3 scripts/ops/selfimprove/daily.py --dry-run --no-golden     # prints the report, writes/sends nothing

Config: `/etc/roxira/selfimprove.env` (copy of `deploy/selfimprove/selfimprove.env.example`; mode 600). SMTP comes from
`/etc/roxira/monitor.env`. `OPENROUTER_API_KEY` is optional; without it the LLM hints are skipped. GitHub issues are
off by default: set `SELFIMPROVE_GH_ISSUES=1`, `SELFIMPROVE_GH_REPO=owner/name` and `GH_ISSUES_TOKEN` (max 5/day,
deduplicated, titles/counts only, no question text).

## Disable

    sudo systemctl disable --now roxira-selfimprove-hourly.timer roxira-selfimprove-daily.timer

Mute e-mail only: `MONITOR_SILENCE=1` or touch `/var/lib/roxira-monitor/silence`. State is plain files under
`/var/lib/roxira-selfimprove/`; deleting it resets baselines (regression alerts wait for 6 hourly samples).

## Known notes

- The hourly probe loads the bge-m3 embedder inside `roxira_app_prod` on every run (about 13 s first query, extra RAM
  for that moment). Raise the interval if memory is tight.
- Only logged-in users' chats are stored in `chat_messages`; anonymous chats appear only in log timings.
