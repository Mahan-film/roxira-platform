# Secrets with SOPS + age

Roxira stores encrypted configuration with [SOPS](https://github.com/getsops/sops)
and [age](https://github.com/FiloSottile/age). SOPS encrypts values inside YAML,
JSON, or dotenv files; age supplies the key pair. There is no always-on secrets
service. This layout follows `docs/research/nextgen/C_execution_delivery_substrate.md`
section 5: separate dev/preview/production recipients, and only the deploy job
may decrypt production secrets.

Never commit a private key, a decrypted value, or a real recipient that is not
meant to be public.

## Layout

```
.sops.yaml                 # creation rules (copy from .sops.yaml.example)
secrets/
  dev/app.enc.yaml
  preview/app.enc.yaml
  production/app.enc.yaml
```

Only `*.enc.*` files are committed. They are ciphertext plus SOPS metadata; the
tracked-secret checker (`scripts/ci/check_secret_hygiene.py`) fails a PR when an
`*.enc.*` file has no `sops:` marker.

## Generate an age key on the Mac

```bash
brew install age sops
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
```

`age-keygen` prints a public key (`age1...`) and writes the private key to
`~/.config/sops/age/keys.txt`. Treat that file as a production secret: keep it
out of the repository, prefer an encrypted backup, and set restrictive
permissions (`chmod 600`). SOPS finds it through `SOPS_AGE_KEY_FILE` or the
default `~/.config/sops/age/keys.txt`.

## Encrypt and decrypt

Encrypt (SOPS rewrites the file in place and the committed result is ciphertext):

```bash
sops secrets/dev/app.enc.yaml
```

Decrypt for a local session only — never paste the output into a ticket, PR, or
chat:

```bash
sops --decrypt secrets/dev/app.enc.yaml
```

For a process that needs the values, keep them in the environment of the child
and never print them:

```bash
sops exec-env secrets/dev/app.enc.yaml 'your-command'
```

`docs/ops/` and every workflow must avoid `sops --decrypt`, `cat`, or `echo` on
a decrypted document. CI uses `sops exec-env` (or `sops exec-file`) so values
stay inside the command's environment. GitHub Actions should still call
`::add-mask::` on any derived value before it could reach a log.

## Who may decrypt what

| Path | May decrypt | Purpose |
| --- | --- | --- |
| `secrets/dev/` | Developers with the dev key | Local development and manual testing |
| `secrets/preview/` | Preview/ephemeral CI jobs | Previews; no production data |
| `secrets/production/` | The deploy job key only | Production deploys and restores |

Production secrets are never mounted into previews, agent sandboxes, or
developer machines. The production age key lives only where the deploy job can
reach it (host secret store or an Actions secret bound to the deploy
environment), and each use is logged.

## Rotation

1. Generate a new age key pair for the affected environment and store the
   private key in the secret store.
2. Update the matching `path_regex` recipient in `.sops.yaml`.
3. Re-wrap the existing files without changing plaintext:
   `sops updatekeys secrets/<env>/*.enc.*`.
4. Rotate the underlying credential at the provider (database password, API
   token, …) if it may have been exposed.
5. Revoke the old provider credential, delete the old private key from every
   host, and remove the old Actions secret.
6. Run `python3 scripts/ci/check_secret_hygiene.py` and open a reviewed PR.
   Never rotate production secrets directly on the production database.

## Checker

```bash
python3 scripts/ci/check_secret_hygiene.py            # exit 1 on offenders
python3 scripts/ci/check_secret_hygiene.py --report-only
```

It reads `git ls-files`, flags tracked `.env`, `.env.*` (except `.env.example`),
`*.pem`, `*.key`, `id_rsa*`, `*.p12`, and `*.enc.*` files missing a `sops:`
marker, and prints offending paths only — never content.
