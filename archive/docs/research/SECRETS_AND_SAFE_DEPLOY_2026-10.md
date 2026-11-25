# Secrets handling and safe deploy for a solo operator - 2026-10-04

Scope: read-only research, nothing changed except this file. Evidence tags:
**FETCHED** = I opened the page this session and the claim matches; **MEMORY** =
from my own knowledge, not re-checked this session (treat as UNVERIFIED);
**REPO** = read from this repo. Prices and limits change; re-check before paying.

## 0. Bottom line

1. The root cause of every incident is the same: a secret VALUE existed in a place
   that gets copied (terminal output, chat, public git). The fix is layered:
   (a) values live only in encrypted files and are injected into a process, never
   echoed; (b) everything pasted to an AI goes through a `redact` filter; (c) every
   key has a spend cap and is rotatable in minutes, so a leak costs little.
2. Best fit for zero budget and Iran-based owner: **sops + age** (both free,
   offline, no SaaS account, no sanctions/geoblock exposure) for storage and
   injection, plus a small home-made `redact` filter, plus gitleaks (or its
   successor) as pre-commit. Hosted managers (1Password, Doppler, Infisical Cloud)
   add cost, a login dependency and possible regional blocks (UNVERIFIED, not
   tested from Iran).
3. Do not adopt Kamal/Coolify/dokku/CapRover/Atlas now. Our script already has the
   core pieces (freeze, backup, one-off migration container, applied-table check,
   smoke, auto-rollback). Fix four concrete gaps (section 4) instead.
4. Rotate every key that ever appeared in the public repo or a chat. Revoke first,
   clean history second (history rewriting does not un-leak a public key).

## 1. Secret storage and injection without printing

| Option | Licence / cost | Maintenance | Effort | Fit for us |
| --- | --- | --- | --- | --- |
| **sops + age**, encrypted file committed or kept locally | sops MPL-2.0, age BSD-3-Clause (both FETCHED); free | Both active; age 23.8k stars (FETCHED); sops supports age, KMS, PGP (FETCHED) | Low: one key file, one `.sops.yaml` | Best. `sops exec-env file cmd` runs a command with decrypted vars only in that process env; `sops exec-file` gives a temp file (MEMORY for exact semantics, the docs pages I fetched did not include them; verify with `sops exec-env --help`) |
| age alone (`age -r ... roxira.env`) | BSD-3 | Very stable | Lowest | Good fallback: `age -d -i key file \| (set -a; . /dev/stdin; set +a; cmd)` is awkward; sops is nicer |
| direnv | MIT (MEMORY) | Active | Low | Convenience only; it loads env into your interactive shell, which makes `env` dumps leak again. Avoid for secrets |
| docker/compose file-based secrets | built in, free | Docs recommend files over env vars because env is visible to all processes and can be printed in logs (FETCHED) | Medium: app must read `/run/secrets/X` or a `*_FILE` var | Good for the server later; today the NestJS and Python apps read env, so needs code per app. Also `docker inspect` shows env values, our migrate step already reads them that way (REPO) |
| systemd credentials | part of systemd | Stable | Medium | `LoadCredentialEncrypted=`, `systemd-creds encrypt`, read via `$CREDENTIALS_DIRECTORY`, bound to host key/TPM (FETCHED). Only fits services run by systemd, not docker compose. Skip |
| 1Password CLI (`op run`) | Paid; I did not confirm a free tier | Active | Low | `op run` injects op:// references, masks resolved secrets in stdout by default, `--no-masking` disables it (FETCHED). The masking is the one feature we want; cost and Iran access are the problem |
| Bitwarden Secrets Manager | Free plan: unlimited secrets, 2 users, 3 machine accounts, 3 projects; Teams $6/user/month (FETCHED) | Active | Low-medium (`bws` CLI) | Viable free hosted alternative. Kamal has an adapter for it (FETCHED). SaaS dependency, Iran reachability UNVERIFIED |
| Doppler | Developer plan free for 3 users, 10 projects, 3-day activity log, no secret rotation (FETCHED) | Active | Low | Works, but hosted and closed; same Iran caveat |
| Infisical self-host | Core MIT, free self-host; cloud free tier 5 identities (FETCHED) | Active | High: extra Postgres/Redis stack to run and secure | Overkill for one person; extra attack surface on a 16GB Mac or the prod box |
| HashiCorp Vault | Source-available licence since 2023 (MEMORY) | Active | High | Overkill. Skip |

