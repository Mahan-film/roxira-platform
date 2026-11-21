# Provider Data Policy & Zero Data Retention (ZDR) Audit (#1230)

**Date:** 2026-11-22  
**Scope:** Primary-source audit of LLM inference providers in `config/models.yaml` and `config/key_pool.yaml` for proprietary / private code processing.  
**Primary Sources:**
- OpenRouter Data Policy & Privacy Documentation (`https://openrouter.ai/docs/overview/privacy`, retrieved 2026-11-22)
- OpenRouter Providers Registry (`GET https://openrouter.ai/api/v1/providers`, 123 registered providers, retrieved 2026-11-22)
- OpenRouter Live ZDR Registry (`GET https://openrouter.ai/api/v1/endpoints/zdr`, 937 endpoints across 61 providers, retrieved 2026-11-22)
- OpenRouter Models Registry (`GET https://openrouter.ai/api/v1/models`, 476 models, retrieved 2026-11-22)
- Live Gateway Synthetic Test (probed with gateway virtual key on 2026-11-22)

---

## 1. Executive Summary

1. **Platform-Level Storage (OpenRouter):** OpenRouter operates as a transient routing proxy. By default, it **does not store** prompts or completions. Input/output logging is off by default (opt-in under Observability), and prompt training is off by default ("OpenRouter Use of Inputs/Outputs" discount opt-in). Only in-flight CSAM screening is performed (retaining only positive legal violations).
2. **Request Routing Controls:**
   - `provider.zdr: true`: Restricts routing exclusively to underlying inference providers verified to enforce **Zero Data Retention** (no persistence after API response completes).
   - `provider.data_collection: "deny"`: Restricts routing exclusively to providers that do not store non-transiently or train on customer prompts.
3. **Live Test Outcome:**
   - Probed `agent-free-paid` via the srv1 gateway virtual key with synthetic non-repo prompt (`What is 2+2? Answer with just the number.`) passing `provider: {"zdr": true, "data_collection": "deny"}`:
     - **HTTP Status:** 200 OK.
     - **Model Served:** `openrouter/z-ai/glm-5.3-flash`.
     - **Provider Selected by OpenRouter:** `Relace` (confirmed in live ZDR registry with `safety_retention: false`).
     - **Cost:** $0.00000176.
   - Probed free tiers (`agent-strong-free`, `agent-light-free`):
     - Timed out / refused under `zdr: true`. Out of 937 ZDR endpoints on OpenRouter, **only 3 are `:free`** (Ant Digital Ling-3.2 and two Perplexity deciders). Free-tier models generally permit provider data retention/training and cannot satisfy strict ZDR.

---

## 2. Provider Data Policy Table

