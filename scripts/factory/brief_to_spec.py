#!/usr/bin/env python3
"""Factory F3: brief -> research -> spec -> owner approval -> task files (stdlib only).

Runs on the production host as root. Projects live in $FACTORY_HOME/projects/<slug>/
(default /var/lib/roxira-factory). Usage:

  brief_to_spec.py new --brief FILE --slug S
  brief_to_spec.py research|spec|propose|approve|reject <slug>
  brief_to_spec.py status [<slug>]

A brief may contain a line `visibility: public` or `visibility: private`. Only `private`
changes the spec model (paid "private" group); only `public` lets queued tasks be public.
Secrets are read from the environment / .env and never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

SLUG_RE = re.compile(r"^[a-z0-9-]{1,40}$")
HOME = os.environ.get("FACTORY_HOME", "/var/lib/roxira-factory")
RESEARCH_URL = os.environ.get("RESEARCH_URL", "http://127.0.0.1:8090/research")
GATEWAY_URL = os.environ.get("AGENT_GATEWAY_URL", "http://127.0.0.1:4000/v1") + "/chat/completions"
REPO_ENV = os.environ.get("ROXIRA_REPO_ENV", "/opt/roxira_platform/.env")
TASKQ = os.environ.get("TASKQ_BIN", "/opt/roxira_platform/scripts/infra/server_agents/taskq.py")
NOTIFY = os.environ.get("NOTIFY_PY", "/opt/roxira_platform/scripts/ops/notify/notify.py")
HOUSE_STACK = os.environ.get("FACTORY_HOUSE_STACK", "/opt/roxira_platform/docs/factory/HOUSE_STACK.md")
RESEARCH_TIMEOUT = 25 * 60
LLM_TIMEOUT = 600
REPORT_LIMIT = 12000
STATUSES = ("researching", "researched", "specced", "awaiting_approval", "approved", "rejected")

QUESTIONS = {
    "market": (
        "Market, competitors and prices. For the product idea below, identify the target customers, "
        "the main existing competitors, their pricing and plans, demand signals, and gaps we could "
        "fill. Cite sources.\n\nProduct brief:\n{brief}"
    ),
    "tech": (
        "Technology options. For the product idea below, compare technology options for each layer "
        "(frontend, backend, database, auth, billing, AI/LLM, hosting, analytics). Prefer open-source "
        "components first; give the approximate monthly cost of each option and its main risks. "
        "Cite sources.\n\nProduct brief:\n{brief}"
    ),
    "compliance": (
        "Compliance, legal and data-licensing risks. For the product idea below, list the legal, "
        "regulatory, privacy, AI-transparency and data/content licensing obligations and risks in "
        "the target markets, and what we must do to comply. Cite sources.\n\nProduct brief:\n{brief}"
    ),
}

SPEC_PROMPT = """You are the architect of a small software factory. From the BRIEF and the three RESEARCH reports below, write spec.md in English, in Markdown, with exactly these level-2 sections in this order:
## Problem & customer
## Evidence
## Options
## Recommendation
## MVP scope
## Task list
## Open questions
## Kill criteria