### Recommended design (sops + age)

- Mac: `~/Secrets/roxira/roxira.env` stays the single source, but is stored as
  `roxira.env.sops` (encrypted, safe to back up or even commit privately); the
  age private key lives in `~/.config/sops/age/keys.txt` (chmod 600) plus ONE
  offline copy (USB or paper). Losing the age key means losing the secrets.
- Run anything that needs secrets as `sops exec-env ~/Secrets/roxira/roxira.env.sops 'scripts/ops/...'`.
  The decrypted values are in that child's environment only; nothing prints.
- `set_server_env.sh --from-local` keeps working if it reads from the decrypted
  stream instead of a plaintext file (small change).
- Server: keep `.env` mode 600 owned by root, written only by `set_server_env.sh`.
  Later, per service, migrate high-value keys to compose file secrets.
- Never use: `env`, `printenv`, `set`, `export -p`, `cat .env`, `docker inspect`
  (without a name filter), `docker compose config` (it resolves and prints env
  values; MEMORY), `docker exec ... env`. The repo script already filters
  `docker inspect` by variable NAME (REPO).

## 2. Output redaction before pasting to AI

Key fact: scanners (gitleaks, trufflehog) find secrets in files and history; they
are not a terminal filter. Pasting needs a separate, dumb, fail-closed filter.

| Tool | Licence | Notes |
| --- | --- | --- |
| gitleaks | MIT; git history, directories and stdin scans; `--redact` masks the value in its own output; pre-commit supported (all FETCHED). Maintainers say it is "feature complete" with only security patches, focus moved to Betterleaks (FETCHED) | Keep for pre-commit now |
| Betterleaks | MIT, from the gitleaks authors; stdin scan, validates whether a credential is live, filters false positives (FETCHED) | Evaluate as drop-in successor; I did not verify CLI flag compatibility or pre-commit hook availability |
| trufflehog | AGPL-3.0; 800+ detectors; verifies whether a secret is live (FETCHED) | Best for "which of the leaked keys are still valid". Its default output may print the raw secret (MEMORY): ALWAYS pipe through `redact` or do not paste it |
| GitHub push protection | Free and on by default for public repos, blocks secrets in pushes, UI commits, API (FETCHED) | Already your last line of defence; the incident shows it does not know every provider key format (REPO memory note: gitleaks missed 8 keys) |

### The `redact` filter (design; owner-reviewed, L4 path `scripts/dev/`)

A ~40-line stdin-to-stdout filter (awk/perl/python, no network):
1. Replace the value in any `NAME=value` or `"name": "value"` line where NAME
   matches `(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|DSN|URL.*@)`
   case-insensitive, with `NAME=[REDACTED len=N]`.
2. Replace known key shapes anywhere: `sk-or-v1-[A-Za-z0-9]{20,}`,
   `sk-[A-Za-z0-9_-]{20,}`, `ghp_|gho_|ghs_|github_pat_[A-Za-z0-9_]{20,}`,
   `AKIA[0-9A-Z]{16}`, `xox[abprs]-`, JWT `eyJ[\w-]+\.[\w-]+\.[\w-]+`,
   `postgres(ql)?://user:pass@` (mask the password), PEM blocks, and any
   hex/base64 token of 32+ chars next to a secret-like word.
3. Second pass: load the exact secret values from the encrypted store
   (via `sops exec-env`) and mask any literal occurrence, this catches provider
   formats the regexes miss. Build the list inside the process, never print it.
4. Fail closed: exit non-zero and print nothing if the pass-2 list cannot load.
- Use: `cmd 2>&1 | redact` and `pbpaste | redact | pbcopy` before pasting.
  Provide a shell function `safe() { "$@" 2>&1 | redact; }` and a zsh alias
  that makes `env`, `printenv`, `set` refuse and point to `safe env-names`.
- Shell history: `HISTCONTROL=ignorespace`/zsh `setopt HIST_IGNORE_SPACE`; never
  type a secret on a command line (it lands in history and `ps`); read secrets
  from stdin or files. `HISTFILE` is local only; do not paste history.
