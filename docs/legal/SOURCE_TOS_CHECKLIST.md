# Source terms-of-service checklist (R22 source watcher)

Date: 2026-11-23. Refs #1279 (R22 watcher). Scope: the 13 hosts in `config/source_watcher.json`.

**Decision rule.** The watcher stays in dry-run (`SOURCE_WATCHER_ARGS` empty) until each source has a recorded ToS decision in the
last column. Nothing here is legal advice and nothing here is a decision: every row is `PENDING` until the owner or a lawyer fills it in.
A `robots.txt` is not a licence: it says what a crawler may fetch, not what may be reused or redistributed.

**Method.** One `GET /robots.txt` and one front-page request per host, then at most three same-host pages whose link text or URL looked like
terms, copyright or privacy. Run as the box service user, honest UA `RoxiraBot/1.0`, >= 3 s between requests, through the local proxy
(domestic hosts go direct by the proxy's own rules), no redirects followed to another host, no login, no challenge or block bypass.
A dedicated terms or "conditions of use" page was **not found** on any reachable host, so "UNKNOWN" below means "no statement located",
not "permitted". A statement is quoted only as a paraphrase. Each row should be re-checked by a person reading the site in a browser.

**Dry-run result (first run 2026-11-23, 28 requests).** Column "watcher state" is the page state the watcher recorded.

| # | source id | host | watcher state | robots.txt | Reuse / automated-access statement found | ToS status | Decision |
|---|---|---|---|---|---|---|---|
| 1 | rrk | rrk.ir | tls_error (nothing parsed) | not readable (TLS verification fails; not disabled) | None readable | UNKNOWN | PENDING |
| 2 | dotic | dotic.ir | ok, 172 links | 200: all agents allowed, sitemap listed | Footer: all rights reserved by the Presidency legal deputy's codification and publication office. No terms page, no statement on automated access or reuse | UNKNOWN (rights reserved, no reuse terms) | PENDING |
| 3 | majlis_rc | rc.majlis.ir | ok, 109 links | 200: no disallow rules | Page footer: copyright belongs to the Parliament Research Center. No terms page, no statement on automated access or reuse | UNKNOWN (copyright claimed, no reuse terms) | PENDING |
| 4 | divan_edalat | divan-edalat.ir | redirect (off-host) | 302 to a different host, not followed | None; the site now redirects to a host not in our config (`divanedalat` under the judiciary `eadl` domain). Config needs a human decision before any fetch of the new host | UNKNOWN | PENDING |
| 5 | cbi | cbi.ir | blocked (WAF page served with 200) | WAF block page, not a robots file | None readable. The block is itself a signal that automated access is unwelcome: do not retry with another UA. Ask the bank for a feed or use manual saves | UNKNOWN (block = not welcome) | PENDING |
| 6 | shora_gc | shora-gc.ir | ok, 0 links parsed | 200: allows, but disallows `/fa/archive`, `/fa/search`, `/fa/print`, `/fa/save`, `/fa/report`, `/fa/ajax`, `/fa/send` | None found. Config must avoid the disallowed paths; the 0 parsed links need a selector check | UNKNOWN (partial robots limits) | PENDING |
| 7 | dolat | dolat.ir | challenge (nothing parsed) | challenge page, not a robots file | None readable. Challenge = automated access not welcome; never automate | UNKNOWN (challenge = not welcome) | PENDING |
| 8 | mimt | mimt.gov.ir | redirect (301); the follow-up front request was refused | 200: no disallow rules | None found | UNKNOWN | PENDING |
| 9 | icbar | icbar.org | ok, 27 links | 200: all agents allowed, sitemap listed | None found. No terms page located | UNKNOWN | PENDING |
| 10 | iranbar | iranbar.org | tls_error (nothing parsed) | not readable (TLS) | None readable | UNKNOWN | PENDING |
| 11 | eadl | eadl.ir | redirect (302), follow-up not completed | 200: template file with no rules | None found | UNKNOWN | PENDING |
| 12 | adliran | adliran.ir | net_error (unreachable) | not readable | None readable | UNKNOWN | PENDING |
| 13 | setad | setadiran.ir | ok, 17 links | 404, no robots file | Footer: all rights of the site reserved. No terms page located; listing is public but bidding needs an account, which is out of scope | UNKNOWN (rights reserved, no reuse terms) | PENDING |

## What each decision should say

For every source the owner (or a lawyer) records one of: `ALLOWED` (written statement or licence found, cite it), `ASK` (write to the publisher
for permission or a feed; keep the watcher off that host), `MANUAL` (people save pages by hand), or `EXCLUDE` (remove from the config).
Hosts that returned a challenge, a WAF block or a TLS error (rows 1, 5, 7, 10) stay excluded by policy
(`docs/legal/SOURCES_ACCESS.md`) regardless of any ToS reading.

## Open items found by this pass

- Hosts with no readable ToS: all 13. No row can move to `ALLOWED` on this evidence.
- Config follow-ups (not done here, owner decision): the `divan_edalat` redirect target, the `shora_gc` selector and disallowed paths,
  the `mimt` and `eadl` redirect behaviour, and the `rrk`/`iranbar` TLS cause.
- Stored text: the staged-row contract keeps `needs_review: true`. Sites that claim rights (rows 2, 3, 13) need a decision before `--commit`
  stores any page text, as opposed to links and titles.
