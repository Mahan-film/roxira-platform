# Read-Only Deploy Key & Signed-Tag Guard (R20-4 / #1020)

> **Owner approval required before touching production.** Do not apply these steps on the production server until the owner explicitly approves (Hub Review / B7 policy).

This runbook documents the R20-4 hardening for automated deployments:
1. Production repository authentication via a read-only GitHub deploy key (instead of credentials with write access).
2. SSH-signed `deploy/*` tag enforcement: deployments modifying migrations (`output_apps/enterprise_hub/migrations/`), compose stacks (`docker-compose*.yml`), operational scripts (`scripts/ops/`), or CI workflows (`.github/workflows/`) require a verified SSH signature from an authorized key in `/etc/roxira/allowed_signers`.
3. Support across both the timer-driven `roxira-autodeploy` (`scripts/ops/autodeploy/autodeploy.sh`) and the pull runner (`scripts/ops/pull-deploy.sh`).

---

## 1. Prerequisites: SSH Remote URL

The local git repository on the production host (`/opt/roxira_platform`) must have its `origin` remote configured for SSH:

```bash
git -C /opt/roxira_platform remote set-url origin git@github.com:Mahan-film/roxira-platform.git
git -C /opt/roxira_platform remote -v
```

---

## 2. Read-Only Deploy Key Setup (Production Host)

1. Generate a dedicated ed25519 deploy key pair (no passphrase):
   - **For root service (`roxira-autodeploy.service`):**
     ```bash
     sudo mkdir -p /etc/roxira
     sudo ssh-keygen -t ed25519 -N "" -C "roxira-prod-ro-deploy" -f /etc/roxira/deploy_ro_ed25519
     sudo chown root:root /etc/roxira/deploy_ro_ed25519*
     sudo chmod 600 /etc/roxira/deploy_ro_ed25519
     sudo chmod 644 /etc/roxira/deploy_ro_ed25519.pub
     ```
   - **For dedicated `deploy` user service:**
     ```bash
     sudo -u deploy ssh-keygen -t ed25519 -N "" -C "roxira-prod-ro-deploy" -f /etc/roxira/deploy_ro_ed25519
     sudo chown deploy:deploy /etc/roxira/deploy_ro_ed25519*
     sudo chmod 600 /etc/roxira/deploy_ro_ed25519
     sudo chmod 644 /etc/roxira/deploy_ro_ed25519.pub
     ```

2. Add the public key to GitHub:
   - Copy `/etc/roxira/deploy_ro_ed25519.pub`.
   - In GitHub repository settings -> **Deploy keys** -> **Add deploy key**.
   - Title: `roxira-prod-ro-deploy (read-only)`.
   - **CRITICAL:** Ensure **"Allow write access"** remains **UNCHECKED**.

3. Wire environment variable into deploy services:
   - For `autodeploy.sh`: set `AUTODEPLOY_SSH_KEY=/etc/roxira/deploy_ro_ed25519` (or `PULL_DEPLOY_SSH_KEY`).
   - For `pull-deploy.sh`: set `PULL_DEPLOY_SSH_KEY=/etc/roxira/deploy_ro_ed25519`.

---

## 3. SSH Allowed Signers Setup

Create the authorized signers file on the production host:

```bash
sudo mkdir -p /etc/roxira
# Append owner and authorized co-founder public signing keys:
echo 'owner@roxira namespaces="git" ssh-ed25519 <OWNER_SSH_PUBLIC_KEY>' | sudo tee -a /etc/roxira/allowed_signers
sudo chmod 644 /etc/roxira/allowed_signers
```

---

## 4. SSH-Signed `deploy/*` Tag Guard Behavior

When `AUTODEPLOY_SIGNED_TAG_GUARD=1` or `PULL_DEPLOY_SIGNED_TAG_GUARD=1`:
1. The script fetches tags with `--force` (`git fetch -q --tags --force origin main`) so force-moved tags never crash deployment loops.
2. If the diff between current HEAD and target touches migrations, compose files, or infra scripts (or if `REQUIRE_SIGNED_TAG=1`), `scripts/ops/signed_tag_guard.sh` is invoked.
3. `signed_tag_guard.sh`:
   - Iterates `deploy/*` tags newest-first (`--sort=-creatordate`).
   - Verifies SSH signature against `/etc/roxira/allowed_signers` (`git tag -v`).
   - Verifies that the tag's commit is an ancestor of `origin/main` (`git merge-base --is-ancestor`) to prevent rollbacks or malicious branches from deploying.
   - Skips unsigned/untrusted tags and selects the newest verified tag.
   - Fails closed (exit 1) if `/etc/roxira/allowed_signers` is missing or no valid signed tag exists.

### Owner Signing Workflow
```bash
# On owner workstation (one-time config)
git config user.signingkey ~/.ssh/id_ed25519.pub
git config gpg.format ssh

# Tag and push a release
git tag -s deploy/2026-11-21-01 -m "prod deploy 2026-11-21-01"
git push origin deploy/2026-11-21-01
```

---

## 5. Instant Rollback Procedure

If deploy key authentication fails or signed tags block an emergency hotfix:

1. **Disable Signed-Tag Guard:**
   Set in systemd service or drop-in:
   ```bash
   AUTODEPLOY_SIGNED_TAG_GUARD=0
   PULL_DEPLOY_SIGNED_TAG_GUARD=0
   ```
2. **Revert Deploy Key Authentication (if needed):**
   Unset or comment out `AUTODEPLOY_SSH_KEY` / `PULL_DEPLOY_SSH_KEY`. Git immediately reverts to the default host SSH or token credentials.
3. **Restart Timer/Service:**
   ```bash
   sudo systemctl restart roxira-autodeploy.timer
   ```
