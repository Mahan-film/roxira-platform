# Builder egress lock, no-token builders, redaction (R20-6, issue #1022)

Goal: a builder agent on the CI box can reach only (1) the key-pool gateway tunnel on loopback, (2) the Git host and the
package registries through an allowlist proxy. It holds no token that can write to `main` or reach an LLM provider
directly, and text it posts to GitHub is stripped of keys, IPs, e-mails, phone numbers and personal names first.
Design source: `docs/strategy/R20_DIGEST.md` D5. Everything is in `scripts/ops/ci_box/builder_egress/`.
The existing box lock (loopback + LAN only for the other users) and the production lock
(`scripts/infra/server_agents/agent_egress.nft`) are not changed.

| File | Purpose |
|---|---|
| `allowlist.txt` | the one place: `domain <host>` and `port <loopback port>` lines |
| `gen_egress.py` | renders `roxira_builder.nft`, `tinyproxy.conf`, `tinyproxy.filter`, `builder-proxy.env` from it. **Dry run by default** (prints a diff); `--write` writes into `--out-dir` only |
| `redact.py` | stdlib filter: key shapes (Anthropic, OpenRouter, OpenAI, GitHub, GitLab, Google, Groq, HF, Slack, AWS, npm, Telegram, JWT), `KEY=`/`Bearer` secrets, PEM, URL credentials, e-mail, IPv4/IPv6 (loopback kept), phones; names from `REDACT_NAMES_FILE` |
| `gh_redact.py` | front for `gh`: redacts `--body/--title/--body-file` of `pr`/`issue`/`release` writes, refuses `gh api` writes |
| `pretool_guard.py` | Claude Code PreToolUse hook: blocks `git push`, remote changes, bare `gh` writes, edits under `.github/workflows/`, installs without `--ignore-scripts`, secret-shaped text in commands |
| `egress_probe.sh` | proof, run as the builder user: non-allowlisted host fails, allowlisted works, xray port refused, no token in env |
| `src/ops/test_builder_egress.py` | unit tests (collected by the CI `pytest` job) |

How it works: the nft table matches only the builder uid and accepts only loopback TCP to the listed ports (the gateway
tunnel and the allowlist proxy); everything else, including the xray port, the LAN and DNS, is rejected. The proxy
(tinyproxy, default deny, TLS port only) allows only the listed hosts and forwards to the existing xray HTTP inbound.
A builder therefore cannot bypass the filter by talking to xray directly.

## Tokens: draft-PR-only

