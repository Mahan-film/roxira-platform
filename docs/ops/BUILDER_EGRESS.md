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
| `egress_probe.sh` | proof, run as the builder user: non-allowlisted host fails, allowlisted works, xray port refused, gateway reachable, docker socket unusable, no privileged group, no token in env |
| `apply_root.sh` | the ONE root install script: users, dirs, runner, tinyproxy, nft lock, units. `--dry-run` default, `--apply`, idempotent, an UNDO line per step |
| `builder_run.py` | root-side runner behind the wrapper verb `run-builder <task-id>` (installed root-owned as `/usr/local/libexec/roxira-lane/builder-run`) |
| `builder-shim`, `builder_io.py` | lane-side shim (used as `OPENCODE_BIN` when `ROXIRA_BUILDER=1`): stages the task, calls the verb, imports the result |
| `roxira-builder-proxy.service`, `roxira-builder-nft.service` | the proxy instance and the persistent nft lock |
| `src/ops/test_builder_run.py` | offline tests: task id and path handling, wrapper argument checks, sandbox command line, shim/import, `apply_root.sh` |
| `src/ops/test_builder_egress.py` | unit tests (collected by the CI `pytest` job) |

How it works: the nft table matches only the builder uid and accepts only loopback TCP to the listed ports (the gateway
tunnel and the allowlist proxy); everything else, including the xray port, the LAN and DNS, is rejected. The proxy
(tinyproxy, default deny, TLS port only) allows only the listed hosts and forwards to the existing xray HTTP inbound.
A builder therefore cannot bypass the filter by talking to xray directly.

## Builder separation (decided design, issue #1022)

The agent process (OpenCode) runs as the unprivileged user `roxira-builder`: no docker group, no sudo, no GitHub token,
no provider key, home closed, network only through the uid table and the proxy above. The lane stack (tunnel, orch,
taskq, publisher with `gh_redact.py`, `run_task.sh`, `lane-run`) stays under the lane user. Switching uid needs root,
so the existing narrow root wrapper `roxira-lane-root` (docs/ops/BOX_LANE_RUNNER.md) got ONE more verb:

```
sudo -n /usr/local/sbin/roxira-lane-root run-builder <task-id>      # task-id: 1-12 digits, nothing else
```

- The wrapper checks the digits with a shell glob, then execs the root-owned `builder-run` with the lane user fixed in the
  wrapper text. No other argument, no path, no shell string, no environment from the caller (sudo resets it).
- `builder-run` reads the task ONLY from `/srv/data/roxira-lane/tasks/<id>/` (a root-owned directory; the lane user has an
  ACL to create task directories there): `prompt.txt`, `model.txt` (one of three gateway groups), `config.json` (JSON; every
  provider URL must be the loopback gateway), optional `gateway.env` (one line, the capped per-machine virtual key,
  strict charset), `work/` (the tree the builder edits) and `out/`. Every file is opened below a directory descriptor with
  `O_NOFOLLOW` and checked with `fstat` (regular file, owned by the lane user, one link, size cap), the ancestors of the
  tasks directory must be root-owned and not group/other-writable. A planted symlink, hard link or FIFO is refused.
- It refuses to start unless the nft table `roxira_builder` is loaded (fail closed), runs one builder at a time (lock),
  and starts ONE transient systemd unit with a fixed property set (`NoNewPrivileges`, empty capability set,
  `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp/Devices/PIDs`, `TemporaryFileSystem=/srv` with only this task's
  `work/` bound back in, docker sockets inaccessible, `IPAddressDeny=any` except loopback, `MemoryMax=3G`, `CPUQuota=200%`,
  `TasksMax`, `RuntimeMaxSec=3600`). The command inside is fixed: `builder-run --launch` execs `/opt/roxira-builder/bin/opencode
  run -m <model> <prompt>` with the prompt read from a read-only mount (never on the `systemd-run` command line;
  `--expand-environment=no`). The environment is `/etc/roxira-lane/builder-proxy.env` plus fixed variables and, if present,
  the gateway key, through a root-only `EnvironmentFile` (never argv).
