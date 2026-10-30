# Master strategy (2026-10-30)

Goal: srv1 serves production and little else. Heavy work moves to free or cheap external capacity, recovery does not
depend on srv1, and the factory ships real projects. Current key and cluster jobs: `docs/infra/KEY_INVENTORY.md`.

## 1. Architecture
| Layer | Runs on | Rule |
| --- | --- | --- |
| Serving | srv1 | nginx, frontend, backend, Python core, Postgres, Redis, Qdrant, key pool |
| Model inference | Key pool over provider keys | Free first, paid on failure |
| Heavy compute | Modal (GPU, batch), Daytona (agent checks) | Nothing that can leave srv1 stays on it |
| Vector failover | Qdrant Cloud, four clusters | Local stays the source of truth |
| Backup | R2, Telegram, e-mail, Neon, Mac pull | No copy on srv1 counts as the only copy |
| Agents | srv1 sandbox now, second server later | Measured by cost per accepted task |
| UI lane | Antigravity, by the owner | Reviewed line by line, never trusted |

## 2. Backup target
| Copy | Frequency | Content | Keep |
| --- | --- | --- | --- |
| srv1 local set | Daily | Full set, Qdrant snapshots included | 2 sets |
| R2, encrypted | Hourly | Postgres and configs | 7 days hourly, 30 days daily |
| Telegram, encrypted | Every 6 hours | Postgres and configs | Channel history |
| E-mail, encrypted | Daily | Postgres and configs, inside `email_caps` | Mailbox |
| Qdrant Cloud | Nightly | Laws collections | Latest |
| Mac pull | When the Mac is on | Latest set | Local |

Target recovery point: 1 hour for Postgres. A backup counts only after a restore test, so a scheduled restore drill is
part of this work. Backups stay encrypted with `age`, and the private key never reaches srv1.

## 3. Automatic cleanup
Every 2 days: build cache older than 48 hours, dangling images, `rxtest-*` images older than 2 days, journals above 200 MB,
finished agent worktrees older than 3 days. Never volumes, `data/`, `~/Backups`, `:prev` images or running containers.

## 4. Server load
1. Remove old Qdrant collections after confirming nothing reads them and a copy exists off the server.
2. Review cron jobs and timers, and stop any with no measured value.
3. Move batch embedding to Modal and agent checks to Daytona.
4. Upgrade the key pool (#889) so every key is used.

## 5. Order
1. Backup and cleanup. 2. Key pool upgrade. 3. Server load. 4. VPN paths. 5. Factory P1. 6. First personal project on a
template, on a second server if the owner approves the cost.

## 6. Do not do
No Coolify, n8n, OpenHands or MetaGPT on srv1. No second production vector database for Iranian legal data. No new
template before a named project needs it.
