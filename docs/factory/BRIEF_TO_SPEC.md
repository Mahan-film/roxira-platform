# Brief to spec (factory F3)

`scripts/factory/brief_to_spec.py` turns a one-paragraph brief into researched, owner-approved task files.
Stdlib only; runs on the production host as root. Projects live in `/var/lib/roxira-factory/projects/<slug>/`
(override with `FACTORY_HOME`).

## Flow

```
new -> research -> spec -> propose -> (owner taps in the bot) -> approve | reject
```

1. Write `brief.md` (a paragraph; optionally a line `visibility: public` or `visibility: private`).
2. `python3 scripts/factory/brief_to_spec.py new --brief brief.md --slug my-product`
   (slug: `^[a-z0-9-]{1,40}$`). Creates `brief.md` and `state.json` (status `researching`).
3. `... research my-product` runs three fixed questions (market and competitors and prices; technology
   options with cost, open source first; compliance, legal and data-licensing risks) one after another
   against the research service (25 min timeout each). Output: `research/<name>.md` and
   `research/<name>.sources.json`. A failed question is recorded in `state.json` and never stops the run.
   Exit code 2 means at least one failed; re-run to retry (it overwrites).
4. `... spec my-product` sends the brief plus each report (first 12k chars) to the key pool gateway.
   Public/unspecified briefs use `agent-strong-free`, then `private` if that fails; `visibility: private`
   briefs use only `private`. Writes `spec.md` (Problem & customer, Evidence, Options, Recommendation,
   MVP scope, Task list, Open questions, Kill criteria) and `summary_fa.md` (Persian, max 12 lines).
   Read `spec.md` yourself: evidence URLs must come from the reports.
5. `... propose my-product` sends the Persian summary to the owner bot with buttons Approve / Reject
   (status `awaiting_approval`).
6. The owner taps a button. The control bot runs `brief_to_spec.py approve|reject <slug>` (owner chat only,
   slug validated). The same commands can be run by hand.
7. `approve` writes `tasks/t<N>.md` per task from the `### T<N>: title` / `- Scope:` / `- Acceptance:`
   entries. If `state.json` has `"repo_dir"`, each task is also added to the task queue (`taskq.py add`)
   with its scope; tasks are `--public` only when the brief says `visibility: public`. Without `repo_dir`
   the project is just marked `approved` and the task files wait.

`status [<slug>]` lists projects and their status.

## Hub checklist

- Set `repo_dir` in `state.json` once the product repo exists, before approving.
- Review `spec.md` before `propose`; edit it freely (approve re-reads it).
- `KEYPOOL_MASTER_KEY` is read from the environment or `/opt/roxira_platform/.env`; the research token from
  `RESEARCH_TOKEN` or `docker exec roxira_research printenv RESEARCH_TOKEN`. Neither is printed.
- Env overrides: `FACTORY_HOME`, `RESEARCH_URL`, `AGENT_GATEWAY_URL`, `TASKQ_BIN`, `NOTIFY_PY`.
