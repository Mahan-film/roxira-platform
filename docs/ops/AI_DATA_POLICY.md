# AI data policy: which providers may see which data

Code: `output_apps/enterprise_hub/modules/ai_policy/ai-data-policy.ts`. Config: `config/ai_data_policy.json`.
Model ids stay only in `config/models.yaml`; this policy never names a model.

## Data classes

| Class | Examples |
|---|---|
| `public` | public law text, marketing copy, crawled pages |
| `tenant-business` | a tenant's accounting, HR, CRM, inventory data; import headers and masked sample rows |
| `personal` | national ids with names, phones, bank accounts |

## Provider classes

A role in `config/models.yaml` has a `data_policy`. `ai_data_policy.json` maps it to a provider class:

- `non_sensitive_only` (the `free` role, free tiers) is `may_log`: the provider may log or train on prompts.
- `standard` (paid roles such as `cheap`, `strong`) is `no_log`: paid terms, and requests also send `provider.data_collection = deny`.

A role with no `data_policy`, or one the file does not map, counts as `may_log`. A model id ending in `:free`, and
`openrouter/free`, is `may_log` whatever role lists it, so moving a free id into a paid role cannot slip past the policy.

## The switch

`mode` in `config/ai_data_policy.json`:

| Mode | public | tenant-business | personal |
|---|---|---|---|
| `test_accounts` (today) | may_log, no_log | may_log, no_log | may_log, no_log |
| `production` | may_log, no_log | no_log | no_log |

`test_accounts` is the owner decision of 2026-10-14 (AGENTS.md section 4): every customer is a test account and the
data is not confidential, so free tiers are tried first and paid models are the fallback.

**Before onboarding real paying customers with confidential data:** set `"mode": "production"` (and revisit the privacy
page, as AGENTS.md section 4 says). Emergency flip without a deploy: environment variable `ROXIRA_AI_DATA_MODE=production`
on the backend. The assistant then only calls `no_log` roles, which are the paid ones; the free roles stay available for
`public` data.

Fail closed: a missing or invalid policy file, an unknown mode or a malformed table gives the `production` rules. The
`production` table can never be edited looser than those rules.

## Where it is enforced (NestJS backend)

- Assistant (`modules/assistant/services/assistant-llm.service.ts`): candidate models are filtered for `tenant-business`
  data before any call. With nothing left it answers 503 instead of calling a may-log provider.
- Import column mapping (`modules/data_import/services/openrouter-mapping.service.ts`): `resolveModelId()` asserts that the
  `cheap` role may see `tenant-business` data. Cells are still masked first by `modules/data_import/masking.ts`.
  A refusal takes the existing deterministic fallback mapping.

Not covered yet: the Python AI core (`smartjudge`) and the invoice-capture LLM service; they have their own role
selection (`llm_router.py`, `capture-llm.service.ts`). Use `ai-data-policy.ts` the same way when they handle tenant data.

Tests: `modules/ai_policy/ai-data-policy.spec.ts`, and the production-mode case in `modules/assistant/assistant-llm.service.spec.ts`.
