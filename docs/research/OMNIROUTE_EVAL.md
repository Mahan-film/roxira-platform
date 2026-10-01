# OmniRoute v3.8.51 evaluation

**Decision:** run both temporarily, but only as a loopback-only *development
gateway for coding workers*. Keep LiteLLM as the existing product gateway; do
not send customer/case data to OmniRoute and never run it on production. This
is consistent with the owner's hard boundary and avoids making a rapidly moving,
feature-heavy gateway part of the legal-AI serving path. OmniRoute v3.8.51 is a
large release (2,022 documented changes, including seven security entries), so
pin and test the exact artifact rather than trust `latest`. [v3.8.51 release](https://github.com/diegosouzapw/OmniRoute/releases/tag/v3.8.51)

All source links below are live pages opened on 2026-09-30. “UNVERIFIED” means
the repository material did not establish the fact; it is not an assurance.

## 1. Fix `AUTH_002` and configure the two workers

`AUTH_002 Authentication required` means the request reached OmniRoute but did
not present a recognised client key. `/v1/*` requires a valid Bearer key when
`REQUIRE_API_KEY=true`; the Docker image defaults it to true, while the generic
local configuration default is false. [environment guidance](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/USER_GUIDE.md) · [Dockerfile](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/Dockerfile)

1. Sign in to the dashboard, open **API Keys**, click **New Key**, give it a
   worker-specific name such as `opencode-mac`, select the least-privileged
   **chat** scope (not `manage`), create it, and copy the displayed value now.
   The documented management flow is **Dashboard → API Keys → New Key → Scope**;
   key creation via the API likewise uses `scopes: ["chat"]`.
   [User Guide](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/USER_GUIDE.md)
2. Repeat for `codex-mac`; do not share a key. If the UI offers a **noLog**
   option, enable it for both; the security policy documents that per-key flag
   as disabling request logging. Button wording for `noLog` is **UNVERIFIED**.
   [Security policy](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/SECURITY.md)
3. In the Docker Compose `.env` used by this container, set
   `REQUIRE_API_KEY=true`, keep the port bound to `127.0.0.1`, and restart the
   container. The feature flag can also be changed at **Settings → Feature
   Flags**, but it is restart-required; the `.env` setting is the auditable
   source of truth. [environment reference](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/.env.example) · [feature-flag note](https://github.com/diegosouzapw/OmniRoute/wiki/Feature-Flags)
4. Set strong, unique `JWT_SECRET`, `API_KEY_SECRET`, and
   `STORAGE_ENCRYPTION_KEY`; without the last one, SQLite secret storage is
   plaintext passthrough. [Security policy](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/SECURITY.md)
5. Verify with a harmless request using `Authorization: Bearer <key>` before
   changing either worker. Do **not** use `auto`: restrict a named combo to the
   direct, approved Mistral/Groq connections, and omit every free, g4f, and
   OpenRouter target.

`~/.config/opencode/opencode.json` (merge this provider; do not replace other
providers):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "omniroute": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OmniRoute local",
      "options": {
        "baseURL": "http://127.0.0.1:20128/v1",
        "apiKey": "<OMNIROUTE_OPENCODE_CLIENT_KEY>"
      },
      "models": {
        "team-coding": { "name": "Approved Mistral/Groq combo" }
      }
    }
  }
}
```

OpenCode uses `Authorization: Bearer ${apiKey}` and must contain **exactly one**
`/v1`; its documented config is the OpenAI-compatible provider shown above.
[OpenCode integration](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/frameworks/OPENCODE.md)

`~/.codex/config.toml` (store the actual key in the shell environment, not TOML):

```toml
model = "team-coding"
model_provider = "omniroute"

