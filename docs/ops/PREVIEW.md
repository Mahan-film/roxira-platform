# Preview environments

`scripts/ops/preview.sh` starts an isolated Compose project named
`preview-<slug>`. It is for disposable review environments only; it never
joins an external network or volume and rejects host Docker access, host
networking, privileged containers, secret-bearing configuration, and bind
mounts.

The host envelope is one build at a time and at most two live previews. Every
preview receives exactly 1 CPU and 1 GiB, a deterministic non-production port,
and expires after 24 hours. No production data, volumes, network, or secrets
may enter a preview.

## Compose contract

The supplied compose file must declare these container labels, using the values
provided by the script:

```yaml
labels:
  roxira.preview: "${PREVIEW_LABEL}"
  roxira.preview.created: "${PREVIEW_CREATED_EPOCH}"
```

It may use `PREVIEW_MEM`, `PREVIEW_CPUS`, and `PREVIEW_PORT`; the script
exports all of them. Slugs are lowercase, hyphenated, and must not start with
`roxira`.

## Operations and kill switches

```sh
scripts/ops/preview.sh up feature-275 compose.preview.yml
scripts/ops/preview.sh down feature-275
scripts/ops/preview.sh gc
```

Use `--dry-run` with any command to print its Docker command without invoking
Docker. `down` is the immediate kill switch for one preview; `gc` removes
labelled previews whose creation epoch is at least 24 hours old. The two-preview
limit is enforced before `up` starts containers.