- Terminal Run buttons replay old blocks: keep blocks idempotent, dry-run by
  default (the script already is), and put destructive steps behind the
  typed-SHA confirmation, which a replay cannot satisfy (REPO).
- Canary: a fake `sk-canary-...` value in a decoy env var; if gitleaks or redact
  ever sees it in an outgoing paste, you know the filter was bypassed.

## 3. Rotation and scoped, capped keys

- Principle: assume every key leaks eventually; make the blast radius a few
  dollars and the replacement a 2-minute job. One key per service and per
  environment (prod vs dev vs agents); never share the prod key with agent
  runners (REPO AUTONOMY doc already requires this).
- OpenRouter: keys can be created through the API with a management key, with
  `limit` (USD), `limit_reset` (daily/weekly/monthly) and `expires_at`
  (FETCHED). So per-purpose keys with a daily cap and a 30-90 day expiry are
  possible without paying anything. Keep the management key off the day-to-day
  env; it can mint keys.
- Mistral and other providers: I could not confirm per-key scopes, spend caps or
  expiry (docs URL returned 404). UNVERIFIED. Mitigate with account-level
  billing limits and a separate workspace/key per use; check the console
  yourself.
- Google OAuth client secret, JWT_SECRET, ADMIN_HEALTH_KEY, KAVENEGAR_API_KEY,
  DB password: rotate on a calendar (90 days) or on any suspected exposure.
  JWT_SECRET rotation logs everyone out; support two valid secrets during a
  window if you can. `set_server_env.sh --generate --replace` already does
  atomic rotate for generated values (REPO).
- Keep a rotation register (name, provider, created, expiry, cap) in a private
  file with no values. Reminder via your existing scheduler.

## 4. Safe migration and deploy patterns

### What mature tools do (and what we can copy)

| Tool | How it handles it | Adopt? |
| --- | --- | --- |
| Atlas | `atlas_schema_revisions` table records applied files; linear history, fails on out-of-order files, modes linear / linear-skip / non-linear; `migrate lint` checks before merge; pre-checks can cap files per run; transaction per file, resumes after a failed statement in no-tx mode (FETCHED). Licence not confirmed | No. Copy the ideas: lint and linear check |
| TypeORM (what we use) | `migration:run` executes only pending migrations, ordered by timestamp (FETCHED); applied names are in the `migrations` table (REPO script relies on this) | Already in use |
| Flyway / Liquibase | Table of applied checksums, fail on checksum drift (MEMORY, not fetched) | No, Java stack, no gain over TypeORM |
| Kamal | Imperative zero-downtime deploys, rolling restarts, remote builds; secrets via `.kamal/secrets` with password-manager adapters; `kamal secrets print` exists and prints values, so avoid it (FETCHED). Needs SSH + registry + kamal-proxy; rollback-by-version is a core command (MEMORY) | No: would replace nginx/compose layout; learning cost; our compose is already fine |
| dokku | Healthchecks run on new containers before traffic switches, old containers kept and retired after `wait-to-retire` (FETCHED) | No: PaaS model replaces our compose setup. Copy the idea: start new, check, then switch |
| Coolify | Self-hosted PaaS with a UI, databases, templates (FETCHED); rollback and RAM needs not confirmed | No: another always-on control plane holding all your secrets |
| CapRover | Not researched. UNVERIFIED | No |

Verdict: adopting a platform trades a ~450-line script you understand for a control
plane that holds prod credentials. Not worth it for one server. Harden the script.

### Four concrete gaps in `scripts/ops/deploy_local.sh` (REPO)

1. **The incident: deploy refuses on file presence.** `cmd_deploy` calls
   `migration_files` (any path matching `migrations?/` or `.sql` in the diff) and
   dies even when that migration is already applied. `cmd_migrate` already computes
   truth from the production `migrations` table (`pending_migrations`). Fix:
   in `deploy`, call `pending_migrations`; if `APPLIED_OK=0` refuse (cannot
   verify); if `PENDING` is non-empty refuse and point to `migrate`; otherwise
   proceed and print "N migration files in diff, all already applied". Same
   change in `check` and `plan` (they only warn today). Also restrict the match to
   `$MIG_DIR` so a stray `.sql` doc does not block.
