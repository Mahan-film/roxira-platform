---
name: project-state-2026-10-12
description: "State after the 2026-10-12 night session — merged PRs 556-567, pending owner server steps, routing facts"
metadata:
  node_type: memory
  type: project
  originSessionId: 0fd9cb50-0fa4-4312-aca1-111eeb5c9f87
  modified: 2026-10-12T13:48:25.169Z
---

Merged 2026-10-12: #556 UX P0, #557 conversational drafting (/draft-assist), #558 ruling/indictment no longer need LLM_ROUTER_ENABLED, #559 vision OCR reasoning fix (Gemini 3.x Flash rejects reasoning.enabled=false → effort minimal), #560 async case-file upload (202 + status polling, 25 MB/100 pages), #561/#563 factory audit + dispatch_opencode.sh/llm_spend.sh/model_for.py, #562 UX P1 lazy modals, #564 492 articles from ekhtebar (staged), #565 backup email .md/.json + age offsite parts, #566 build_v3_on_server.sh, #567 law_watch.py (Mac launchd, worktree ~/Developer/roxira-lawwatch).

Deployed to prod: 5a089ace (all of the above). Law watch launchd loaded on Mac. iran_laws_v3 built (5822 pts, retrieval 10/10, 11/11, 8/8 vs v2 10/10, 2/11, 0/8) and SERVING since 2026-10-12 ~07:54 UTC (.env backup /root/env-backups/.env.before-v3; v2 untouched). Later 2026-10-12: deployed 58233c61 (#569-#578: lean backup retention + legacy cron retired + 11.6 GB pruned, disk 36%; security stubs/OAuth/cookie; /plans; chat history; eval gate baseline retrieval@5 85.7% (#579); radar timers installed on server). #576 merged: NEW_SERVER_PLAN (owner buying Hetzner CX33 x86 4/8/80, ~3.3M Toman/mo, Nuremberg), scripts/infra/bootstrap_new_server.sh, fixed restore.sh (Twenty from docker-compose.modern-stack.yml). Next: owner sends new server IP → migration per scripts/infra/migrate_checklist.md. Evening 2026-10-12 merged (not yet deployed): #580 case-file page citations + escalation (off), #581 court suggestion from jurisdiction_rules.yaml, #582 reranker (off), #583 lawyer sheet 10 items (63/70 auto-verified), #584 owner playbooks docs/owner/TRACK_C..G_FA.md, #585 honest lawyer pilot sign-up, #586 unity rulings 612 + admin board 1119 from ekhtebar (iran_rulings_v1, flag off; build via scripts/legal/build_rulings_collection_on_server.sh). Owner does tracks C–G; hub does A and B. Lesson: always `up -d --no-deps` for single-service recreate (forgot once; deps restarted, data fine).

**Why:** next session must not redo these. **How to apply:** pending owner steps: deploy; BACKUP_EMAIL_OFFSITE=daily + forced test; run build_v3_on_server.sh (--dry-run then real) then decide switch; install law watch launchd; OpenRouter balance ~$6 (owner defers top-up). OpenRouter blocks Iranian IPs when owner VPN is off → relay reviews via server stdin (key never stored). OmniRoute password lost; recommend skipping it. Prod runs single process. See [[feedback-ekhtebar-sole-legal-source]].