Rules:
- Evidence: only facts from the reports, each with its source URL taken from the reports. Never invent a URL or a number; if evidence is missing, say so.
- Options: 2-3 stack options, each with a monthly cost and risks.
- Task list: 5-15 tasks, each formatted exactly as:
### T1: <title>
- Scope: <comma-separated repo directories>
- Acceptance: <one runnable acceptance test or check>
- Kill criteria: measurable conditions to stop the project.
Output only the Markdown document."""

SUMMARY_PROMPT = (
    "Write a short plain Persian (Farsi) summary of the spec below for a non-technical owner: "
    "at most 12 lines, no tables, no code. Cover: what the product is, who pays, recommended stack "
    "and monthly cost, main risk, number of tasks, and the decision asked (approve or reject). "
    "Output only the summary."
)


# ------------------------------------------------------------------ helpers
def valid_slug(slug: str) -> bool:
    return bool(isinstance(slug, str) and SLUG_RE.fullmatch(slug))


def project_dir(slug: str) -> str:
    if not valid_slug(slug):
        raise ValueError("invalid slug (use a-z, 0-9, '-', max 40 chars)")
    return os.path.join(HOME, "projects", slug)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def load_state(slug: str) -> dict:
    return json.loads(_read(os.path.join(project_dir(slug), "state.json")))


def save_state(slug: str, state: dict) -> None:
    state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    _write(os.path.join(project_dir(slug), "state.json"), json.dumps(state, indent=2))


def set_status(slug: str, status: str, **extra) -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown status {status}")
    state = load_state(slug)
    state["status"] = status
    state.update(extra)
    save_state(slug, state)
    return state


def visibility(brief: str) -> str:
    m = re.search(r"^\s*visibility\s*:\s*(public|private)\b", brief, re.I | re.M)
    return m.group(1).lower() if m else "unspecified"


def build_questions(brief: str) -> dict:
    # str.replace, not format(): the brief may contain braces.
    return {name: tpl.replace("{brief}", brief.strip()) for name, tpl in QUESTIONS.items()}


def env_value(name: str) -> str:
    """Read a variable from the environment, else from the repo .env. Never printed."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in _read(REPO_ENV).splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def post_json(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (local service)
        return json.loads(resp.read().decode("utf-8"))


def research_token() -> str:
    tok = os.environ.get("RESEARCH_TOKEN", "")
    if tok:
        return tok
    try:
        out = subprocess.run(
            ["docker", "exec", "roxira_research", "printenv", "RESEARCH_TOKEN"],
            capture_output=True, text=True, timeout=20, check=False,
        )
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def parse_tasks(spec: str) -> list:
    """Parse the '## Task list' section into [{id,title,scope,acceptance}]."""
    m = re.search(r"^##\s+Task list\s*$(.*?)(?=^##\s|\Z)", spec, re.M | re.S | re.I)
    if not m:
        return []
    tasks, cur = [], None
    for line in m.group(1).splitlines():
        head = re.match(r"^###\s+(?:(T\d+)\s*[:.\-]\s*)?(.+?)\s*$", line) or re.match(
            r"^\d+\.\s+\*{0,2}(?:(T\d+)\s*[:.\-]\s*)?(.+?)\*{0,2}\s*$", line
        )
        if head:
            cur = {"id": head.group(1) or f"T{len(tasks) + 1}", "title": head.group(2),
                   "scope": [], "acceptance": ""}
            tasks.append(cur)
            continue
        if cur is None:
            continue
        f = re.match(r"^\s*[-*]\s*\**(Scope|Acceptance)\**\s*:\**\s*(.+?)\s*$", line, re.I)
        if f and f.group(1).lower() == "scope":
            cur["scope"] = [s.strip(" `") for s in f.group(2).split(",") if s.strip(" `")]
        elif f:
            cur["acceptance"] = f.group(2)
    return [t for t in tasks if t["title"]]


# ----------------------------------------------------------------- commands
def cmd_new(brief_file: str, slug: str) -> int:
    pdir = project_dir(slug)
    if os.path.exists(pdir):
        print(f"project {slug} already exists", file=sys.stderr)
        return 1
    brief = _read(brief_file)
    _write(os.path.join(pdir, "brief.md"), brief)
    save_state(slug, {"slug": slug, "status": "researching", "visibility": visibility(brief),
                      "created": time.strftime("%Y-%m-%dT%H:%M:%S")})
    print(f"created {pdir}")
    return 0


def cmd_research(slug: str, post=post_json, token=None) -> int:
    pdir = project_dir(slug)
    brief = _read(os.path.join(pdir, "brief.md"))
    token = research_token() if token is None else token
    results = {}
    for name, question in build_questions(brief).items():
        try:
            data = post(
                RESEARCH_URL,
                {"query": question, "report_type": "research_report", "language": "en",
                 "max_sources": 12},
                {"Authorization": f"Bearer {token}"},
                RESEARCH_TIMEOUT,
            )
            report = str(data.get("report_markdown") or "")
            if not report:
                raise ValueError("empty report")
            _write(os.path.join(pdir, "research", f"{name}.md"), report)
            _write(os.path.join(pdir, "research", f"{name}.sources.json"),
                   json.dumps({"sources": data.get("sources") or [], "costs": data.get("costs")},
                              indent=2))
            results[name] = "ok"
        except Exception as exc:  # never crash: record and continue
            results[name] = f"failed: {type(exc).__name__}"
        print(f"research {name}: {results[name]}")
    set_status(slug, "researched", research=results)
    return 0 if all(v == "ok" for v in results.values()) else 2