- Output: `out/builder.log` and `out/result.json`, written by root and handed to the lane user. `work/` is chowned to the
  builder for the run and back afterwards (no symlink following, hard-linked files refused).
- Lane side (`ROXIRA_BUILDER=1`, default OFF): `lane-run` sets `OPENCODE_BIN` to `builder-shim`; `run_task.sh` is unchanged and
  calls it like opencode. The shim copies the worktree WITHOUT `.git` into `work/`, runs the verb, then imports the result
  into the real worktree as plain files (no symlink changes, no `.git`, size limits; anything refused makes the run fail).
  `run_task.sh` then does its usual scope check, commit and diff as the lane user, so the builder never touches git
  metadata. The copy gets a FRESH `git init` (no remote, no history, no hooks, no host config) and nothing of the real
  `.git`: OpenCode takes its project root from git, and without a repository the root is `/`, so the relative scope
  patterns of `run_task.sh` (`docs/agents/**`) never match and every write is denied. The builder therefore cannot reach
  the real history or the remote (it also has no token). The lane user never runs git inside `work/` (a builder-written
  `.git/config` could run code) and the importer ignores that `.git`; nested `.git` entries are still refused.
- ripgrep: OpenCode searches with `rg`. If none is on `PATH` it downloads one into the builder's cache from a release
  host that is not on the allowlist, and every search fails. `apply_root.sh` installs the `ripgrep` package (root-owned,
  `/usr/bin/rg`, on the default `PATH` of the unit). No allowlist change.
- The gateway key is a capped virtual key for the loopback gateway, not a provider key. The builder holds it in its own
  process environment (it must, to call the gateway). Any local user can reach the loopback tunnel, so the key is only as
  secret as the box's local users; the protection is the server-side restriction (agent groups only, daily cap) and
  rotation like any virtual key, not secrecy from the builder.
- A free-text prompt can still talk a model into abusing what the builder CAN do: edit files in `work/` and call the
  gateway and the allowlisted hosts. Everything else is outside its reach by uid, mount and firewall.

## Tokens and publishing: draft-PR-only

- Builders hold **no** GitHub token and **no** LLM provider key. LLM calls go to the loopback tunnel with the capped
  per-machine virtual key (see above). Builders never push and never commit: the runner commits as the lane user.
- **No separate publisher user is created** (decided design). The publisher (push of `agent/*` branches, draft PRs) stays in
  the lane stack under the lane user and runs everything it posts through `gh_redact.py`. A `roxira-pub` user would need its
  own wrapper verb to push and a second place for the credential; it buys little as long as the builder (the only
  untrusted code) cannot reach the lane user's files. Revisit it if the lane user stops being the owner's own account.
  The consequence to accept: the lane user is in the `docker` group (see below), so the push credential is only as safe
  as that account.
- `main` is protected by the repository ruleset where the plan has it (require PR and status checks, block force-push and
  deletion; the publisher must not be on the bypass list). On a plan without rulesets, the no-write-token rule for the
  builder carries all the weight. Merging stays with the hub/owner.

## Owner steps (in this order)

Names in angle brackets are placeholders; never paste a key, host or user into chat, issues or PRs. Everything below
that needs root is yours to run; nothing here is run for you. `<lane user>` = the user that runs the lanes.

1. Review `allowlist.txt` (one place: `domain` and `port` lines). Optional preview of the generated files, still no change:
   `python3 scripts/ops/ci_box/builder_egress/gen_egress.py --out-dir ~/builder-egress-preview` (dry run prints the diff).
2. **Dry run of the root part** (changes nothing, prints every step and its UNDO line, checks the nft syntax in a
   throwaway namespace when possible):
   `sudo bash scripts/ops/ci_box/builder_egress/apply_root.sh --lane-user <lane user>`
