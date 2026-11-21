---
name: feedback-scan-keys-before-publishing
description: "gitleaks alone missed real keys; scan with provider-specific patterns before any public push, and never print key-bearing lines"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8397ea00-8e5d-4ca7-bb7e-b2a46f06fd77
  modified: 2026-10-03T20:14:39.342Z
---

On 2026-10-03 the public repo mahan-films/roxira went out with `probe_search_keys.py` containing 8 real search-API keys (Tavily x4, Exa, Brave, Jina, Firecrawl); gitleaks (generic rules) reported clean and I said so. Found only because a local test printed a Brave key.

**Why:** generic secret scanners miss provider-specific formats; I over-claimed "clean".

**How to apply:** before any public push, grep the tree for provider prefixes (tvly-, BSA, gsk_, AIza, sk-or-v1-, sk-ant-, xai-, pplx-, fc-, exa/jina patterns) plus gitleaks, and report counts by filename only. Do not state "clean" without that scan. Helper scripts must never echo a line from the env file (a malformed line leaked an OpenRouter key into the terminal). External-key prompts should only cover names ending API_KEY(S); internal settings (JWT_*, TTL, URLs) are never asked. See [[project-public-repo-and-zero-cost]].
