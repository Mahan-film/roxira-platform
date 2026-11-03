#!/usr/bin/env python3
"""Live team status report: what is happening and what must be done next.

  python3 scripts/dev/team_status.py [--no-ssh] [--no-sites] [--out FILE] [--json]
                                     [--telegram | --telegram-host HOST] [--release-stale]
                                     [--stale-hours N]

Read-only unless --release-stale is given (that edits GitHub issues). GitHub access is
REST only (`gh api`), like whoswhat.sh. See docs/COLLABORATION.md "Live status report".
Stdlib only. Parse/classify/next-action functions take plain dicts (unit-testable).
"""

# ruff: noqa: UP031  (printf-style formatting is used on purpose for the report lines)

from __future__ import annotations

import argparse
import collections
import functools
import importlib.util
import json
import operator
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta, timezone

DEFAULT_REPO = "Mahan-film/roxira-platform"
DEPLOY_STATE_CMD = "cat /root/deploy-state/autodeploy-last.json"
SITES = [
    "https://roxira.ir/",
    "https://roxira.ir/app",
    "https://roxira.net/",
    "https://ghazihoushmand.ir/",
    "https://ghazihoushmand.ir/api/v1/apps/judge/health",
]
AGENT_STALE_HOURS = 2.0
OTHER_STALE_HOURS = 24.0
TELEGRAM_MAX = 3500
CLAIM_LABEL = "in-progress"
REMOTE_NOTIFY_CMD = "python3 /opt/roxira_platform/scripts/ops/notify/notify.py"


# ---------------------------------------------------------------- pure helpers
def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def hours_since(value: str | None, now: datetime) -> float | None:
    ts = parse_ts(value)
    return None if ts is None else max(0.0, (now - ts).total_seconds() / 3600)


def classify_actor(branch: str, login: str) -> str:
    """Actor type from a branch name: agent:<id>, relay, dependabot, else the human login."""
    if branch.startswith("agent/"):
        parts = branch.split("/")
        return "agent:" + (parts[1] if len(parts) > 1 and parts[1] else "unknown")
    if branch.startswith("relay/"):
        return "relay"
    if branch.startswith("dependabot/"):
        return "dependabot"
    return login or "unknown"


def stale_threshold(branch: str, override: float | None = None) -> float:
    if override is not None:
        return override
    return AGENT_STALE_HOURS if branch.startswith("agent/") else OTHER_STALE_HOURS


def summarize_pr(pr: dict, now: datetime) -> dict:
    branch = (pr.get("head") or {}).get("ref", "")
    login = (pr.get("user") or {}).get("login", "")
    return {
        "number": pr["number"],
        "title": pr.get("title", ""),
        "author": login,
        "draft": bool(pr.get("draft")),
        "branch": branch,
        "actor": classify_actor(branch, login),
        "age_h": hours_since(pr.get("created_at"), now),
        "idle_h": hours_since(pr.get("updated_at"), now),
        "body": pr.get("body") or "",
        "labels": [lb["name"] for lb in pr.get("labels", [])],
    }


def summarize_issue(issue: dict, now: datetime) -> dict:
    return {
        "number": issue["number"],
        "title": issue.get("title", ""),
        "assignees": [a["login"] for a in issue.get("assignees", [])],
        "idle_h": hours_since(issue.get("updated_at"), now),
        "labels": [lb["name"] for lb in issue.get("labels", [])],
    }