def chat(model: str, prompt: str, key: str, post=post_json) -> str:
    data = post(
        GATEWAY_URL,
        {"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2},
        {"Authorization": f"Bearer {key}"},
        LLM_TIMEOUT,
    )
    return str(data["choices"][0]["message"]["content"]).strip()


REQUIRED_SECTIONS = ("## Options", "## Recommendation", "## Task list", "## Kill criteria")


def degenerate(text: str) -> bool:
    """True for looping model output: one word repeated 8+ times in a row, or a 30-char chunk 6+ times."""
    words = text.split()
    run = 1
    for a, b in zip(words, words[1:]):
        run = run + 1 if a == b else 1
        if run >= 8:
            return True
    for i in range(0, max(0, len(text) - 30), 30):
        chunk = text[i:i + 30]
        if chunk.strip() and text.count(chunk) >= 6:
            return True
    return False


def spec_ok(spec: str) -> bool:
    return bool(spec) and not degenerate(spec) and all(h in spec for h in REQUIRED_SECTIONS) \
        and len(parse_tasks(spec)) >= 5


def spec_models(brief: str) -> list:
    return ["private"] if visibility(brief) == "private" else ["agent-strong-free", "private"]


def cmd_spec(slug: str, post=post_json, key=None) -> int:
    pdir = project_dir(slug)
    brief = _read(os.path.join(pdir, "brief.md"))
    key = env_value("KEYPOOL_MASTER_KEY") if key is None else key
    if not key:
        print("KEYPOOL_MASTER_KEY not available", file=sys.stderr)
        return 1
    parts = [SPEC_PROMPT, "\n\n# BRIEF\n" + brief]
    if os.path.exists(HOUSE_STACK):  # options and the recommendation must start from what we already run
        parts.append("\n\n# HOUSE STACK (option 1 must be built on this; deviate only with a stated hard reason)\n"
                     + _read(HOUSE_STACK))
    for name in QUESTIONS:
        path = os.path.join(pdir, "research", f"{name}.md")
        text = _read(path)[:REPORT_LIMIT] if os.path.exists(path) else "(research failed or missing)"
        parts.append(f"\n\n# RESEARCH: {name}\n{text}")
    prompt = "".join(parts)
    spec, used = "", ""
    for model in spec_models(brief):
        try:
            candidate = chat(model, prompt, key, post)
        except Exception as exc:
            print(f"model {model} failed: {type(exc).__name__}", file=sys.stderr)
            continue
        if spec_ok(candidate):
            spec, used = candidate, model
            break
        print(f"model {model} gave an incomplete or looping spec; trying the next model", file=sys.stderr)
        spec, used = spec or candidate, used or model  # keep the best effort if every model fails the check
    if not spec:
        print("spec generation failed", file=sys.stderr)
        return 1
    _write(os.path.join(pdir, "spec.md"), spec + "\n")
    summary = ""
    for model in dict.fromkeys([used] + spec_models(brief)):  # used first, then the rest, no repeats
        try:
            candidate = chat(model, SUMMARY_PROMPT + "\n\n" + spec, key, post)
        except Exception:
            continue
        if candidate.strip() and not degenerate(candidate) and len(candidate) < 3000:
            summary = candidate
            break
    lines = [ln for ln in summary.splitlines() if ln.strip()][:12]
    if not lines:
        lines = [f"مشخصات پروژه {slug} آماده است؛ خلاصه فارسی ساخته نشد، فایل spec.md را ببینید."]
    _write(os.path.join(pdir, "summary_fa.md"), "\n".join(lines) + "\n")
    count = len(parse_tasks(spec))
    set_status(slug, "specced", spec_model=used, task_count=count)
    print(f"spec written with {used}; tasks: {count}")
    return 0


def notify_send(text: str, buttons=None) -> bool:
    sys.path.insert(0, os.path.dirname(NOTIFY))
    try:
        import notify  # type: ignore

        return bool(notify.send(text, buttons=buttons))
    except Exception:
        return False


def cmd_propose(slug: str, send=notify_send) -> int:
    pdir = project_dir(slug)
    summary = _read(os.path.join(pdir, "summary_fa.md")).strip()
    sent = send(
        f"📝 پیشنهاد پروژه «{slug}»\n\n{summary}",
        [("✅ تأیید", f"spec:approve:{slug}"), ("❌ رد", f"spec:reject:{slug}")],
    )
    set_status(slug, "awaiting_approval")
    print("proposal sent" if sent else "proposal NOT sent (bot not configured?)")
    return 0 if sent else 2


def enqueue(slug: str, task: dict, task_file: str, public: bool, run=subprocess.run) -> bool:
    """Hand one task file to taskq. ASSUMED CLI: taskq.py add --task-file F --slug S [--scope D]... [--public]."""
    cmd = [sys.executable, TASKQ, "add", "--task-file", task_file,
           "--slug", f"{slug}-{task['id'].lower()}"]
    for scope in task["scope"]:
        cmd += ["--scope", scope]
    if public:
        cmd.append("--public")
    try:
        return run(cmd, capture_output=True, text=True, timeout=60, check=False).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def cmd_approve(slug: str, run=subprocess.run) -> int:
    pdir = project_dir(slug)
    try:
        prev = json.loads(_read(os.path.join(pdir, "state.json")) or "{}").get("status")
    except ValueError:
        prev = None
    if prev in ("approved", "rejected"):  # a second click must never queue the tasks twice
        print(f"{slug} is already {prev}; nothing done")
        return 0
    state = set_status(slug, "approved")
    brief = _read(os.path.join(pdir, "brief.md"))
    tasks = parse_tasks(_read(os.path.join(pdir, "spec.md")))
    public = visibility(brief) == "public"
    repo = state.get("repo_dir")
    queued = 0
    for task in tasks:
        body = (f"# {task['id']}: {task['title']}\n\nScope: {', '.join(task['scope'])}\n"
                f"Acceptance: {task['acceptance']}\n\nProject: {slug}. See spec.md in {pdir}.\n")
        tfile = os.path.join(pdir, "tasks", f"{task['id'].lower()}.md")
        _write(tfile, body)
        if repo and enqueue(slug, task, tfile, public, run):
            queued += 1
    set_status(slug, "approved", queued=queued)
    if repo:
        print(f"approved; {queued}/{len(tasks)} tasks queued")
    else:
        print(f"approved; {len(tasks)} task files ready, no repo_dir configured so nothing queued")
    return 0


def cmd_reject(slug: str) -> int:
    set_status(slug, "rejected")
    print(f"rejected {slug}")
    return 0


def cmd_status(slug) -> int:
    root = os.path.join(HOME, "projects")
    slugs = [slug] if slug else (sorted(os.listdir(root)) if os.path.isdir(root) else [])
    for s in slugs:
        try:
            st = load_state(s)
            print(f"{s}\t{st.get('status')}\t{st.get('updated', '')}")
        except (OSError, ValueError):
            print(f"{s}\tunknown")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new")
    p.add_argument("--brief", required=True)
    p.add_argument("--slug", required=True)
    for name in ("research", "spec", "propose", "approve", "reject"):
        sub.add_parser(name).add_argument("slug")
    sub.add_parser("status").add_argument("slug", nargs="?")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "status":
            return cmd_status(args.slug)
        if args.cmd == "new":
            return cmd_new(args.brief, args.slug)
        project_dir(args.slug)  # validates the slug
        return {"research": cmd_research, "spec": cmd_spec, "propose": cmd_propose,
                "approve": cmd_approve, "reject": cmd_reject}[args.cmd](args.slug)
    except (ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
