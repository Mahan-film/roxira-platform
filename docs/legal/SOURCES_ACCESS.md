# Legal sources: access policy and how to sync

## Situation (2026-10)

qavanin.ir (the official laws portal of the Presidency legal deputy) now answers every non-browser client with an
ArvanCloud JavaScript challenge. This happens from Iranian IPs and from our German server. A plain HTTP client
(urllib, curl, requests, crawl4ai without a browser) only receives the challenge page, never the law.

## Policy: we never bypass bot protection

We do not solve JavaScript challenges, solve CAPTCHAs, rotate IPs to evade blocks, or spoof a browser/TLS
fingerprint (JA3/JA4, headless-browser stealth patches, impersonating curl builds). Reasons:

- The challenge is the publisher's explicit statement that automated access is not welcome. Passing it
  deliberately circumvents an access control, which is both an ethical problem and a legal risk for a legal-tech
  product whose credibility rests on lawful sourcing.
- Fingerprint-spoofing downloaders (for example Ghost Downloader and similar tools) work by imitating a real browser
  so the edge cannot tell the difference. That is the exact behaviour this policy forbids, so such tools are not used,
  not even "just once" to fill a gap. Using them would also make our sync fragile (an arms race) and could get the
  server IP blocked, which would hurt the other sources too.
- The same rule applies to every host: if any source returns a challenge/CAPTCHA, the sync logs it, skips the host
  for that run and moves on (`scripts/legal/sync_sources.py` stops the host immediately; exit code 6).

## What we use instead

Owner-approved equivalent sources, both reachable from the server without any challenge:

| source | tier | notes |
|---|---|---|
| nezamat.ir | unofficial | consolidated texts with amendment tags, approval date/number, "نامعتبر" category |
| ekhtebar.ir | unofficial | used for discovery and as a cross-check text |

All rows from these sources are `source_tier: unofficial`, `needs_review: true`, lawyer review pending. Laws that
already exist in the corpus are never overwritten: article-level differences go to a review file.

## Legitimate ways to obtain qavanin.ir data

1. Ask the publisher. Write to the Presidency legal deputy (معاونت حقوقی ریاست جمهوری, the operator of
   qavanin.ir) asking for a data feed, API, bulk export or written permission for automated access at a stated
   rate and user-agent. If they allow it, they can whitelist `RoxiraBot/1.0 (+https://ghazihoushmand.ir)` on the
   edge, and the existing polite client would work unchanged.
2. Manual saves by a person. The owner (or a lawyer) opens the law in a normal browser and saves the page
   ("Save as" HTML, or the print view). Saved files are then parsed offline with
   `scripts/legal/parse_qavanin_print.py`; no automated request reaches qavanin.ir. This is a human reading the site
   the way the publisher intends, so it is within policy; keep volume reasonable.
3. Official gazette (rooznamehrasmi.ir) and other public publishers, subject to their own robots.txt and terms
   (check before adding a host to `HOSTS` in the sync script).

## Running the sync (server only)

```bash
cd /opt/roxira_platform
sudo mkdir -p /var/lib/roxira-legal-sync && sudo chown "$USER" /var/lib/roxira-legal-sync

# 1. discovery only, nothing fetched but robots.txt and sitemaps
python3 scripts/legal/sync_sources.py --dry-run --limit 20

# 2. small real run
python3 scripts/legal/sync_sources.py --host nezamat --limit 25

# 3. incremental full run (state in /var/lib/roxira-legal-sync/state.json)
python3 scripts/legal/sync_sources.py
```

Outputs: `data/legal/staged/sync_sources_<date>_<host>.jsonl` (new laws), `..._review.jsonl` (differences for laws
already in the corpus), `docs/legal/SYNC_REPORT_<date>.md`. Existing files are never overwritten (`--tag` for a
second run on the same day).