def linked_pr(issue_number: int, prs: list[dict]) -> dict | None:
    pat = re.compile(r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#%d\b" % issue_number)
    for pr in prs:
        if pat.search(pr.get("body", "")) or re.search(
            r"#%d\b" % issue_number, pr.get("title", "")
        ):
            return pr
    return None


def find_stale(issues: list[dict], prs: list[dict], override: float | None = None) -> list[dict]:
    """Stale claims: in-progress issues and draft PRs idle beyond their threshold."""
    out = []
    for iss in issues:
        pr = linked_pr(iss["number"], prs)
        branch = pr["branch"] if pr else ""
        idle = iss["idle_h"]
        if pr and pr["idle_h"] is not None:
            idle = pr["idle_h"] if idle is None else min(idle, pr["idle_h"])
        limit = stale_threshold(branch, override)
        if idle is not None and idle > limit:
            owner = ", ".join(iss["assignees"]) or (pr["actor"] if pr else "UNASSIGNED")
            out.append(
                {
                    "kind": "issue",
                    "number": iss["number"],
                    "owner": owner,
                    "idle_h": idle,
                    "limit_h": limit,
                    "title": iss["title"],
                }
            )
    claimed_by_issue = {s["number"] for s in out}
    for pr in prs:
        if not pr["draft"]:
            continue
        limit = stale_threshold(pr["branch"], override)
        if pr["idle_h"] is not None and pr["idle_h"] > limit:
            if any(
                re.search(r"#%d\b" % n, pr["body"] + " " + pr["title"]) for n in claimed_by_issue
            ):
                continue  # already reported through its issue
            out.append(
                {
                    "kind": "pr",
                    "number": pr["number"],
                    "owner": pr["actor"],
                    "idle_h": pr["idle_h"],
                    "limit_h": limit,
                    "title": pr["title"],
                }
            )
    return out


def find_overlaps(files_by_pr: dict) -> dict[str, list[int]]:
    touch: dict[str, list[int]] = collections.defaultdict(list)
    for num, files in files_by_pr.items():
        for f in files:
            touch[f].append(int(num))
    return {f: sorted(n) for f, n in sorted(touch.items()) if len(n) > 1}


def parse_deploy_state(raw: str) -> dict:
    """Normalise autodeploy-last.json (field names vary, so look at several)."""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")

    def pick(*keys):
        for k in keys:
            if data.get(k) not in (None, ""):
                return data[k]
        return None

    result = pick("result", "status", "outcome", "state")
    if result is None and "ok" in data:
        result = "ok" if data["ok"] else "failed"
    return {
        "result": str(result) if result is not None else "unknown",
        "target": pick("target", "sha", "commit", "head", "ref"),
        "time": pick("time", "finished_at", "ended_at", "timestamp", "ts", "date"),
        "log": pick("log", "log_path", "logfile"),
    }


def deploy_failed(dep: dict) -> bool:
    return bool(re.search(r"fail|error|rollback|abort", str(dep.get("result", "")), re.I))


def next_actions(data: dict) -> list[str]:
    """Plain imperative list from the collected data (all plain dicts)."""
    acts: list[str] = []
    dep = data.get("deploy")
    if dep and deploy_failed(dep):
        acts.append(
            "Prod deploy failed: read {} on roxira-prod (target {}).".format(
                dep.get("log") or "/root/deploy-state/ and the autodeploy log",
                dep.get("target") or "?",
            )
        )
    for s in data.get("sites", []):
        if not s.get("ok"):
            acts.append(
                "Site {} returned {}.".format(
                    s["url"], s.get("status") or s.get("error") or "no response"
                )
            )
    for f, nums in data.get("overlaps", {}).items():
        acts.append(
            "Resolve overlap on {} between {}.".format(f, " and ".join("#%d" % n for n in nums))
        )
    stale = data.get("stale", [])
    for s in stale:
        label = "claim" if s["kind"] == "issue" else "draft PR"
        acts.append(
            "Release stale %s #%d (owner %s, idle %.0f h): run "
            "`python3 scripts/dev/team_status.py --release-stale` "
            "or `gh issue edit %d --remove-label %s --remove-assignee <owner>`."
            % (label, s["number"], s["owner"], s["idle_h"], s["number"], CLAIM_LABEL)
        )
    overlapped = {n for nums in data.get("overlaps", {}).values() for n in nums}
    stale_prs = {s["number"] for s in stale if s["kind"] == "pr"}
    for pr in data.get("prs", []):
        if not pr["draft"] and pr["number"] not in overlapped and pr["number"] not in stale_prs:
            acts.append(
                "Review and merge #%d (ready, no conflicts): %s" % (pr["number"], pr["title"])
            )
    if not acts:
        acts.append("Nothing urgent: pick the next issue and claim it with scripts/dev/claim.sh.")
    return acts


# ---------------------------------------------------------------- rendering
def fmt_h(h: float | None) -> str:
    if h is None:
        return "?"
    return f"{h:.0f} h" if h >= 1 else "%.0f min" % (h * 60)


def tehran_time(now: datetime) -> datetime:
    try:
        from zoneinfo import ZoneInfo

        return now.astimezone(ZoneInfo("Asia/Tehran"))
    except Exception:
        return now.astimezone(timezone(timedelta(hours=3, minutes=30)))


def render(data: dict) -> str:
    now = data["now"]
    L = [
        "# Team status",
        "",
        "- Time: {} UTC / {} Tehran".format(
            now.strftime("%Y-%m-%d %H:%M"), tehran_time(now).strftime("%Y-%m-%d %H:%M")
        ),
        "- main: `%s`" % (data.get("main_sha") or "unknown"),
        "",
        "## Production",
        "",
    ]
    dep = data.get("deploy")
    if dep:
        L.append(
            "- Last autodeploy: **{}**, target {}, time {}".format(
                dep["result"], dep.get("target") or "?", dep.get("time") or "?"
            )
        )
    else:
        L.append("- Last autodeploy: not checked ({})".format(data.get("deploy_note", "skipped")))
    if data.get("sites"):
        for s in data["sites"]:
            L.append("- {} {}".format(s["url"], s.get("status") or s.get("error")))
    else:
        L.append("- Sites: not checked")
    L += ["", "## Work in progress", "", "Claimed issues:"]
    L += [
        "- #%d [%s] %s (idle %s)"
        % (i["number"], ",".join(i["assignees"]) or "UNASSIGNED", i["title"], fmt_h(i["idle_h"]))
        for i in data["issues"]
    ] or ["- none"]
    L += ["", "Open PRs:"]
    L += [
        "- #%d %s, %s, %s, age %s, idle %s, `%s`: %s"
        % (
            p["number"],
            p["actor"],
            "draft" if p["draft"] else "ready",
            p["author"],
            fmt_h(p["age_h"]),
            fmt_h(p["idle_h"]),
            p["branch"],
            p["title"],
        )
        for p in data["prs"]
    ] or ["- none"]
    L += ["", "## Stale claims", ""]
    L += [
        "- %s #%d owner %s idle %s (limit %s h): %s"
        % (
            s["kind"],
            s["number"],
            s["owner"],
            fmt_h(s["idle_h"]),
            "{:g}".format(s["limit_h"]),
            s["title"],
        )
        for s in data["stale"]
    ] or ["- none"]
    L += ["", "## Conflicts (files in more than one open PR)", ""]
    L += [
        "- {} <- {}".format(f, ", ".join("#%d" % n for n in nums))
        for f, nums in data["overlaps"].items()
    ] or ["- none"]
    L += ["", "## Merged in the last 24 h", ""]
    L += ["- #%d %s (%s)" % (m["number"], m["title"], m["author"]) for m in data["merged"]] or [
        "- none"
    ]
    L += ["", "## Next actions", ""]
    L += ["%d. %s" % (i, a) for i, a in enumerate(data["actions"], 1)]
    return "\n".join(L) + "\n"


def render_short(data: dict) -> str:
    dep = data.get("deploy")
    L = [
        "Roxira status {} UTC main {}".format(
            data["now"].strftime("%m-%d %H:%M"), (data.get("main_sha") or "?")[:9]
        )
    ]
    L.append("Deploy: %s" % (dep["result"] if dep else "n/a"))
    bad = [s["url"] for s in data.get("sites", []) if not s.get("ok")]
    L.append("Sites down: %s" % (", ".join(bad) if bad else "none"))
    L.append(
        "Claims %d, open PRs %d, stale %d, overlaps %d, merged 24h %d"
        % (
            len(data["issues"]),
            len(data["prs"]),
            len(data["stale"]),
            len(data["overlaps"]),
            len(data["merged"]),
        )
    )
    L.append("Next:")
    L += ["%d. %s" % (i, a) for i, a in enumerate(data["actions"], 1)]
    return "\n".join(L)[:TELEGRAM_MAX]


# ---------------------------------------------------------------- I/O
def gh_json(path: str, repo_scope: bool = True, extra: list[str] | None = None):
    cmd = ["gh", "api"] + (extra or []) + [path]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        raise RuntimeError(
            "gh api {} failed: {}".format(path.split("?")[0], res.stderr.strip()[:200])
        )
    return json.loads(res.stdout) if res.stdout.strip() else None


def gh_mutate(args: list[str]) -> None:
    res = subprocess.run(["gh", "api", *args], capture_output=True, text=True, timeout=60)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip()[:200])


