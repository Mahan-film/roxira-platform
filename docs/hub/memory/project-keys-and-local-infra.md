---
name: project-keys-and-local-infra
description: "Where API keys live, which providers work, local OmniRoute/LiteLLM, local CI commands, repo state as of 2026-10-04"
metadata:
  node_type: memory
  type: project
  originSessionId: 8397ea00-8e5d-4ca7-bb7e-b2a46f06fd77
  modified: 2026-10-04T01:49:43.379Z
---

As of 2026-10-04: keys live ONLY in `~/Secrets/roxira/roxira.env` (chmod 600, outside the repo). Add/replace one with `bash ~/Secrets/roxira/set_secret.sh NAME` (hidden prompt, prints only length). Load with `set -a; source ~/Secrets/roxira/roxira.env; set +a`. Never ask for or print values; check with lengths or `awk -F= '$2!=""{print $1}'`.

`python3 scripts/dev/check_keys.py` result: OpenRouter, Mistral, SambaNova, Brave, Exa, Tavily, Jina, Firecrawl, AssemblyAI, OmniRoute (502 models) OK; Groq returns 403 even with a valid 56-char key (provider-side block; do not circumvent, ToS). OmniRoute (Docker `omniroute`) listens on 127.0.0.1:20128/v1, LiteLLM (Docker `litellm`) on 127.0.0.1:4000, both Mac-only: production must use direct OpenRouter/Mistral keys in its own `.env`, with separate keys + spend caps.

CI is local: `bash scripts/dev/local_ci.sh` (self-bootstraps ~/venvs/roxira; pre-push hook, skip once with SKIP_LOCAL_CI=1). GitHub Actions is DISABLED on Mahan-film/roxira-platform (private minutes exhausted, owner pays nothing); owner merges PRs with `gh pr merge N --repo Mahan-film/roxira-platform --squash --admin --delete-branch`. Public repo mahan-films/roxira was made PRIVATE after leaked search keys (see [[feedback-scan-keys-before-publishing]]); republish clean later. Nothing is auto-deployed: today's changes (ruling route, Google env-only #470, /health #475) are not on the server until the owner deploys; Google login needs new GOOGLE_CLIENT_ID/SECRET in the prod .env first.

**Why:** avoids re-deriving state and re-asking the owner for the same steps. **How to apply:** read this before suggesting key, CI or deploy steps; related [[project-public-repo-and-zero-cost]], [[feedback-terminal-commands-not-ui]].
