# OpenCode provider keys

`opencode.json` declares the OpenRouter, Mistral and SambaNova providers. Each
reads its key only from the environment (`{env:OPENROUTER_API_KEY}`,
`{env:MISTRAL_API_KEY}`, `{env:SAMBANOVA_API_KEY}`). No key is ever stored in
the repo.

## Use

Keys live in `~/Secrets/roxira/roxira.env` (outside the repo). Load them, check
them, then start OpenCode from the same shell:

```bash
set -a; source ~/Secrets/roxira/roxira.env; set +a
python3 scripts/dev/check_keys.py   # run this first
opencode
```

## Which providers work

| Provider   | Env var              | Status for the owner |
|------------|----------------------|----------------------|
| OpenRouter | `OPENROUTER_API_KEY` | OK                   |
| Mistral    | `MISTRAL_API_KEY`    | OK                   |
| SambaNova  | `SAMBANOVA_API_KEY`  | OK                   |
| Groq       | `GROQ_API_KEY`       | FAIL(403), excluded  |

Groq is not in `enabled_providers`. If `check_keys.py` shows anything other
than `OK` for a provider, fix the key before using that provider.

## Data policy

`enabled_providers` is global, not per agent. The `free` agent stays safe
because it is read-only and pinned to a `:free` model; customer or case data
must never be given to it (AGENTS.md section 4). Model ids stay in
`config/models.yaml`; the SambaNova block has an empty model list until ids
are added there.