def pr_files(repo: str, number: int) -> list[str]:
    res = subprocess.run(
        [
            "gh",
            "api",
            "--paginate",
            "repos/%s/pulls/%d/files?per_page=100" % (repo, number),
            "-q",
            ".[].filename",
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )
    return res.stdout.split() if res.returncode == 0 else []


def ssl_context() -> ssl.SSLContext:
    """Default context; fall back to the system bundle when python has no CA store (macOS)."""
    ctx = ssl.create_default_context()
    if not ctx.cert_store_stats().get("x509_ca"):
        for bundle in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
            if os.path.exists(bundle):
                ctx.load_verify_locations(bundle)
                break
    return ctx


def check_site(url: str, timeout: float = 15) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "roxira-team-status/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as r:
            return {"url": url, "status": r.status, "ok": r.status < 400}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "ok": e.code < 400}
    except Exception as e:  # DNS, TLS, timeout
        return {"url": url, "status": None, "ok": False, "error": type(e).__name__}


def fetch_deploy() -> tuple[dict | None, str]:
    try:
        res = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=8",
                "roxira-prod",
                DEPLOY_STATE_CMD,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if res.returncode != 0:
            return None, "ssh failed (exit %d)" % res.returncode
        return parse_deploy_state(res.stdout), ""
    except Exception as e:
        return None, f"ssh unavailable ({type(e).__name__})"


