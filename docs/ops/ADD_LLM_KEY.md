# Add an LLM API key to the key pool

Owner decision 2026-10-22: every key of every provider is used, as fallback and for load sharing. Each provider
in `config/key_pool.yaml` has four slots: `NAME`, `NAME_2`, `NAME_3`, `NAME_4`. Filling a slot is all it takes.

| Provider | Slot names | Notes |
| --- | --- | --- |
| Groq | `GROQ_API_KEY`, `_2`.. `_4` | free |
| SambaNova | `SAMBANOVA_API_KEY`, `_2`.. `_4` | free |
| Mistral | `MISTRAL_API_KEY`, `_2`.. `_4` | free plan |
| Gemini (AI Studio) | `GEMINI_API_KEY`, `_2`.. `_4` | separate Cloud projects = separate quota |
| OpenRouter product | `OPENROUTER_API_KEY`, `_2`.. `_4` | product workspace only (used by `private`) |
| OpenRouter agents | `OPENROUTER_API_KEY_AGENTS`, `_2`.. `_4` | agents workspace |
| Cerebras | `CEREBRAS_API_KEY`, `_2`.. `_4` | free |
| NVIDIA NIM | `NVIDIA_API_KEY`, `_2`.. `_4` | build.nvidia.com, free |
| Cloudflare Workers AI | `CF_AI_TOKEN`, `_2`.. `_4` + `CF_ACCOUNT_ID` | token needs Workers AI permission |
| DeepSeek | `DEEPSEEK_API_KEY`, `_2`.. `_4` | paid, never in `private` |
| Chutes / Together / Fireworks | `CHUTES_API_KEY` / `TOGETHER_API_KEY` / `FIREWORKS_API_KEY`, `_2`.. `_4` | paid, last agent step |

## Steps (owner, from the Mac)
```bash
bash scripts/ops/set_server_env.sh GROQ_API_KEY_4          # hidden prompt; only the name and length are printed
bash scripts/ops/set_server_env.sh CF_ACCOUNT_ID           # Cloudflare only: the account id in the URL
# on the server, in /opt/roxira_platform
python3 scripts/infra/key_pool/inventory.py --env-file .env                          # dry run: slots set / unset
python3 scripts/infra/key_pool/inventory.py --env-file .env --probe --provider groq  # one 1-token call per key
bash scripts/infra/key_pool/install.sh --apply             # re-render the gateway config and restart it
```

## Per-key limit
If a key has its own limit, add it under the provider in `config/key_pool.yaml` (via a PR):
```yaml
limits_per_key:
  GROQ_API_KEY_4: {rpm: 60, tpm: 12000, weight: 60}   # weight = share of its rank; default = rpm
```
A key that keeps failing only costs one quick attempt per minute: a 429 or error cools that key for 60 s.
To retire a key, remove it from the server `.env` and re-run `install.sh --apply`; no config change needed.
