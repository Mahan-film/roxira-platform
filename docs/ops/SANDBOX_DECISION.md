# Sandbox decision: bubblewrap version and gVisor trial (box action 3)

Status: decision note, nothing installed. Source: item 4 and action 3 of `docs/strategy/research/DEEP_RESEARCH_2026-11-23_PLAN.md`.

## Finding

| Check | Result |
|---|---|
| `bwrap --version` on the box | `bubblewrap 0.11.1` (Ubuntu package `0.11.1-1ubuntu0.3`, `/usr/bin/bwrap`) |
| Plan threshold | 0.11.2 or higher. The box is **below** it. |
| Where lane-run and builder separation call it | **Nowhere.** `lane-run`, `builder_run.py` (installed as `/usr/local/libexec/roxira-lane/builder-run`) and `roxira-lane-root` contain no `bwrap`. Builder isolation is `systemd-run` with unit properties (`ProtectSystem=strict`, `PrivateTmp`, `RestrictNamespaces`, `CapabilityBoundingSet=` empty, `IPAddressDeny=any` plus loopback, `MemoryMax`, `TasksMax`, `TemporaryFileSystem=/srv:ro`, inaccessible docker socket) plus the nft egress lock. See `docs/ops/BUILDER_EGRESS.md`. |
| Who does call bwrap | The distro package is installed for tools that ship their own sandbox on the box (agent CLIs use it for their command sandbox). It is not part of the lane or builder trust boundary. |

So the plan's premise ("the bubblewrap version used by lanes") does not match the box: the version is below the threshold, but
the builder boundary does not depend on it. The exposure is the agent tool sandbox, not the builder jobs.

The plan marks the distro bubblewrap CVE id as unverified. This note does not name one and does not restate the 0.11.2
changelog. Before acting on the upgrade option, read the upstream 0.11.2 release notes and the Ubuntu security tracker
for the `bubblewrap` source package (the Ubuntu build may carry a backport that the version number hides).

## Threat addressed

A process inside a user-namespace sandbox that escapes it (via a bubblewrap flaw, a bad bind, or a kernel/namespace bug)
lands as the lane or builder user with that user's files and network. For builders the worst case is: reading what the
builder user can read, and abusing the loopback gateway and the allowlist proxy. Production keys are not on the box by
design, the docker socket is masked, and the nft lock limits the network. The goal here is to shrink the chance that an
untrusted-code job reaches the host kernel through one shared kernel surface.

## Options

| | A. Upgrade bwrap to 0.11.2+ from source | B. Trial gVisor (`runsc`) for builder jobs |
|---|---|---|
| What it changes | Same tool, newer fix level | Adds a user-space kernel; syscalls from the job hit gVisor, not the host kernel |
| Addresses | Known bwrap flaws fixed upstream | Host-kernel attack surface for untrusted builder code; defence in depth even if bwrap or a namespace bug exists |
| Builder impact | None (builders do not use bwrap) | Needs a new execution path: OCI bundle or Docker runtime for the builder instead of `systemd-run` properties; the egress lock, `/srv` masking and cgroup limits must be re-expressed |
| Cost | Small: build, install to a non-system prefix, point agent CLIs at it | Medium to large: install `runsc`, root-owned runtime config, performance and compatibility testing (git, node, pytest, npm under gVisor) |
| Maintenance | We own patching a source build; it drifts from the distro | One more root-installed component to track |
| Root needed | Yes, to put it on the system path (or no, if installed under a user prefix and chosen by the agent CLI config) | Yes (runtime install) |
| Risk | Low. Source build is unsigned by the distro; verify the tarball signature and pin the hash | Medium. Rootless Docker is already used for CI; mixing runtimes adds failure modes |

## Recommendation

1. Now: do nothing as root. The box status page reports the bwrap version and shows WARN below 0.11.2
   (`collect_sandbox` in `scripts/ops/ci_box/status_page/box_status.py`). Nothing alerts; it is visible on the page.
2. Next: option A in a user prefix (`~/.local`, not on the system path) for the agent tool sandbox, after reading the upstream
   release notes. Verify the signature, record the hash, and the WARN clears when the agent CLI's path resolves to it
   (the collector checks the `bwrap` on `PATH`; adjust the collector if the user-prefix build is chosen).
3. Later, only if builders start running third-party or generated code beyond today's agent-driven tasks: trial gVisor for
   builder jobs in a separate worktree with a throwaway task, comparing wall time and test pass rate against the current
   `systemd-run` sandbox. Adopt only if it holds the existing egress and `/srv` masking properties unchanged.
4. Do not replace the `systemd-run` builder sandbox with bwrap. It already provides more (cgroup limits, IP deny, capability
   bounding set) than a bwrap wrapper would.

## Not done here

- No package was installed or changed. No root action was run.
- gVisor was not evaluated empirically; the table is design-level.