def collect(args, now: datetime) -> dict:
    repo = args.repo
    raw_issues = gh_json(f"repos/{repo}/issues?state=open&labels={CLAIM_LABEL}&per_page=100") or []
    issues = [summarize_issue(i, now) for i in raw_issues if "pull_request" not in i]
    prs = [
        summarize_pr(p, now) for p in gh_json(f"repos/{repo}/pulls?state=open&per_page=100") or []
    ]
    files = {p["number"]: pr_files(repo, p["number"]) for p in prs}
    closed = (
        gh_json(f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50") or []
    )
    merged = [
        {
            "number": p["number"],
            "title": p["title"],
            "author": p["user"]["login"],
            "merged_at": p["merged_at"],
        }
        for p in closed
        if p.get("merged_at") and (hours_since(p["merged_at"], now) or 99) <= 24
    ]
    try:
        sha = gh_json(f"repos/{repo}/commits/main")["sha"]
    except Exception:
        sha = None
    data = {
        "now": now,
        "repo": repo,
        "main_sha": sha,
        "issues": issues,
        "prs": prs,
        "merged": merged,
        "overlaps": find_overlaps(files),
        "deploy": None,
        "deploy_note": "skipped (--no-ssh)",
        "sites": [],
    }
    data["stale"] = find_stale(issues, prs, args.stale_hours)
    if not args.no_ssh:
        data["deploy"], data["deploy_note"] = fetch_deploy()
    if not args.no_sites:
        data["sites"] = [check_site(u) for u in SITES]
    data["actions"] = next_actions(data)
    return data


def release_stale(repo: str, stale: list[dict], apply: bool, all_issues: list[dict]) -> list[str]:
    log = []
    by_num = {i["number"]: i for i in all_issues}
    for s in stale:
        iss = by_num.get(s["number"])
        if s["kind"] != "issue" or iss is None:
            continue
        msg = (
            "Released automatically: no activity for {:.0f} h (team_status.py). "
            "Re-claim with scripts/dev/claim.sh.".format(s["idle_h"])
        )
        steps = "remove label {}, remove assignees {}, comment".format(
            CLAIM_LABEL, ",".join(iss["assignees"]) or "-"
        )
        if not apply:
            log.append("[dry-run] #%d: would %s" % (s["number"], steps))
            continue
        base = "repos/%s/issues/%d" % (repo, s["number"])
        try:
            gh_mutate(["-X", "DELETE", base + "/labels/" + CLAIM_LABEL])
            if iss["assignees"]:
                gh_mutate(
                    [
                        "-X",
                        "DELETE",
                        base + "/assignees",
                        *functools.reduce(
                            operator.iadd,
                            (["-f", "assignees[]=" + a] for a in iss["assignees"]),
                            [],
                        ),
                    ]
                )
            gh_mutate(["-X", "POST", base + "/comments", "-f", "body=" + msg])
            log.append("#%d: released" % s["number"])
        except RuntimeError as e:
            log.append("#%d: release failed: %s" % (s["number"], e))
    return log


def send_telegram(text: str) -> bool:
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "ops", "notify", "notify.py"
    )
    spec = importlib.util.spec_from_file_location("roxira_notify", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return bool(mod.send(text))


def send_telegram_via_ssh(text: str, host: str) -> bool:
    """Send through notify.py on HOST (text on stdin); HOST holds the Telegram env. Never raises."""
    try:
        res = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=15",
                host,
                REMOTE_NOTIFY_CMD,
            ],
            input=text,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return res.returncode == 0
    except Exception:
        return False