2. **No expand/contract discipline, so rollback can break.** `rollback` restores
   old code and images but never the DB (documented). A migration that adds a
   `NOT NULL` column (the pending `AddCrmTenantIsolation` is verified NOT NULL by
   the script) makes the previous app version fail inserts, so an auto-rollback
   after smoke failure lands on a broken old version. Rule: migration N must
   work with app N-1. Steps: (a) add nullable column or one with a DB default,
   (b) deploy app that writes it, (c) backfill, (d) next release adds `NOT NULL`
   (contract). Pattern is the standard expand-contract sequence (FETCHED, Prisma
   data guide). Tenant-isolation checks should live in the repository layer
   (AGENTS.md) so the nullable window is not a leak: backfill before enabling reads.
3. **Backup only inside `migrate`.** Good: `pg_dump -Fc`, non-empty check,
   `pg_restore --list` verification; pg_dump gives a consistent snapshot on a live
   DB without blocking readers or writers (FETCHED). Add: keep last N dumps
   (rotate), copy one dump off the box (Mac via `scp`, encrypted with age) so a
   dead server is not a dead business, and run a monthly restore test into a
   scratch container.
4. **Rollout is stop-then-start with a fixed `sleep 20`.** `up -d --no-deps`
   recreates the container, so there is a gap; the smoke test then checks public
   URLs. Improvements, cheapest first: add `healthcheck:` to each service and
   replace `sleep 20` with a poll loop (up to 90 s) on `docker inspect` health
   status; `docker compose up -d --wait` waits for healthy (MEMORY, verify on
   your compose version); smoke should fail the deploy if the SHA exposed by
   `/health` is not the target. True blue/green (two backends behind nginx
   upstream, switch after check) is possible but only worth it once downtime
   matters; owner decision. Also: `git reset --hard` in `do_rollback_remote` is fine
   given the clean-tree check, but record the pre-migrate dump path in
   `$STATE_DIR` so `rollback` can print the matching restore command.

Smaller: make `migrate` print "N already applied, M pending" even in dry-run
(it does list pending); add `migrate --status` that reads only the table; add a
lint step that fails a PR whose migration file has a `NOT NULL` without default on
an existing table (Atlas-style lint, 20 lines of grep); ensure the checks printing
env names never print values (already true, REPO).

## 5. Already-exposed keys: what to do now

Order matters; speed beats tidiness.
1. **Revoke and re-issue** every key that was in the public repo, terminal output
   pasted to chat, or any AI transcript: OpenRouter, Mistral, Google OAuth client
   secret, KAVENEGAR, any GitHub token, JWT_SECRET, ADMIN_HEALTH_KEY, DB password
   if it ever appeared. Revoke at the provider first; then create the new key with a
   spend cap and expiry. Do not wait for history cleanup.
2. **Check usage logs** at each provider for the exposure window (unknown calls,
   unknown IPs, spend spikes). Providers' own dashboards; I did not verify each
   one's log features.
3. **Find the full list** with a scanner that does not print values:
   `gitleaks` over full history with `--redact` (flag FETCHED), and
   `trufflehog` for "is it still live" with its output piped through `redact`
   (raw-secret printing is MEMORY). Scan the working tree, `git log -p`, old
   branches, forks, PR descriptions, issues, Actions logs, and `docs/`.
4. **History rewrite is optional hygiene, not remediation.** A public repo
   was already scraped by bots (MEMORY). If you do rewrite (`git filter-repo`),
   it needs a force push and invalidates clones: owner approval, after step 1.
   Ask GitHub support to purge cached views and dangling commits only if keys
   were not revoked (they will be, so low value).
5. Treat chat transcripts that contained keys as leaked to that vendor; the keys
   are rotated, so the residual risk is small. Delete the conversations if you can.
6. Enable GitHub push protection and secret scanning alerts for the repo (free for
   public repos, FETCHED) and the gitleaks pre-commit hook locally.

## 6. Recommended plan (6 steps, ordered by risk reduction per effort)

All commands below print names, counts or paths, never values. Replace `<...>`.

