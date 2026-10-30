# Key and account inventory (2026-10-30)

Names only, never values. Mac file: `~/Secrets/roxira/roxira.env` (add with `set_secret.sh NAME`). Server file:
`/opt/roxira_platform/.env`. Check every key with one small request and no output of values:

    set -a; source ~/Secrets/roxira/roxira.env; set +a; python3 scripts/dev/check_keys.py

Results are from 2026-10-30, server 32 OK and 0 FAIL. "Mac only" means the server cannot use it yet.

| Service | Keys | Where | Test | Used for now | Next use |
| --- | --- | --- | --- | --- | --- |
| OpenRouter | 2 | both | OK | Product fallback, agents | Paid rung only |
| Gemini | 4 | both | OK | Key pool, TTS, STT | Keep Flash only |
| Mistral | 4 | both | OK | Key pool, STT, embeddings | Second family for reviews |
| Groq | 3 | both | OK on server, 403 on Mac | Server agents, STT | Server only |
| SambaNova | 1 | both | OK | Key pool | Long contract work |
| Kira | 1 | both | Not tested | Key pool | Add a check |
| Cerebras | 0 | none | No key | None | Add a key if the owner has one |
| Tavily | 4 | server, 1 on Mac | OK | Research | Rotation, #855 |
| Brave, Exa, Firecrawl, Jina | 1 each | both | OK | Research, rerank | Rotation, #855 |
| AssemblyAI | 1 | Mac only | OK | Unused | Copy to server for STT fallback |
| TinyFish | 4 | both | Not tested, no endpoint in repo | Unused | Bake-off for browser agents |
| Daytona | 4 | both | OK | Backend built, off | Isolated check runs |
| Modal | 1 pair | both | Not tested | GPU embeddings on demand | Batch re-embedding |
| Qdrant Cloud | 1 (`3b06`) | server | OK | Nightly replica, failover | Slots `_2`..`_4` |
| Qdrant Cloud `f866` (`_2`) | 1 | Mac only | OK | Ping only | Second laws replica |
| Qdrant Cloud `boys` (`_3`) | 1 | Mac only | OK | Ping only | Third replica or personal projects |
| Qdrant Cloud `f6ed` (`_4`) | 1 | Mac, server after copy | OK | Ping | Fourth replica or global product |
| Zilliz | 5 | Mac and server | OK, 0 collections | Ping only | See below |
| Cloudflare AI | 1 | both | OK | Workers AI | Free extra rung |
| R2 | 1 pair | server | Not tested, backups use it | Backups | Keep |
| Neon | 1 | server | Used by nightly job | Offsite backup | Keep |
| Codeberg | 1 | server | OK, repo scope | Mirror | Keep |
| Kavenegar, SMS.ir | 1 each | see test | OK | OTP SMS | Keep both as failover |
| Telegram | 2 bots | server | OK | Alerts, channel | Keep |
| Google OAuth | 1 pair | both | Not tested | Sign-in | Keep |

## Vector clusters

Local Qdrant stays the source of truth. Spare clusters are assigned so each has one job:

| Cluster | Job |
| --- | --- |
| Qdrant `3b06` | Laws replica and failover (live) |
| Qdrant `f866` (`_2`) | Second replica of the laws |
| Qdrant `boys` (`_3`) | Third replica, or personal projects |
| Zilliz 1 | Recall and latency benchmark against Qdrant |
| Zilliz 2 | Personal projects |
| Zilliz 3 | Global product (Malaysian company), non-Iranian data |
| Zilliz 4, 5 | Reserve |

Free tiers suspend after 7 idle days. `scripts/ops/cluster_ping.sh` proves access, and `roxira-cluster-ping.timer` runs it daily
on srv1. Zilliz is still not a second production database for Iranian legal data
(`CLOUD_ACCOUNTS_PLAN.md`).
