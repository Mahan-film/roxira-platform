# LiteLLM gateway: pin and posture note

Date: 2026-11-23. Scope: the key-pool gateway (`roxira_keypool`, bound to 127.0.0.1:4000).

## Pinned image

- Config: `config/key_pool.yaml` -> `gateway.image` =
  `ghcr.io/berriai/litellm:v1.105.6@sha256:df829230aab5d0b8590afbdb6569a41956c177985201f92949b9d63d88147003`.
- The digest is the multi-arch index digest the ghcr.io registry returned for tag `v1.105.6` on 2026-11-23.
  The gateway container is not on the box where this was done, so the digest of the running container could not be
  read with `docker image inspect`. On the gateway host, confirm with
  `docker image inspect --format '{{index .RepoDigests 0}}' <image>` (it must show the same digest).
- Version is v1.105.6. It is not v1.107.0 (nor any 1.107.x or rc); `upgrade.py` still refuses non-stable tags.
- `upgrade.py` accepts `vX.Y.Z[-stable][@sha256:<64 hex>]`. A future upgrade passes the new tag together with its digest.

## Posture: keep behind the key pool for now

- The gateway stays an internal component behind the key pool: loopback bind only, no public route, and no callers
  that bypass the pool router and `KEYPOOL_MASTER_KEY`.
- No production-capable keys go into it. Only free-tier or spend-capped keys, with the data-policy flags
  (`may_log`, `private`, `require`) from `config/key_pool.yaml`. Customer or case data uses only `require` groups.
- Do not widen its network (no extra published ports or bridges) and do not enable the admin UI or new integrations.

## Revisit triggers

1. A LiteLLM security advisory or CVE affecting v1.105.x, or a Critical in the image SBOM scan.
2. Wanting paid or production-capable provider keys in the pool.
3. Any plan to expose the gateway beyond loopback or to a second host.
4. A newer stable release that fixes something we hit: canary it with `upgrade.py`, then re-pin by digest.
5. Moving the gateway database (`keypool_db`, now postgres:16-alpine) to 17: needs dump and restore, not a tag bump.
