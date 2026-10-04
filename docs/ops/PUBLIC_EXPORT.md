# Public export (sanitized, repeatable)

`scripts/ops/export_public.py` builds a public copy of the repo from git-tracked files only,
using the rules in `config/public_export.json` (both L4, owner-only). It never pushes.

## One-time setup

Create `~/.config/roxira/public_export_redactions.txt` (chmod 600, never committed): one regex
per line (server IP, personal emails/phones). `#` starts a comment. The script prints only the
replacement count. Install `gitleaks` (otherwise that gate is SKIPPED).

## Run

```
python3 scripts/ops/export_public.py --out ~/roxira-public-export
```

`--out` must be an empty directory outside the repo. Output lists file names and counts only.
The secret gate checks provider-key patterns, Google OAuth ids, KEY/SECRET/TOKEN/PASSWORD
assignments (20+ char quoted value), private-key blocks, public IPv4 literals, and
`gitleaks detect --no-git`. `PUBLIC_EXPORT_OK` and `PUBLIC_EXPORT_MANIFEST.json` are written
only if every gate passes. Docs/config files containing server IPs or prod hostnames are
dropped from the export and listed as skipped.

## Publish checklist

1. Exit code 0, `PUBLIC_EXPORT_OK` present, gitleaks was not SKIP.
2. Skim the manifest and the tree yourself.
3. Fresh single commit, no history:
   ```
   cd ~/roxira-public-export && git init -b main && git add -A && git commit -m "Initial public release"
   git remote add origin git@github.com:mahan-films/roxira.git
   ```
4. Repo settings: private vulnerability reporting ON.
5. `git push -u origin main`, then make the repo public only after the gate is green.
6. Rotate every key that ever appeared in the private history, regardless.
