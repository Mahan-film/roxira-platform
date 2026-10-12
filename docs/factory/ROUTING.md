# Factory routing: which tool uses which gateway

Model ids live only in `config/models.yaml`. Scripts resolve them with
`python3 scripts/dev/model_for.py <role> [--prefix openrouter]` (executor, mechanical, cheap, free).
Keys come from the environment (`~/Secrets/roxira/roxira.env`); never written into configs.

| Tool | Gateway | Model source | Notes |
|---|---|---|---|
| `rx` chain step 1 `dsflash` | direct OpenRouter (`openrouter/<id>`) | `executor` role | paid, standard data policy |
| `rx` step 2 `codestral` | LiteLLM `pool/codestral` (Mistral free tier) | LiteLLM alias | free: public code only |
| `rx` step 3 `team` | OmniRoute `omniroute/team-coding` | OmniRoute combo | scraped/free providers: public code only |
| `rx <n> codex` | Codex CLI | n/a | not in default chain (unverified/exhausted); explicit only |
| `dispatch_opencode.sh` | direct OpenRouter by default; `-m pool/*`, `omniroute/*` allowed | `executor` role (`-R <role>` to change) | `:free` and `pool/*` require `--public` |
| OpenCode agents in repo `opencode.json` | openrouter, mistral, sambanova, omniroute | per agent / provider lists | sambanova, mistral free tier and omniroute are public-code-only |
| Product runtime (`llm_router`) | direct OpenRouter | `cheap`/`strong`/`free` roles | prod key only |
| Goose / Aider | any of the three, same rules | | |

Rule: customer or case data never goes through free tiers (`:free`, Mistral free, SambaNova) or
OmniRoute scraped providers. Only direct paid OpenRouter (standard data policy) may see it.

## Per-key daily budgets (audit 2026-10-12, section 5)

| Lane | Budget/day | Key |
|---|---|---|
| OpenCode/Aider/rx batch | $2.00 | `OPENROUTER_API_KEY_DEV` |
| Goose recurring chores | $0.50 | `OPENROUTER_API_KEY_GOOSE` (or free combos only) |
| CI/eval/bake-off | $1.00 | `OPENROUTER_API_KEY_EVAL` |
| Production product | owner-set | `OPENROUTER_API_KEY_PROD`, never on the Mac |
| Claude Code | subscription | n/a |

Track with `scripts/dev/llm_spend.sh`; stop batches when remaining < 25%.

## OmniRoute key alias

Repo `opencode.json` and `dispatch_opencode.sh` read `OMNIROUTE_API_KEY` (and `OMNIROUTE_BASE_URL`).
The global `~/.config/opencode/opencode.json` reads `OMNIROUTE_OPENCODE_KEY`, which is not in
roxira.env. `rx` and `dispatch_opencode.sh` export `OMNIROUTE_OPENCODE_KEY` from `OMNIROUTE_API_KEY`
when unset. For plain `opencode` runs, either change the global file to `{env:OMNIROUTE_API_KEY}`
(owner-side, outside the repo) or `export OMNIROUTE_OPENCODE_KEY="$OMNIROUTE_API_KEY"`.

## Key health

`set -a; . ~/Secrets/roxira/roxira.env; set +a; python3 scripts/dev/check_keys.py` prints name and
OK / FAIL(HTTP code) only.
