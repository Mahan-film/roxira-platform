# Feature flags (T203)

Per-tenant and per-country-pack flags with OpenFeature and flagd (both Apache-2.0).

| Part | Where |
|---|---|
| Flag definitions | `config/flags/flags.json` (flagd schema v0) |
| flagd container | service `flagd` in `docker-compose.prod.yml`: image `ghcr.io/open-feature/flagd:v0.18.2` pinned by digest, `mem_limit: 64m`, config mounted read-only |
| Port | `8013` (flagd gRPC + HTTP). Published on `127.0.0.1:8013` only; containers reach `flagd:8013` on `roxira_net`. Not in the AGENTS.md section 7 reserved list and not used by any other compose file in the repo |
| NestJS | `output_apps/enterprise_hub/modules/feature_flags/` (`FeatureFlagsModule`, global) |
| SDKs | `@openfeature/server-sdk` 1.23.0, `@openfeature/flagd-provider` 0.18.0 |

flagd watches the mounted directory, so editing `flags.json` on the server applies in seconds with no restart and no deploy of the backend. Flag changes still go through a reviewed PR (the file is in git).

## Evaluation context

The backend sends, for every evaluation:

- `targetingKey` and `tenantId`: the tenant id from the authenticated user (`request.user.tenantId`, set by `AccessGuard`). Never taken from the request body, query or headers.
- `countryPack`: ISO alpha-2 of the tenant's country pack (`IR`, `MY`, later `DE`), from the request or resolved with `CountryPackResolver`.

## Add a flag

1. Add it to `config/flags/flags.json`. Name: `<area>.<feature>` or `country-pack.<cc>.enabled`. Always use variants `on` / `off` (boolean) and a safe `defaultVariant`.
2. Target with JSON Logic in `targeting` (see the three examples in the file):
   - one tenant or a list: `{"in": [{"var": "tenantId"}, ["<uuid>", ...]]}`
   - one country pack: `{"==": [{"var": "countryPack"}, "DE"]}`
   - percentage rollout, sticky per tenant: `{"fractional": [{"var": "targetingKey"}, ["on", 10], ["off", 90]]}`
3. Set `metadata.failMode` (`open` or `closed`) and mirror it in `modules/feature_flags/feature-flags.defaults.ts`. The metadata is documentation; the TypeScript map is what the code uses.
4. Guard the code: `@RequireFlag('area.feature')` on the controller or handler (404 when off), or `featureFlags.isEnabled('area.feature', { tenantId, countryPack })` in a service or worker.
5. Test with `InMemoryProvider` (see `feature-flags.spec.ts`).

## When flagd is down

`FeatureFlagsService` never throws. If `FLAGD_HOST` is unset, flagd is unreachable, the flag is unknown or evaluation errors, it returns the per-flag fallback:

- fail closed (default): new features stay off.
- fail open (`failOpen: true` in `feature-flags.defaults.ts`, or `@RequireFlag('x', { failOpen: true })`): existing features stay on. Use this only for a kill switch on something that already shipped, so a flagd outage never removes it.

## Kill-switch convention for new modules

Every new module ships behind a flag named `<module>.enabled` (or `country-pack.<cc>.enabled` for a pack), default `off`, fail closed, and every controller of the module carries `@RequireFlag`. Roll out: your own test tenant first, then a tenant allowlist, then `fractional`, then default `on`. To kill: set `defaultVariant` to `off` and remove the allowlist match. After the module is stable, add a kill switch (default `on`, `failOpen: true`) only if you may need to disable it fast.

## Rollout by tenant

Allowlist: put tenant UUIDs in the `in` list. Staged: widen the list in separate PRs. Percentage: `fractional` buckets by `targetingKey` (tenant id), so a tenant stays in the same bucket as the percentage grows.

## Python AI core

Not wired (the `openfeature-sdk` 0.10.0 and `openfeature-provider-flagd` 0.6.1 packages pull in gRPC, which is not cheap for the AI core image). Use flagd's HTTP evaluation instead, from a container on `roxira_net`:

```bash
curl -s -X POST http://flagd:8013/flagd.evaluation.v1.Service/ResolveBoolean \
  -H 'Content-Type: application/json' \
  -d '{"flagKey":"assistant.ai-drafts","context":{"targetingKey":"<tenant-id>","tenantId":"<tenant-id>","countryPack":"IR"}}'
# {"value":true,"reason":"TARGETING_MATCH","variant":"on"}
```

Wrap it in a short timeout (for example 300 ms) and apply the same fail-open / fail-closed rule when the call fails. Pass the tenant id from the authenticated request, never from a client-supplied field.

## Operations

- Check flag file validity before merging: `python3 -c "import json;json.load(open('config/flags/flags.json'))"`; flagd logs a parse error and keeps the previous flags if the file is invalid.
- Logs: `docker logs roxira_flagd`.
- Backend env: `FLAGD_HOST=flagd`, `FLAGD_PORT=8013` (set in `docker-compose.prod.yml`). Remove them to run without flagd.
- No dev compose file exists for the backend, so the flagd service is only in `docker-compose.prod.yml`. For local runs: `docker run --rm -p 127.0.0.1:8013:8013 -v $PWD/config/flags:/etc/flagd:ro ghcr.io/open-feature/flagd:v0.18.2 start --uri file:/etc/flagd/flags.json`.
