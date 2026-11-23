# Root runner (`roxira-root`): fixed root actions without a sudo password

Issue #1315. Extends the wrapper pattern of `lane_runner/install_root.sh` (`run-builder`, #1236): one root-owned
wrapper, one sudoers line, fixed verbs, no free arguments. This one is for the routine box chores the owner used to
run with a password (phone key sync, restarts, status).

## Threat model (read this before installing)

This is a **passwordless path to a fixed set of root actions**. After install, anything that runs as Linux user
`mahan` or `mahanfilms` (a shell, an agent, a prompt-injected agent, a compromised dependency in their sessions) can
run these verbs with no password. It can run **nothing else** as root through this path.

What the verbs can do, and the worst case:

| Verb | Effect | Worst case if abused |
|---|---|---|
| `phone-keys-sync` | tests `GEMINI_API_KEY`..`_4` from the owner key file, writes the ones that return HTTP 200 into the phone agent env, restarts `voice-ai-agent` | restart loops (denial of service for the phone agent); the phone agent ends up using whichever *working* Gemini key `mahan` put in the key file (the file is owned by `mahan`) |
| `phone-restart` | restart `voice-ai-agent` | brief phone outage |
| `jit-restart` | restart `roxira-jit@light`, `roxira-jit@docker` as user `runner`; `try-restart` of the old runner (never starts it) | a running CI job is killed |
| `phone-status`, `jit-status`, `box-status` | read-only reports (no env values, no secrets) | none beyond service names, disk and temperature |

What it deliberately cannot do:

- **No free-form input.** Exactly one argument, the verb name. Anything else (no argument, extra argument, unknown
  verb) exits 2 and is logged. No paths, no unit names, no ids.
- **Nothing from `/home` or a worktree is executed or sourced.** The only `/home` path in the script is the owner key
  file, read as **data**. It is only used if it is the exact regular file at that path (no symlink in the path,
  checked with `realpath`), every key must match `^[0-9A-Za-z_.-]{20,100}$`, and a key is only ever sent to the
  Google API host over the box proxy, on curl's stdin (never on a command line, never printed or logged).
- **Frozen code.** Each verb runs only code in the frozen script `/usr/local/lib/roxira-root/roxira-root` plus
  root-owned system binaries by absolute path. The script reads no configuration from the environment (sudo's
  `env_reset` plus `Defaults !setenv`, and the script resets `PATH` and unsets loader variables).
- **Updating the frozen copy needs the owner's password**: only `install_root.sh` (run with `sudo`) writes it. There
  is no verb that changes the script, the stub or the sudoers file.
- **Everything is logged** to journald (`journalctl -t roxira-root`), with the caller uid from sudo and the exit code.
- **One at a time.** State-changing verbs take a lock (`/run/roxira-root.lock`, 60 s wait).

Not covered: root or the owner password stays the only way to change what the verbs do. If `mahan` or `mahanfilms`
is fully compromised, the attacker gets exactly the table above; keep that in mind before adding verbs. New verbs
must stay argument-free, must not read code from user-writable places, and need a PR plus a re-run of the installer.

## Layout

```
/usr/local/sbin/roxira-root            stub, root:root 0755: exec /usr/local/lib/roxira-root/roxira-root "$@"
/usr/local/lib/roxira-root/roxira-root frozen script, root:root 0755
/usr/local/lib/roxira-root/SHA256SUMS  hash of the frozen script
/etc/sudoers.d/roxira-root             root:root 0440 (visudo-checked):
    Defaults!/usr/local/sbin/roxira-root !setenv
    mahan      ALL=(root) NOPASSWD: /usr/local/sbin/roxira-root
    mahanfilms ALL=(root) NOPASSWD: /usr/local/sbin/roxira-root
```

Source: `scripts/ops/ci_box/root_runner/` (`roxira-root`, `install_root.sh`). Tests: `src/ops/test_root_runner.py`.

## Install (owner, once, needs the sudo password)

From a checkout of merged `main` that you have reviewed:

```bash
sudo bash scripts/ops/ci_box/root_runner/install_root.sh --apply
```

Without `--apply` (or with `--dry-run`) it only prints the frozen script hash, the stub, the sudoers drop-in and the
undo line. It refuses to run if a target directory is writable by others, copies the script once into a root-owned
temp dir, syntax-checks it, validates the sudoers file with `visudo -cf`, and writes the sudoers file last.
Re-running it with changed source **is the update path** (password required, new hash printed).

## Use

```bash
sudo -n /usr/local/sbin/roxira-root phone-keys-sync   # prints names and HTTP codes only
sudo -n /usr/local/sbin/roxira-root phone-status
sudo -n /usr/local/sbin/roxira-root jit-restart
sudo -n /usr/local/sbin/roxira-root box-status
```

## Undo

```bash
sudo bash scripts/ops/ci_box/root_runner/install_root.sh --undo --apply
# or by hand:  sudo rm /etc/sudoers.d/roxira-root /usr/local/sbin/roxira-root && sudo rm -r /usr/local/lib/roxira-root
```

Remove the sudoers file first: that closes the passwordless path at once.