3. **Apply** (idempotent; run it again any time): `sudo bash scripts/ops/ci_box/builder_egress/apply_root.sh --lane-user <lane user> --apply`.
   It creates `roxira-builder` (system user, no shell, no groups), the directories, the root-owned runner and probe copies,
   copies the lane user's OpenCode binary to `/opt/roxira-builder/bin/opencode` (`--opencode-src FILE` to override),
   installs tinyproxy, stops the packaged default instance (it listens without a filter), installs our filter/config and
   the unit `roxira-builder-proxy.service`, waits for `127.0.0.1:10810`, runs `nft -c`, loads the table and installs
   `roxira-builder-nft.service` so it is reloaded at boot. The proxy needs the box proxy to be on for `apt`
   (`sudo box-proxy on`). It never changes any user's groups: `docker` membership of existing users is only read and printed.
4. **Add the verb** (admin, once; dry run first, then apply):
   `sudo bash scripts/ops/ci_box/lane_runner/install_root.sh --lane-user <lane user>` then the same with `--apply`.
   This rewrites the wrapper with `run-builder`; the sudoers line is unchanged (still ONE line).
5. **Probe** (section "Probe plan" below), as the builder user, before the flag is on.
6. **Turn the flag on** for one run: `ROXIRA_BUILDER=1 lane-run --smoke`. It must print `"smoke_ok": true`. To keep it on for the
   queue, add `Environment=ROXIRA_BUILDER=1` to `roxira-lane-taskq.service` (user unit) only after the smoke test passes.
   Off again: unset it. Nothing else changes.
7. Hooks: OpenCode (the builder) does not use the Claude Code `pretool_guard.py`; its limits are the permission overlay of
   `run_task.sh` plus the uid/mount/firewall limits above. If a Claude Code builder is ever run, add the PreToolUse hook
   (matcher `Bash|Write|Edit|MultiEdit`, command `python3 -I <root-owned copy>/pretool_guard.py`). Set
   `REDACT_NAMES_FILE=<file outside the repo, one personal name per line, mode 600>` in the publisher's environment.
8. New dependencies: a builder PR that changes `package.json`, a lockfile, `requirements*.txt` or `pyproject.toml`
   needs a human review of the added names before merge.

### Roll back (reverse order; each step also printed as UNDO by `apply_root.sh`)

- Flag: unset `ROXIRA_BUILDER` (lane-run then calls opencode directly as before).
- Verb: re-run `install_root.sh` from the previous revision, or delete `/usr/local/sbin/roxira-lane-root` and `/etc/sudoers.d/roxira-lane-root`.
- Lock: `systemctl disable --now roxira-builder-nft; nft delete table inet roxira_builder; rm /etc/systemd/system/roxira-builder-nft.service /etc/roxira-lane/roxira_builder.nft`.
- Proxy: `systemctl disable --now roxira-builder-proxy; rm /etc/systemd/system/roxira-builder-proxy.service /etc/tinyproxy/roxira-builder.*; systemctl daemon-reload`.
- Files and user: `rm -rf /opt/roxira-builder /usr/local/libexec/roxira-lane /etc/roxira-lane/builder-proxy.env`; `setfacl -x u:<lane user> /srv/data/roxira-lane/tasks`; `userdel roxira-builder`; `rm -rf /var/lib/roxira-builder /srv/data/roxira-lane`.

## Probe plan (egress_probe.sh)

The builder cannot read the repo checkout, so run the root-owned copy that `apply_root.sh` installed:

```
sudo -u roxira-builder env -i PATH=/usr/bin:/bin HOME=/var/lib/roxira-builder \
  bash /usr/local/libexec/roxira-lane/probe/egress_probe.sh
```

1. **Negative control** (proves the probe can fail): `sudo systemctl stop roxira-builder-nft`, run the probe, then
   `sudo systemctl start roxira-builder-nft`. With the table gone, "xray port refused" must say FAIL (the xray inbound is
   open to any local uid). "Direct internet refused" may still say PASS if the existing box lock already blocks a new
   uid; that is fine and worth noting, but only the xray line is a reliable control. If the xray line says PASS with the
   table unloaded, the probe is blind and its other PASS lines mean nothing.
2. **With the lock loaded** every line must say PASS: non-allowlisted host refused through the proxy; direct internet
   refused; xray port refused; `api.github.com` and `registry.npmjs.org` reachable through the proxy; the gateway tunnel on
   loopback reachable (`BUILDER_PROBE_GATEWAY=0` skips it only while the tunnel is down); docker socket not connectable; no
   `docker/sudo/adm/lxd` group; no other home readable; no token variable or key-shaped value in the environment.
