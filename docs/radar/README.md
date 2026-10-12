# Tech radar

`scripts/ops/radar/radar.py` (stdlib only) finds new open-source repos, tools, models and papers, scores them
against our stack and proposes adopt / trial / assess / hold. It never installs anything.

| | weekly (`--mode weekly`) | daily (`--mode daily --no-llm`) |
| --- | --- | --- |
| sources | GitHub search (new repos, 30 d), Hacker News (Algolia, fallback official API), arXiv (legal/Persian RAG), OpenRouter diff vs `config/models.yaml`, PyPI/npm/GitHub releases | PyPI/npm/GitHub releases of fastapi, qdrant, next, crawl4ai, opencode, goose, aider ..., OpenRouter diff |
| output | `/var/lib/roxira-radar/reports/REPORT_<date>.md` (RADAR_REPORT_DIR), rows appended to `DECISIONS.md` (adopt/trial only), e-mail digest, optional `gh issue` for adopt | `REPORT_<date>_daily.md` + e-mail only when something is new |
| LLM | `free` role summarises public abstracts; `cheap` role (DeepSeek V4.1 Flash) scores the top 12 in one call (+-15 points, cannot lift paper / unknown-licence items above assess) | none |

Budget: `RunBudget` reserves the worst-case cost before every call and refuses once `spent + estimate` would pass
0.05 USD (`RADAR_MAX_USD` can only lower it). After a refusal every later paid call is refused (hard stop).
Models come from `config/models.yaml` only (never Gemini Pro; `:free` only for public text).

Scoring (0-100): relevance 45, maturity 20, licence 10, cost/privacy 10, effort 15. Gates: non-OSI licence, archived
or fork -> hold; unknown licence, paper, article -> at most assess; repos younger than 90 days need 1500 stars for
adopt; adopt also needs a stack-specific keyword (qdrant, rag, persian, fastapi ...) and 300+ stars.

Tests: `python3 -m pytest src/test_radar.py -q` (offline). Install commands: `scripts/ops/radar/install.sh`.
State: `/var/lib/roxira-radar/state.json` (seen URLs, last versions, issue hashes).
