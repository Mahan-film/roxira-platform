# ROXIRA Tech Radar MCP server (W9 Phase B, item 4)

`src/automation/mcp_server.py` exposes the tech-radar / project-brief
pipeline as a **stdio MCP server**, so any *other* project — a brand-new repo
Claude Code is opened in — can research its own stack using ROXIRA's
OpenRouter cheap/free-tier budget instead of spending Anthropic tokens on web
research.

## Tools

| Tool | Purpose |
| --- | --- |
| `research_project(idea, multilingual=true)` | Runs `project-brief` mode end-to-end and returns the generated per-layer markdown brief. |
| `radar_digest(topics, deep=false, title=...)` | Runs one or more ad-hoc daily-radar topics and returns a merged digest (does not touch the production cron's history). |
| `compare_technologies(names, context="")` | Side-by-side comparison of 2+ named technologies for an optional use case. |

## Install

From the `roxira_platform` repo root:

```bash
pip install mcp
# or: uv pip install -e ".[research-mcp]"
```

`OPENROUTER_API_KEY` plus at least one of `TAVILY_API_KEYS` / `EXA_API_KEY` /
`BRAVE_SEARCH_API_KEY` must be set in the environment or a `.env` the server
can read (see `src/automation/provider_base.py`'s `ENV_CANDIDATES`). Without
them every tool call returns `status=FAILED` — the router and the pipeline
both refuse to report a degraded/empty run as a success (see
`docs/research/bakeoff.md` §1 finding 5).

## Add it to Claude Code from *any* repo

```bash
claude mcp add roxira-tech-radar -- \
  python3 -m src.automation.mcp_server --directory /opt/roxira_platform
```

(`--directory` points the server at the roxira_platform checkout; omit it
only if you are launching the server from inside that checkout already.) Use
the server's own machine/checkout path — e.g. `/opt/roxira_platform` on the
production host, or your local clone's path — not a path inside the new
project you are researching.

To remove it later: `claude mcp remove roxira-tech-radar`.

## Run standalone (debugging)

```bash
cd /opt/roxira_platform
python3 -m src.automation.mcp_server
```

This starts the stdio server directly; use an MCP inspector
(`npx @modelcontextprotocol/inspector python3 -m src.automation.mcp_server`)
to call tools interactively without wiring it into Claude Code first.
