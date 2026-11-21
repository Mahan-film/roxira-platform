# Read-Only Deploy Key & Signed-Tag Guard (R20-4 / #1020)

> **Owner approval required before touching production.** Do not apply these steps on the production server until the owner explicitly approves.

## 1. Read-Only Deploy Key Setup (Production)

1. Generate a dedicated ed25519 key on the production host (no passphrase, read-only):
   ```bash
   sudo -u deploy ssh-keygen -t ed25519 -N "" -C "roxira-prod-ro-deploy" -f /etc/roxira/deploy_ro_ed25519
   sudo chmod 600 /etc/roxira/deploy_ro_ed25519
   ```
2. Add `/etc/roxira/deploy_ro_ed25519.pub` in GitHub under **Settings -> Deploy keys** with **Allow write access** unchecked (read-only).
3. Configure `PULL_DEPLOY_SSH_KEY=/etc/roxira/deploy_ro_ed25519` in the pull-deploy systemd unit environment.

## 2. SSH-Signed `deploy/*` Tag Guard

When `PULL_DEPLOY_SIGNED_TAG_GUARD=1` is set on `scripts/ops/pull-deploy.sh`:
- If `HEAD..origin/main` touches migrations (`output_apps/enterprise_hub/migrations/`), compose files (`docker-compose*.yml`), `scripts/ops/`, or `.github/workflows/` (or if `PULL_DEPLOY_REQUIRE_SIGNED_TAG=1`), `pull-deploy.sh` invokes `scripts/ops/signed_tag_guard.sh`.
- `signed_tag_guard.sh` iterates `deploy/*` tags newest-first (`--sort=-creatordate`) and selects the **newest tag that passes SSH signature verification** against `ALLOWED_SIGNERS_FILE` (default `/etc/roxira/allowed_signers`).
- Unsigned or untrusted newer tags are logged and skipped so an unverified tag cannot DoS deployments.
- Fails closed (exit 1) if `ALLOWED_SIGNERS_FILE` is missing/empty or no valid signed `deploy/*` tag exists.

### Owner Signing Workflow
```bash
# One-time setup on owner workstation
git config user.signingkey ~/.ssh/id_ed25519.pub
git config gpg.format ssh

# Add owner's public key to /etc/roxira/allowed_signers on prod:
# owner@roxira namespaces="git" ssh-ed25519 AAAA...

# Cut a signed deploy tag
git tag -s deploy/2026-11-21-01 -m "prod deploy 2026-11-21-01"
git push origin deploy/2026-11-21-01
```