3. **Other uids unaffected** (the table matches only the builder uid): as the lane user `curl -sS -x http://127.0.0.1:10809 https://api.github.com/zen`
   still works, and `systemctl --user is-active roxira-gateway-tunnel` is still `active`. Docker users keep working:
   `sudo -u <docker user> docker ps` is unchanged.
4. **Sandbox view** (after step 4): `ROXIRA_BUILDER=1 lane-run --smoke`; then `journalctl -u 'roxira-builder-*' -n 50` shows
   the unit ran as `roxira-builder`. While a run is active, `ps -o user,cmd -C opencode` shows the builder user, not the lane user.
5. Paste only the PASS/FAIL lines to the PR.

## Not verified

Verified offline (on the authoring box, no root): the unit tests (`src/ops/test_builder_run.py`, all pass together with
`test_builder_egress.py`); the generated nft file passes `nft -c` in a throwaway user namespace (with the user name
`nobody`); the proxy configuration was started unprivileged with the packaged tinyproxy 1.11.3 and behaves as intended
(allowlisted host through CONNECT works, other hosts, look-alike host names, and CONNECT to other ports are refused);
`systemd-analyze verify` accepts both units and the sandbox property set; the root wrapper text, with the verb, was
exercised with a stub runner.

Not verified (needs root or the live box):

- `nft -c`/`nft -f` with the real user name, and the lock on live traffic (does the existing box lock or the xray inbound
  treat the new uid or the proxy's dynamic uid differently?); the ruleset on top of the existing box lock.
- The transient unit itself: `systemd-run` with `BindPaths` under a `TemporaryFileSystem=/srv`, the read-only bind to
  `/run/roxira-task`, `PrivatePIDs`, `IPAddressDeny` (cgroup BPF) and the stop-on-TERM path were checked for syntax only.
- The shim's timeout path (`run_task.sh` kills it with TERM; the shim forwards TERM to `sudo`, which relays it to the root
  runner, which stops the unit): the signal relay was checked with a plain `sudo` child, not with the real runner.
  `RuntimeMaxSec=3600` is the backstop.
- That the packaged tinyproxy runs under `DynamicUser=yes` with these hardening options, and that `FilterType ere`
  behaves identically through the unit (it was run unprivileged, not as a service).
- `setfacl` on the data disk (ACL mount support), the ACL's effect on new task directories, the sudo path, the OpenCode
  binary running as another user from `/opt` (a single ELF file, copied), and a real model call from the sandbox.
- Plain HTTP (port 80) requests to an allowlisted host are forwarded by tinyproxy (it only restricts CONNECT ports); only
  allowlisted hosts are reachable, so the effect is limited, but "TLS only" holds for CONNECT, not for plain GET.
- Redaction is pattern based: a secret with an unknown shape, a name not in `REDACT_NAMES_FILE`, and 4-part version
  numbers (false positive for IPv4) are the known gaps. Never rely on it as the only control.
- Domain list completeness: tools that fetch from other hosts (Playwright browsers, Docker registries, Go proxy) fail
  closed; add them to `allowlist.txt` deliberately, then re-run `apply_root.sh --apply`.

## What depends on the `docker` group today

The lane user and the phone-stack user (which uses `docker exec`) are in the `docker` group
(`docs/ops/LINUX_CI_BOX.md`). A docker-group user can start a root container and so bypasses every uid firewall rule.
Consequences for this design:

- Builders must never be in `docker` (the script refuses and the probe checks). They run as `roxira-builder`, not as either of these users.
- `apply_root.sh` does not change any existing user's groups and refuses any option that mentions docker; removing the
  phone-stack user or the lane user from `docker` would break the phone stack and CI work. If that is ever wanted it is a separate, deliberate change.
- The lane stack (orch, taskq, publisher, push credential) stays under a docker-group user, so a compromise of that user
  is root-equivalent on the box. The builder separation protects the lane user from the builder, not from itself.
