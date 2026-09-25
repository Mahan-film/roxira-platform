#!/usr/bin/env python3
"""Legacy task_queue.json worker.

**This server is not an agent host.** Agent tasks run only on GitHub Actions
ephemeral runners (`.github/workflows/agent-task.yml`) — see the security
rationale in agent_runner.py's module docstring and docs/AGENTS_WORKFORCE.md #6.
`agent_runner.py` itself refuses any real (non-dry-run) work unless
`AGENT_RUNTIME=github-actions` is set, which the production server's `.env`
must never set.

W10 phase 1 (PR #18) removed this file's `git add/commit/push` to `main`.
W10 phase 2 goes further: this worker no longer runs `roxira_factory_engine.py`
in the live checkout at all. `task_queue.json` has no real GitHub issue behind
it anyway, so this legacy path always calls `agent_runner.process_one_issue()`
with `dry_run=True` — it plans and previews (branch name, prompt, would-be
denylist/checks outcome) but never runs `opencode`, commits, pushes, or talks
to the GitHub API. The real, actionable path is the GitHub-issue `agent` label,
handled entirely by the GitHub Actions workflow above.
"""
import json
import os
import sys
import time

sys.path.insert(0, "/opt/roxira_platform")

import agent_runner

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"


def process_task(task):
    task_id = task.get("id", f"TASK-{int(time.time())}")
    prompt = task.get("prompt", "توسعه زیرسیستم هوشمند")
    print(f"\n🚀 [Autonomous Worker] آغاز اجرای دقیق تسک: {task_id}")
    print(f"📝 هدف: {prompt}")

    cfg = agent_runner.RunnerConfig.from_env()
    # task_queue.json has no real GitHub issue behind it, so there is nothing to
    # comment on, push a branch for review against, or label. Always dry-run:
    # this only previews the plan (branch name, prompt) into the queue file.
    # The real path is a GitHub issue labelled `agent`, run via agent_runner.py
    # directly (see its own main()).
    issue = {"number": task_id, "title": prompt, "body": ""}
    repo_dir = agent_runner.Path(__file__).resolve().parents[4]
    try:
        result = agent_runner.process_one_issue(issue, cfg, repo_dir, dry_run=True)
    except Exception as exc:
        result = {"status": "error", "error": str(exc)}

    task["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S UTC")
    task["result"] = result
    task["status"] = "SUCCESS" if result.get("status") == "dry-run" else "FAILED"
    return task


def run():
    if not os.path.exists(QUEUE_FILE):
        return
    with open(QUEUE_FILE, encoding="utf-8") as f:
        data = json.load(f)

    pending = data.get("pending", [])
    if not pending:
        print("💤 [Worker] صف تسک‌های معوقه خالی است.")
        return

    current = pending.pop(0)
    finished = process_task(current)
    data.setdefault("completed", []).append(finished)

    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ تسک {finished['id']} بیلد و ثبت شد.")


if __name__ == "__main__":
    run()