[model_providers.omniroute]
name = "OmniRoute local"
base_url = "http://127.0.0.1:20128/v1"
env_key = "OMNIROUTE_CODEX_CLIENT_KEY"
requires_openai_auth = false
wire_api = "responses"
```

```zsh
export OMNIROUTE_CODEX_CLIENT_KEY='<OMNIROUTE_CODEX_CLIENT_KEY>'
```

Modern Codex uses `config.toml`; it requires `wire_api = "responses"`, which
OmniRoute translates to provider chat APIs when necessary. Use the real combo
name only after creating it in OmniRoute. [Codex configuration](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/CODEX-CLI-CONFIGURATION.md)

## 2. Cloud OmniRoute and Sync: disable both

**Cloud OmniRoute:** `CLOUD_URL` is documented as a cloud-relay endpoint and
the deployment guide labels Cloud Sync optional; it is not needed for local
`127.0.0.1` use. The environment reference says the cloud URL is empty by
default, so a self-hosted installation is not cloud-connected by default.
[environment reference](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/i18n/de/docs/reference/ENVIRONMENT.md) · [deployment guide](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/ops/VM_DEPLOYMENT_GUIDE.md)

The docs I reviewed do **not** specify who can reach a local gateway through an
active **Cloud OmniRoute** dashboard tunnel, whether arbitrary Internet clients
can do so, whether inference request/response bodies traverse
`cloud.omniroute.online`, or its retention/logging policy: **UNVERIFIED**. An
active connection to a third-party relay is therefore incompatible with the
case-data boundary. Click **Disable Cloud**, leave `CLOUD_URL` and
`NEXT_PUBLIC_CLOUD_URL` unset, and do not publish the loopback port. Treat the
Cloudflare/Tailscale/ngrok panels separately; none is required here.

**Sync:** cloud sync is configuration/metadata replication, not a required
local routing feature. With the documented defaults it does not allow cloud
responses to overwrite OAuth access/refresh/provider-specific credentials;
setting `OMNIROUTE_CLOUD_SYNC_SECRETS=true` permits that, and unsigned-response
acceptance remains compatible-by-default in v3.8.x unless signature enforcement
is enabled. Keep **Sync off** and all three `OMNIROUTE_CLOUD_SYNC_*` variables
unset. [v3.8.51 `.env.example`](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/.env.example)

## 3. Remove `g4f.space — Groq`

This is not the direct `groq` provider carrying the three owner keys. OmniRoute
catalogues `g4f-groq` as **g4f.space — Groq**, an API-key **aggregator**, and
also lists other g4f routes. The upstream gpt4free project describes itself as
a community multi-provider aggregator and is explicitly tagged
`reverse-engineering`. [OmniRoute provider reference](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/reference/PROVIDER_REFERENCE.md) · [gpt4free repository](https://github.com/xtekky/gpt4free)

Consequences: the request can be handled by g4f and a further upstream rather
than by Groq directly; ToS compliance and data retention for that chain are
**UNVERIFIED**. Reverse-engineered/web-session access can violate an upstream's
terms and has no acceptable evidence of a no-training/no-retention commitment
for legal data. Remove it, rather than merely accepting its error state.

* Dashboard: **Providers → g4f.space — Groq → connection actions → Remove →
  confirm**, then remove g4f models from every combo and denylist them from
  `/v1/models`. The exact connection-actions label in v3.8.51 is **UNVERIFIED**;
  the documented provider dashboard is `/dashboard/providers`.
* Deterministic alternative: identify its connection ID with
  `omniroute providers list`, then run
  `omniroute providers remove <g4f-connection-id> --yes`. This removes only
  the g4f connection; keep the direct `groq` and `mistral` connections.
  [provider commands](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/reference/CLI-TOOLS.md)

## 4. Feature map for this team

| Capability | Use? | Reason |
|---|---|---|
| Combos, priority/weighted/round-robin/auto fallback | **Yes** | Make a direct-provider-only `team-coding` chain; fail over among the 3 Groq and 4 Mistral keys, never to free/aggregator routes. |
| Key pools/rotation | **Yes** | Multiple direct keys are the strongest reason to evaluate it; test fairness and revoked-key isolation before trusting it. |
| Rate-limit backoff, cooldown, circuit breaker | **Yes** | It has per-provider limits/backoff, breaker states and retries; useful against Groq/Mistral 429s. |
| RTK/Caveman/LLMLingua compression | **Later** | It rewrites/condenses prompts to save tokens; disable initially because legal Persian precision, tool output, and coding fixes can change. |
| Memory (FTS5/vector) | **No** | It creates another persistence plane for conversations/case-adjacent material. |
| MCP server | **Later** | Useful only after a scoped, loopback-only tool inventory; it enlarges privileged local-agent surface. |
| A2A | **No** | The current hub/workers already coordinate; adding an agent protocol brings no immediate routing value. |
| Analytics/cost/call logs | **Later** | Useful for spend and test evidence, but logs may retain request payloads; use no-log keys or scrubbed tests. |
| PII/injection/vision guardrails | **Later** | Helpful defence-in-depth, but PII coverage is pattern-based and prompt-injection detection is documented as best-effort/fail-open, not a legal-data control. |

The feature claims in this table are documented in the routing README,
comparison, and security policy. [routing strategies](https://github.com/diegosouzapw/OmniRoute) · [comparison](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md) · [security details](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/SECURITY.md)

## 5. Security review

* **Secrets and local data:** API/provider/OAuth tokens are in SQLite; AES-256-GCM
  encryption needs `STORAGE_ENCRYPTION_KEY`, otherwise plaintext is allowed.
  The Docker data directory also contains `call_logs/` request-payload archives
  and backups. Use an encrypted named volume, restrictive host access, strong
  secrets, and no-log client keys. [Security policy](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/SECURITY.md) · [data layout](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/UNINSTALL.md)
* **Auth/network:** dashboard login uses JWT HttpOnly cookies; API keys are
  HMAC-signed. Bind only `127.0.0.1`, set `REQUIRE_API_KEY=true`, keep dashboard
  login enabled, restrict CORS, and never rely on `/v1/models` authentication
  as proof that inference is protected. [Security policy](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/SECURITY.md) · [environment reference](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/i18n/sl/docs/reference/ENVIRONMENT.md)
* **Telemetry:** local call/audit logging is documented; a project-wide external
  telemetry/no-telemetry guarantee was not found in the reviewed sources:
  **UNVERIFIED**. Cloud Sync is optional, but disable it as above.
* **Known security history:** CVE-2026-88062 / GHSA-hf57-cqmx-p4gr was an ACP
  custom-agent RCE affecting `<3.8.49` and is patched in 3.8.49, so v3.8.51 is
  outside the affected range. Still, do not enable/customise ACP agents or
  expose management routes. [advisory](https://github.com/diegosouzapw/OmniRoute/security/advisories/GHSA-hf57-cqmx-p4gr)
* **Supply chain:** GitHub reports the v3.8.51 release commit as verified and
  says the release adopted npm Trusted Publishing (OIDC); nevertheless pin the
  npm/Docker version and image digest, retain an SBOM/lockfile, and do not use
  mutable `latest`. A closed v3.8.5 issue reported Socket supply-chain alerts
  around MITM/keychain/process/cloud-sync code; it is a report, not proof of
  malware, but warrants minimal build/profile and independent review.
  [release](https://github.com/diegosouzapw/OmniRoute/releases/tag/v3.8.51) · [issue #2863](https://github.com/diegosouzapw/OmniRoute/issues/2863)

**Production verdict: no.** The owner’s rule is decisive. The prior RCE,
optional MITM/agent/credential-import functionality, cloud ambiguity, and a
very broad feature surface make this unsuitable as a legal product dependency;
use no model/agent gateway on the production server.

## 6. LiteLLM comparison and a five-step gate

LiteLLM remains the simpler, established production choice; OmniRoute adds UI
combos, a larger provider catalog, multi-account rotation, compression, MCP,
and A2A, while OmniRoute's own comparison calls LiteLLM better for Python-first
teams and mature Kubernetes/Helm production recipes. **Recommendation: run both
on the Mac during the gate only; retain LiteLLM for product traffic, then keep
or drop OmniRoute solely as a local coding-worker router.**
[comparison](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/comparison/OMNIROUTE_VS_ALTERNATIVES.md)

1. Choose one real, non-case coding issue with an existing failing test and
   fixed acceptance test; redact customer data and record the LiteLLM baseline.
2. Create `team-coding`: direct Mistral/Groq connections only, explicit ordered
   fallback, compression/memory/MCP/A2A/Cloud/Sync off, and two no-log keys.
3. Run 20 independent, identical issue-solving requests through each gateway;
   pass if OmniRoute has at least **19/20 HTTP success** and **≥ baseline**
   accepted-test passes, with no call log/model list showing g4f, free, or
   OpenRouter.
4. Measure client time-to-first-token and total latency; pass if OmniRoute p95
   is **≤ 1.20× LiteLLM p95**. After five runs, revoke/invalidly replace one
   selected direct key, then pass only if the next five requests succeed via a
   different approved key, no request is sent to a forbidden provider, and the
   bad key is placed in cooldown/breaker state.
5. With compression still off, compare OmniRoute's reported input/output tokens
   to the provider/baseline usage for the same prompts; pass if the median
   absolute difference is **≤2%** and the final test suite passes. Export only
   aggregate timings/tokens, rotate the test keys, and delete the scrubbed test
   logs afterwards.

## 5. Measured comparison on the coding smoke eval (2026-10-01)

Command (same 7 hidden-check tasks, `scripts/eval_coding_smoke.py`, flags `--base-url` / `--api-key-env` from #203; no keys are printed):

| Gateway | Model route | Pass | Avg latency | Cost |
| --- | --- | --- | --- | --- |
| LiteLLM `127.0.0.1:4000/v1` | `codestral` (Mistral direct) | 7/7 | 1614 ms | $0 |
| OmniRoute `127.0.0.1:20128/v1` | `team-coding` (Priority: codestral-latest, then groq gpt-oss-120b) | 7/7 | 3890 ms | $0 |

Reading: equal quality on this small set; LiteLLM is ~2.4x faster for the same provider because the OmniRoute combo's first healthy target in the Priority order was `groq/openai/gpt-oss-120b` in several calls (reasoning model, longer generations).

Decision (hub): keep LiteLLM as the default worker gateway for `rx`; keep OmniRoute as the secondary lane (`rx <n> team`) and as a failover/health dashboard for the direct Mistral and Groq keys. To make `team-coding` as fast, reorder the combo so `mistral/codestral-latest` is first and gpt-oss second (it already is in the dashboard list, but latency shows gpt-oss was served first when Codestral was slow or rate-limited); re-measure after one week of use. Eight tasks are a smoke test, not a benchmark: do not generalise beyond "both are fit for small single-file edits".
