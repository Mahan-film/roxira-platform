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

## OmniRoute (local gateway, Mac/agent/research side only)

`opencode.json` also declares an `omniroute` provider (`@ai-sdk/openai-compatible`)
pointing at the owner's local OmniRoute gateway through
`{env:OMNIROUTE_BASE_URL}` (for example `http://127.0.0.1:20128/v1`) and
`{env:OMNIROUTE_API_KEY}`. Both live in `~/Secrets/roxira/roxira.env`.
`check_keys.py` probes `GET {base}/models` and prints OK/FAIL plus the number
of models; it never prints the key or the URL. `FAIL(network)` usually means the
container is not running.

Its `models` map is empty on purpose. Model and combo ids must be taken from
`GET {OMNIROUTE_BASE_URL}/models` and added by hand; do not invent ids.

Rules:

- OmniRoute is for the Mac, agent and research side only.
- Production (the Smart Judge server) must NOT depend on a Mac-local gateway. It
  uses direct provider keys (OpenRouter, Mistral) in its own `.env`.
- Do not put subscription-OAuth logins in OmniRoute (terms-of-service risk). Use
  API keys only.
- The data policy below still applies: customer or case data never goes to a
  `:free` model, whether directly or through a gateway combo.

## Data policy

`enabled_providers` is global, not per agent. The `free` agent stays safe
because it is read-only and pinned to a `:free` model; customer or case data
must never be given to it (AGENTS.md section 4). Model ids stay in
`config/models.yaml`; the SambaNova block has an empty model list until ids
are added there.