| Provider / Routing Target | Tier | Retains Prompts | Trains on Data | Opt-Out / Guard Tested | Source + Verification Date |
|---|---|---|---|---|---|
| **OpenRouter (Platform Proxy)** | All | **No** (transient proxy; logging off by default) | **No** (off by default) | Default settings; opt-in logging kept disabled | OpenRouter Privacy Docs, 2026-11-22 |
| **Relace** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true` (HTTP 200 in live test) | OpenRouter ZDR Registry & Live Test, 2026-11-22 |
| **DeepInfra** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`deepinfra`), 2026-11-22 |
| **Fireworks** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`fireworks`), 2026-11-22 |
| **Nebius** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`nebius`), 2026-11-22 |
| **CoreWeave** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`coreweave`), 2026-11-22 |
| **Together** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`together`), 2026-11-22 |
| **Azure** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`azure`), 2026-11-22 |
| **Amazon Bedrock** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`amazon-bedrock`), 2026-11-22 |
| **DigitalOcean** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`digitalocean`), 2026-11-22 |
| **BaseTen** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`baseten`), 2026-11-22 |
| **Crusoe** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`crusoe`), 2026-11-22 |
| **Venice** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`venice`), 2026-11-22 |
| **Parasail** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`parasail`), 2026-11-22 |
| **Cloudflare** (Workers AI via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`cloudflare`), 2026-11-22 |
| **ScaleDown** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`scaledown`), 2026-11-22 |
| **Cohere** (via OpenRouter) | Paid | **No** (ZDR: True, `safety_retention: false`) | **No** | `provider.zdr=true`, `data_collection=deny` | OpenRouter ZDR Registry (`cohere`), 2026-11-22 |
| **Google** (via OpenRouter) | Paid | **Safety Only** (`safety_retention: true`, 30d abuse logs) | **No** | `provider.data_collection=deny` | OpenRouter ZDR Registry (`google`), 2026-11-22 |
| **Groq** (Direct & via OpenRouter) | Paid / Free | **No** on paid ZDR; Free may log (UNVERIFIED) | **No** on paid API terms | `provider.zdr=true` (paid endpoints only) | OpenRouter ZDR Registry (`groq`), 2026-11-22 |
| **SambaNova** (Direct & via OpenRouter) | Paid / Free | **No** on paid ZDR; Free may log (UNVERIFIED) | **No** on paid API terms | `provider.zdr=true` (paid endpoints only) | OpenRouter ZDR Registry (`sambanova`), 2026-11-22 |
| **Mistral** (Direct & via OpenRouter) | Paid / Free | **No** on paid ZDR; Free may log (UNVERIFIED) | **No** on paid API terms | `provider.zdr=true` (paid endpoints only) | OpenRouter ZDR Registry (`mistral`), 2026-11-22 |
| **DeepSeek** (Direct API endpoint) | Direct / Paid | **UNVERIFIED** (OpenRouter direct slug `deepseek` has ZDR=False) | **UNVERIFIED** | ZDR NOT supported on OpenRouter direct endpoint; must route via DeepInfra/Fireworks/Nebius | OpenRouter Providers & ZDR Registry, 2026-11-22 |
| **Anthropic** (Direct API endpoint) | Direct / Paid | **UNVERIFIED** (OpenRouter direct slug `anthropic` has ZDR=False) | **No** on paid commercial terms | ZDR supported via Amazon Bedrock / Google routing only | OpenRouter Providers & ZDR Registry, 2026-11-22 |
| **OpenAI** (Direct API endpoint) | Direct / Paid | **Safety Only** (30d abuse monitoring unless zero-retention agreement) | **No** on paid API terms | ZDR supported via Azure / Bedrock routing on OpenRouter | OpenRouter Providers & ZDR Registry, 2026-11-22 |
| **Xiaomi** (slug: `xiaomi`) | Paid | **Yes / UNVERIFIED** (ZDR=False on OpenRouter) | **UNVERIFIED** | Not eligible for ZDR | OpenRouter Providers & ZDR Registry, 2026-11-22 |
| **Z.AI / Zhipu** (slug: `z-ai`) | Paid | **Yes / UNVERIFIED** (ZDR=False on OpenRouter direct) | **UNVERIFIED** | Direct slug lacks ZDR; GLM models must route via Relace/DeepInfra/Fireworks with ZDR | OpenRouter Providers & ZDR Registry, 2026-11-22 |
| **Thinking Machines** (slug: `thinkingmachines`) | Free | **Yes** (ZDR=False; research tier privacy notice) | **Yes / Likely** | Not eligible for ZDR | OpenRouter Providers Registry, 2026-11-22 |
| **OpenRouter Free Tier (`:free`)** | Free | **Yes / May Log** (only 3 of 937 endpoints have ZDR) | **May Train** | Refused by `provider.zdr=true` | OpenRouter Live Endpoints Audit, 2026-11-22 |

---

## 3. Proposal for Private-Code Provider Allowlist

For private, proprietary-code tasks (the "private flip"), only providers that guarantee **Zero Data Retention** and **Zero Training** may see code:

### Proposed Config Row (`config/private_providers.json` or `config/key_pool.yaml:groups.private`):
```yaml
# Approved providers for private proprietary code:
# Requires provider.zdr=true and provider.data_collection=deny on all requests.
# When calling via OpenRouter, OpenRouter strictly routes to these verified ZDR backends:
private_code_allowed_providers:
  - azure
  - amazon-bedrock
  - coreweave
  - deepinfra
  - fireworks
  - nebius
  - relace
  - together
  - crusoe
  - baseten
```

### Critical Enforcements:
1. **Free Tier Banned for Private Code:** No `:free` model or unauthenticated free endpoint may ever receive private code, as free endpoints fail ZDR requirements.
2. **Direct Endpoints with Missing ZDR Banned:** Direct endpoints for DeepSeek, Z.AI, Xiaomi, and Thinking Machines must NOT be routed directly for private code; calls for those model families must include `provider: {"zdr": true, "data_collection": "deny"}` so OpenRouter automatically routes exclusively to compliant backends (such as Relace, DeepInfra, or Fireworks).
3. **Google & OpenAI Safety Retention Note:** Direct Google and OpenAI endpoints retain prompts for 30-day abuse monitoring. If strict zero-retention is legally required by customer contract, route via Azure / Bedrock or restrict to zero-retention backends.