- Builders hold **no** GitHub token and **no** LLM provider key. LLM calls go to the loopback tunnel with the
  per-machine virtual key that `lane-run` passes only to the one process that needs it (docs/ops/BOX_LANE_RUNNER.md,
  PR #1081). Builders commit locally; they never push.
- A separate **publisher** user (not the builder uid, home not readable by it) pushes `agent/*` branches and opens or
  updates **draft** PRs. Its credential: a fine-grained PAT limited to this one repository with only Contents:
  read/write and Pull requests: read/write; **no** Workflows, Administration, Actions or Secrets permission.
  A PAT cannot be limited to branch names, so the protection of `main` is the repository ruleset: require PR, require
  status checks and a review, block force-push and deletion for `main`; the publisher must not be on the bypass list.
- The publisher runs everything it posts through `gh_redact.py`. Merging stays with the hub/owner.

## Owner steps (in this order)

Names in angle brackets are placeholders; never paste a key, host or user into chat, issues or PRs. This pack changes
nothing on the box: every command below is yours to run.

1. Review `allowlist.txt` (add or remove a `domain` line; one place). Then render on the Mac or the box, still dry-run:
   `python3 scripts/ops/ci_box/builder_egress/gen_egress.py --user <builder user>`
   and read the diff. Add `--write --out-dir ~/builder-egress` to write the files there (outside the repo; do not commit them).
   Run the dry run again with the same `--out-dir` later to see what a change to `allowlist.txt` would alter.
2. Create the builder and publisher users (admin): two separate unprivileged users, no sudo, builder not in the
   `docker` group (a docker-group user bypasses every uid rule; see "Not verified").
3. Install tinyproxy (admin), copy `tinyproxy.filter` to `/etc/tinyproxy/roxira-builder.filter` and `tinyproxy.conf`
   to `/etc/tinyproxy/roxira-builder.conf`, then run a second instance:
   `sudo systemctl edit --force --full roxira-builder-proxy.service` with
   `ExecStart=/usr/bin/tinyproxy -d -c /etc/tinyproxy/roxira-builder.conf`, `DynamicUser=yes`, `Restart=always`;
   `sudo systemctl enable --now roxira-builder-proxy`. Do not change the xray config.
4. Load the firewall (admin), only after step 3 works: `sudo nft -c -f roxira_builder.nft` (syntax check, changes
   nothing), then `sudo nft -f roxira_builder.nft`. Persist it by adding an `include` of the file to the box's
   nftables config the same way the existing box lock is loaded. Undo: `sudo nft delete table inet roxira_builder`.
5. Give the builder its environment: `set -a; . <builder-proxy.env>; set +a` in the builder's service/unit
   (`EnvironmentFile=`). It contains no secret and sets `NPM_CONFIG_IGNORE_SCRIPTS=true`.
6. Hooks: in the builder's Claude Code settings add a PreToolUse hook (matcher `Bash|Write|Edit|MultiEdit`) with command
   `python3 -I <repo>/scripts/ops/ci_box/builder_egress/pretool_guard.py`. Set `REDACT_NAMES_FILE=<file outside the
   repo, one personal name per line, mode 600>` in the publisher's and builder's environment.
7. Publisher: use `python3 <repo>/scripts/ops/ci_box/builder_egress/gh_redact.py ...` wherever it would call `gh`.
   Create the PAT as described above and the ruleset on `main`.
8. Prove it, as the builder user: `sudo -u <builder user> bash scripts/ops/ci_box/builder_egress/egress_probe.sh`.
   All lines must say PASS. Paste only the PASS/FAIL lines to the PR.
9. New dependencies: a builder PR that changes `package.json`, a lockfile, `requirements*.txt` or `pyproject.toml`
   needs a human review of the added names before merge (add it to the review checklist; no automation here).

## Not verified (I cannot reach the box)

- No tinyproxy or nft command was run. The directive set (`Filter`, `FilterType ere`, `FilterDefaultDeny`,
  `ConnectPort`, `Upstream http`) and the nft syntax follow the documented formats but are untested; `nft -c` (step 4)
  and a tinyproxy start (step 3) will tell. Whether tinyproxy's filter applies the regex to the host of a CONNECT
  request, and whether `Upstream http` works with CONNECT to the xray HTTP inbound, must be seen in `egress_probe.sh`.
- The generated files were checked only by unit tests (text content), not loaded.
- `docker`-group members and any root/sudo path bypass a uid firewall. `mahanfilms` is in the `docker` group
  (`docs/ops/LINUX_CI_BOX.md`), so builders must not run as that user.
- Claude Code hook semantics (exit code 2 blocks and shows stderr) are taken from the Claude Code docs, not run here.
  A PostToolUse hook cannot rewrite what a tool already did, so redaction is done where text leaves (`gh_redact.py`),
  not after the fact. A builder that calls `curl` against the GitHub API directly is stopped by the missing token, not
  by redaction.
- Redaction is pattern based: a secret with an unknown shape, a name not in `REDACT_NAMES_FILE`, and 4-part version
  numbers (false positive for IPv4) are the known gaps. Never rely on it as the only control.
- GitHub fine-grained PAT permission names and the ruleset options were not re-checked against live GitHub docs.
  If the repo goes private on the Free plan (R20 D1) rulesets disappear: the no-write-token rule then carries all the weight.
- Domain list completeness: tools that fetch from other hosts (Playwright browsers, Docker registries, Go proxy)
  fail closed; add them to `allowlist.txt` deliberately.
