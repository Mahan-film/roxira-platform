---
name: project-key-leak-audit-2026-11-03
description: Which live keys are in roxira-platform git history (blocks going public) vs clean AI key pool
metadata:
  node_type: memory
  type: project
  originSessionId: 57956b53-2027-4640-9c32-5946ce2ceda4
  modified: 2026-11-03T09:46:58.253Z
---

Audit 2026-11-03 (hash compare, no values printed). Real repo = private Mahan-film/roxira-platform (server deploys it); Mahan-film/roxira is a one-commit public export from 2026-10-04. Owner wants roxira-platform public (to add mahansudo free; Team org has 1 seat).

Clean (not in history): Mistral, Groq, Zilliz, Daytona, Gemini, OpenRouter, SambaNova, Qdrant, TinyFish, Modal, CF, R2, Telegram — the AI key pool.
Still live AND in history: Tavily x4, Brave, Exa, Firecrawl, Jina (probe_search_keys.py), Kavenegar (OTP SMS), SMS.ir, Kira; AssemblyAI only on Mac. Must be replaced at the providers before going public. Hardcoded Kavenegar in main removed by PR #975.

Key stores: Mac ~/Secrets/roxira/roxira.env, ~/.config/litellm/keys.env (Groq/Mistral/OpenRouter), OmniRoute docker 127.0.0.1:20128; server /opt/roxira_platform/.env, key_pool/generated/keypool.env, /etc/roxira/*.env. See [[project-two-github-accounts]].