def to_jsonable(data: dict) -> dict:
    d = dict(data)
    d["now"] = data["now"].isoformat()
    d["prs"] = [{k: v for k, v in p.items() if k != "body"} for p in data["prs"]]
    return d


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=os.environ.get("ROXIRA_REPO", DEFAULT_REPO))
    ap.add_argument("--out", help="also write the report to this file")
    ap.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    ap.add_argument("--telegram", action="store_true", help="send a short version via notify.py")
    ap.add_argument(
        "--telegram-host",
        default=os.environ.get("ROXIRA_NOTIFY_HOST") or None,
        metavar="HOST",
        help="send the short version by running notify.py on HOST over ssh "
        "(default: env ROXIRA_NOTIFY_HOST)",
    )
    ap.add_argument("--no-ssh", action="store_true", help="skip the prod autodeploy check")
    ap.add_argument("--no-sites", action="store_true", help="skip HTTP checks")
    ap.add_argument(
        "--stale-hours",
        type=float,
        default=None,
        help="override the stale threshold (default 2 h for agent/ branches, 24 h otherwise)",
    )
    ap.add_argument(
        "--release-stale",
        action="store_true",
        help="WRITES to GitHub: unclaim stale in-progress issues (default: only print the plan)",
    )
    args = ap.parse_args(argv)

    now = datetime.now(UTC)
    try:
        data = collect(args, now)
    except (RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f"team_status: cannot read GitHub: {e}", file=sys.stderr)
        return 1

    text = json.dumps(to_jsonable(data), indent=2) if args.json else render(data)
    stale_issues = [s for s in data["stale"] if s["kind"] == "issue"]
    plan = (
        release_stale(args.repo, stale_issues, args.release_stale, data["issues"])
        if stale_issues
        else []
    )
    if plan and not args.json:
        text += "\n## Release plan%s\n\n" % (
            "" if args.release_stale else " (dry run, pass --release-stale to apply)"
        )
        text += "\n".join("- " + p for p in plan) + "\n"
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    if args.telegram or args.telegram_host:
        short = render_short(data)
        ok = (
            send_telegram_via_ssh(short, args.telegram_host)
            if args.telegram_host
            else (send_telegram(short))
        )
        print(
            "telegram: %s" % ("sent" if ok else "not sent (not configured or failed)"),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