**Step 1 - Rotate exposed keys and set caps (owner approval, owner does the
clicks at providers; about 1 hour).** For each provider: revoke old, create new with
daily cap and expiry. Then store without echo:
`scripts/ops/set_server_env.sh <NAME> --generate --replace` for generated values
(prints name and length only, REPO). For provider keys, enter the value by
editing the file in an editor, not on a command line:
`${EDITOR:-nano} ~/Secrets/roxira/roxira.env` then
`scripts/ops/set_server_env.sh <NAME> --from-local --replace`. Verify names only:
`grep -oE '^[A-Z][A-Z0-9_]*' ~/Secrets/roxira/roxira.env | sort`.
Needs approval: yes (revocation is irreversible, production keys change; restart
of containers needed for the server to read new `.env`, per the ops docs).

**Step 2 - Add the `redact` filter and shell guards (one agent PR, L4 path,
owner reviews; about 2 hours).** First commands (read-only):
`command -v gitleaks sops age` and `ls scripts/dev/`. The agent writes
`scripts/dev/redact` plus a test file with fake keys (obvious `sk-FAKE...`
strings), then you add to `~/.zshrc`:
`setopt HIST_IGNORE_SPACE` and `alias env='echo "use: safe env-names"'` (owner
edits own dotfile; agents must not).
Approval: yes (L4 path, dotfile edit by owner).

**Step 3 - Fix the deploy guard (agent PR, L4, owner reviews; about 1 hour).**
Implement the `pending_migrations`-based check in `cmd_deploy`, `cmd_check`,
`cmd_plan`, restrict to `$MIG_DIR`. Verify with dry-runs only:
`scripts/ops/deploy_local.sh check` then `scripts/ops/deploy_local.sh plan`
(both read-only per the doc). Approval: merge by owner; `--yes` runs stay
owner-typed.

**Step 4 - gitleaks pre-commit plus GitHub push protection (about 30 min).**
`brew install gitleaks pre-commit` (download of tools: owner approval), add the
gitleaks hook to `.pre-commit-config.yaml`, `pre-commit install`. Full-history scan
without printing values: `gitleaks git --redact --no-banner -v` (subcommand
name is MEMORY; older versions use `gitleaks detect`). In GitHub repo settings
enable secret scanning and push protection (owner click or `gh api` with owner
approval).

**Step 5 - sops + age for the local secrets file (about 1 hour).**
`brew install sops age` (approval), `mkdir -p ~/.config/sops/age`,
`age-keygen -o ~/.config/sops/age/keys.txt` (this prints only the PUBLIC key; do
not `cat` the file), `chmod 600 ~/.config/sops/age/keys.txt`, make a backup copy
to offline media. Write `.sops.yaml` with the public recipient, then
`sops --encrypt --input-type dotenv --output-type dotenv ~/Secrets/roxira/roxira.env > ~/Secrets/roxira/roxira.env.sops`
and check it with `grep -c ENC\[ ~/Secrets/roxira/roxira.env.sops` (count only).
Only after a successful `sops exec-env ~/Secrets/roxira/roxira.env.sops 'printenv NAME | wc -c'`
(prints a length) delete the plaintext with owner approval. Then run deploy scripts
under `sops exec-env`. Approval: yes (deleting the plaintext, key backup).

**Step 6 - Rollout safety and off-box backup (agent PRs, L4, owner decides;
a few hours total).** Add compose `healthcheck:` entries and a health poll in place
of `sleep 20`; backup rotation and an encrypted copy to the Mac
(`scripts/ops/deploy_local.sh migrate` dry-run lists current state); adopt the
expand/contract rule in `docs/ops/DEPLOY_LOCAL.md`, starting with turning
`AddCrmTenantIsolation` into a nullable add plus later NOT NULL. First read-only
command: `scripts/ops/deploy_local.sh migrate` (dry-run). Approval: yes for any
server change, container restart, or migration on production.

## Caveats

- Not tested from Iran: reachability of 1Password, Doppler, Bitwarden, Infisical
  Cloud, package mirrors is UNVERIFIED; sops/age/gitleaks work offline after
  install.
- sops `exec-env`/`exec-file` semantics, `docker compose up --wait`,
  `docker compose config` printing values, trufflehog raw output, Vault licence,
  Flyway/Liquibase behaviour and Kamal rollback are MEMORY items; the pages I
  fetched did not cover them.
- Mistral key scoping/caps, CapRover, Coolify rollback and Atlas licence were not
  confirmed.
- Pricing figures (Bitwarden, Doppler, Infisical) are from vendor pages fetched
  today and may change.
