#!/usr/bin/env python3
"""Readiness report for the box lane stack: what must be true before `orch.py tick --apply` (read-only, stdlib only).

  python3 lane_readiness.py [--offline] [--conf FILE] [--repo-dir DIR] [--repo OWNER/NAME] [--json]

It is a DRY-RUN tool by construction: it never calls a model (the only gateway requests are GET /health/liveliness and
GET /v1/models, which list names), never writes to GitHub (only `gh api` GETs), never starts or stops a unit, never
prints the gateway key (it is read from gateway.env, sent only to the loopback URL, and never echoed).

Each check prints PASS, FAIL, WARN or UNKNOWN with the command that verifies it by hand. Exit code: 0 when nothing
FAILs, 1 otherwise (UNKNOWN and WARN need a human look but do not fail the run). Items marked [owner] need an owner
decision or a root step that this script cannot do.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_DIR = HERE.parents[3]
sys.path.insert(0, str(REPO_DIR / "scripts/infra/server_agents"))

BLOCKERS = {1092: "gateway health: agent groups fail health, health.sh crash", 1165: "fix PR for #1092 (key pool health + paid fallback)"}
BOX_KEY = "box-lanes"
KEY_USD_CAP = 1.0


@dataclass
class Item:
    key: str
    title: str
    status: str  # PASS FAIL WARN UNKNOWN
    detail: str = ""
    verify: str = ""
    owner: bool = False


@dataclass
class Report:
    items: list[Item] = field(default_factory=list)

    def add(self, *a, **k) -> None:
        self.items.append(Item(*a, **k))

    @property
    def failed(self) -> bool:
        return any(i.status == "FAIL" for i in self.items)


def parse_conf(path: Path) -> dict[str, str]:
    """KEY=VALUE lines, last wins, never evaluated (same rules as lane-run)."""
    out: dict[str, str] = {}
    try:
        for ln in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Z_]+)=(.*)$", ln)
            if m:
                out[m.group(1)] = m.group(2).strip().strip("\"'")
    except OSError:
        pass
    return out


def key_pool_box_key(repo_dir: Path) -> dict:
    """{'models': [...], 'max_budget_usd': float} of the virtual key box-lanes, parsed without a YAML library."""
    lines = (repo_dir / "config/key_pool.yaml").read_text(encoding="utf-8").splitlines()
    start = next((i for i, ln in enumerate(lines) if re.match(rf"^\s{{4}}{BOX_KEY}:\s*$", ln)), None)
    if start is None:
        return {}
    out: dict = {}
    for ln in lines[start + 1:start + 8]:
        if re.match(r"^\s{4}\S", ln):
            break
        m = re.match(r"^\s+models:\s*\[(.*)\]", ln)
        if m:
            out["models"] = [x.strip() for x in m.group(1).split(",") if x.strip()]
        m = re.match(r"^\s+max_budget_usd:\s*([0-9.]+)", ln)
        if m:
            out["max_budget_usd"] = float(m.group(1))
    return out


def run(cmd: list[str], timeout: int = 25, env: dict | None = None) -> tuple[int, str]:
    env = dict(env or os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")  # `systemctl --user` from a non-login shell
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, str(exc)
    return p.returncode, (p.stdout + p.stderr).strip()


def read_key(gateway_env: Path) -> str:
    try:
        for ln in gateway_env.read_text(encoding="utf-8").splitlines():
            if ln.startswith("KEYPOOL_MASTER_KEY="):
                return ln.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def http_get(url: str, key: str = "", timeout: int = 8) -> tuple[int, str]:
    if not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/", url):
        raise ValueError("loopback gateway URLs only")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"} if key else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (loopback only, checked above)
            return r.status, r.read(1_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        return 0, str(exc)


# ---------------------------------------------------------------- checks
def check_blockers(rep: Report, repo: str, offline: bool) -> None:
    for num, why in BLOCKERS.items():
        title = f"#{num} ({why})"
        cmd = f"gh api repos/{repo}/issues/{num} --jq '.state + \" merged=\" + ((.pull_request.merged_at // \"no\")|tostring)'"
        if offline:
            rep.add(f"blocker-{num}", title, "UNKNOWN", "offline run", cmd)
            continue
        rc, out = run(["gh", "api", f"repos/{repo}/issues/{num}", "--jq", ".state"])
        if rc != 0:
            rep.add(f"blocker-{num}", title, "UNKNOWN", "gh not available or not logged in", cmd)
            continue
        state = out.strip().lower()
        if num == 1165:
            rc2, merged = run(["gh", "api", f"repos/{repo}/pulls/{num}", "--jq", ".merged_at"])
            ok = rc2 == 0 and merged.strip() not in ("", "null")
            rep.add(f"blocker-{num}", title, "PASS" if ok else "FAIL", f"state={state} merged={'yes' if ok else 'no'}", cmd)
        else:
            rep.add(f"blocker-{num}", title, "PASS" if state == "closed" else "FAIL", f"state={state}", cmd)
    rep.add("deployed", "merged does not mean live: gateway config rendered on the server [owner]", "WARN",
            "closing #1092 needs the owner's `install.sh --apply` on the server; verify through the tunnel (next checks)",
            "scripts/infra/key_pool/health.sh  (on the server, as the owner)", owner=True)


def check_key_spec(rep: Report, repo_dir: Path) -> dict:
    spec = key_pool_box_key(repo_dir)
    want = {"agent-free", "agent-light-free", "agent-strong-free", "agent-free-paid"}
    cmd = f"grep -n -A4 '{BOX_KEY}:' {repo_dir}/config/key_pool.yaml"
    if not spec:
        rep.add("key-spec", f"virtual key {BOX_KEY} defined in config/key_pool.yaml", "FAIL", "entry not found", cmd)
        return {}
    models, cap = set(spec.get("models", [])), spec.get("max_budget_usd", 0.0)
    bad = []
    if models != want:
        bad.append(f"models {sorted(models)} != {sorted(want)}")
    if not 0 < cap <= KEY_USD_CAP:
        bad.append(f"max_budget_usd {cap} not in (0, {KEY_USD_CAP}]")
    rep.add("key-spec", f"box key spec: agent groups only, paid cap <= {KEY_USD_CAP} USD/day", "FAIL" if bad else "PASS",
            "; ".join(bad) or f"models={sorted(models)} cap={cap}", cmd)
    return spec


def check_live_key(rep: Report, conf: dict, spec: dict, offline: bool) -> None:
    url = conf.get("GATEWAY_URL", "http://127.0.0.1:4181/v1").rstrip("/")
    root = url[:-3] if url.endswith("/v1") else url
    envf = Path(conf.get("GATEWAY_ENV") or Path.home() / ".config/roxira-lane/gateway.env")
    cmd = f"curl -s {root}/health/liveliness ; curl -s -H \"Authorization: Bearer $(grep ^KEYPOOL_MASTER_KEY= {envf} | cut -d= -f2-)\" {url}/models | python3 -m json.tool | grep '\"id\"'"
    if offline:
        rep.add("live-key", "live gateway: tunnel up and key lists exactly the 4 agent groups", "UNKNOWN", "offline run", cmd)
        return
    code, body = http_get(f"{root}/health/liveliness")
    if code != 200:
        rep.add("live-key", "live gateway: tunnel up and key lists exactly the 4 agent groups", "UNKNOWN",
                "tunnel/gateway not reachable (systemctl --user status roxira-gateway-tunnel)", cmd)
        return
    key = read_key(envf)
    if not key:
        rep.add("live-key", "live gateway key lists the agent groups", "FAIL", f"no KEYPOOL_MASTER_KEY in {envf}", cmd)
        return
    code, body = http_get(f"{url}/models", key)
    if code != 200:
        rep.add("live-key", "live gateway key lists the agent groups", "FAIL", f"GET /v1/models returned {code}", cmd)
        return
    try:
        ids = {m["id"] for m in json.loads(body).get("data", [])}
    except (ValueError, KeyError, TypeError, AttributeError):
        rep.add("live-key", "live gateway key lists the agent groups", "FAIL", "unparsable /v1/models answer", cmd)
        return
    want = set(spec.get("models", [])) or {"agent-free", "agent-light-free", "agent-strong-free", "agent-free-paid"}
    extra, missing = sorted(ids - want), sorted(want - ids)
    ok = not extra and not missing
    rep.add("live-key", "live gateway: key lists exactly the box groups (names only, no model call)", "PASS" if ok else "FAIL",
            f"groups={sorted(ids)}" + (f" extra={extra}" if extra else "") + (f" missing={missing}" if missing else ""), cmd)


def check_ladder(rep: Report, repo_dir: Path, spec: dict) -> dict:
    import lane_policy as lp

    cmd = f"ROXIRA_LANE_POLICY={repo_dir}/config/box_lane_policy.json python3 {repo_dir}/scripts/infra/server_agents/orch.py tick   # dry run, prints 'ladder:'"
    pol_file = Path(os.environ.get(lp.POLICY_ENV) or repo_dir / "config/box_lane_policy.json")
    try:
        pol = lp.load(pol_file)
    except lp.PolicyError as exc:
        rep.add("ladder", "box ladder resolves to groups the key allows", "FAIL", str(exc), cmd)
        return {}
    steps = lp.ladder(pol) or []
    groups = lp.ladder_groups(steps)
    allowed = set(spec.get("models", []))
    bad = [f"{s}->{g or 'direct provider'}" for s, g in groups.items() if g is None or (allowed and g not in allowed)]
    rep.add("ladder", "box ladder resolves only to groups the box key allows", "FAIL" if (bad or not steps) else "PASS",
            f"ladder={','.join(steps)} groups={[g for g in groups.values()]}" + (f" NOT ALLOWED: {bad}" if bad else ""), cmd)
    active = bool(os.environ.get(lp.POLICY_ENV))
    rep.add("ladder-env", "ROXIRA_LANE_POLICY is set in the environment that runs orch/taskq (unit or shell) [owner]",
            "PASS" if active else "WARN",
            "set in this shell" if active else "not set in this shell: the unit that runs orch must set it, or the default ladder "
            "(best,free,ds-flash,strong) is used and burns refusals",
            f"systemctl --user cat roxira-orch.service | grep ROXIRA_LANE_POLICY   (unit not installed yet)", owner=True)
    return pol


def check_scopes(rep: Report, repo_dir: Path, pol: dict) -> None:
    import lane_policy as lp

    cmd = f"python3 -c \"import sys; sys.path.insert(0,'{repo_dir}/scripts/infra/server_agents'); import lane_policy as p; pol=p.load('{repo_dir}/config/box_lane_policy.json'); [print(l, p.check_scopes(p.lane_scopes(l,pol,{{}}),pol,'{repo_dir}')) for l in ('L5','L6','L7')]\""
    if not pol:
        rep.add("scopes", "lane scopes pass the deny-list", "FAIL", "no policy loaded", cmd)
        return
    bad = {}
    for lane in ("L5", "L6", "L7"):
        problems = lp.check_scopes(lp.lane_scopes(lane, pol), pol, repo_dir)
        if problems:
            bad[lane] = problems[:2]
    rep.add("scopes", "default scopes of L5-L7 pass the deny-list and require_scope is on", "FAIL" if bad or not pol.get("require_scope") else "PASS",
            str(bad) if bad else "all three lanes clean", cmd)
    envs = [k for k in os.environ if k.startswith("ORCH_SCOPE_")]
    rep.add("scopes-env", "no ORCH_SCOPE_* override in this shell widens the table", "WARN" if envs else "PASS",
            f"overrides set: {envs} (they are checked against the deny-list, but review them)" if envs else "none", "env | grep ORCH_SCOPE_")


def check_lane_run(rep: Report, repo_dir: Path, conf: dict, conf_path: Path) -> None:
    # the installed command first (usually a symlink in ~/.local/bin): that is what the timer runs
    lr = Path(shutil.which("lane-run") or repo_dir / "scripts/ops/ci_box/lane_runner/lane-run")
    cmd = f"lane-run --budget --lane L5   # caps must be non-zero; zero means NO cap"
    for lane, fix in (("l5", 12), ("l6", 12), ("l7", 12), ("smoke", 5)):
        rc, out = run([str(lr), "--budget", "--lane", lane], env={**os.environ, "LANE_RUN_CONF": str(conf_path)})
        try:
            caps = json.loads(out.splitlines()[-1])["caps"]
        except (ValueError, KeyError, IndexError):
            rep.add(f"caps-{lane}", f"lane-run daily caps for {lane}", "FAIL", f"cannot read caps: {out[-160:]}", cmd)
            continue
        zero = [k for k in ("attempts_per_day", "usd_per_day") if not caps.get(k)]
        rep.add(f"caps-{lane}", f"lane-run daily caps for {lane} are loaded (0 = no cap)", "FAIL" if zero else "PASS", f"caps={caps}", cmd)
    group, tier = conf.get("MODEL_GROUP", ""), conf.get("TIER", "")
    ok = group in ("", "agent-light-free", "agent-strong-free", "agent-free-paid", "agent-free")
    rep.add("lane-conf", "lane-run.conf names an allowed agent group", "PASS" if ok else "FAIL", f"TIER={tier or '-'} MODEL_GROUP={group or '-'}",
            f"grep -v '^#' {conf_path}")
    budgets = json.loads((repo_dir / "scripts/ops/ci_box/lane_runner/lane_budgets.box.json").read_text())
    usd = sum(float(budgets["lanes"][ln].get("usd_per_day", 0)) for ln in ("l5", "l6", "l7"))
    rep.add("usd-caps", f"sum of lane USD caps ({usd:g}) vs the key's {KEY_USD_CAP:g} USD/day", "PASS" if usd <= KEY_USD_CAP else "WARN",
            "the server-side key cap binds first; lane caps only stop a lane earlier" if usd > KEY_USD_CAP else "within the key cap",
            f"cat {repo_dir}/scripts/ops/ci_box/lane_runner/lane_budgets.box.json")


def check_switches(rep: Report, offline: bool) -> None:
    state = Path(os.environ.get("ROXIRA_AGENTS_HOME") or Path.home() / ".local/state/roxira-lane")
    kill = Path(os.environ.get("ORCH_KILL_FILE") or state / "orch" / "KILL")
    stop = state / "STOP"
    rep.add("switch-files", "kill switches are in a known state (KILL/STOP files)", "PASS",
            f"orch KILL {'SET' if kill.exists() else 'off'}, lane STOP {'SET' if stop.exists() else 'off'} "
            "(SET is fine before the flip: remove deliberately when you go live)", "ls -l <state>/orch/KILL <state>/STOP  (see docs/ops/BOX_KILL_SWITCHES.md)")
    if offline:
        return
    ucmd = "systemctl --user is-enabled roxira-lane-taskq.timer; systemctl --user is-active roxira-gateway-tunnel"
    rc, out = run(["systemctl", "--user", "is-enabled", "roxira-lane-taskq.timer"])
    if "Failed to connect" in out:
        rep.add("taskq-timer", "user systemd reachable (queue timer and orch timer state)", "UNKNOWN", "no user bus in this shell", ucmd)
        return
    rep.add("taskq-timer", "queue timer is NOT enabled yet (enable only after the flip checklist is green)", "PASS" if out.strip() == "disabled" else "WARN",
            f"roxira-lane-taskq.timer is {out.strip() or 'unknown'}", ucmd)
    rc, out = run(["systemctl", "--user", "is-enabled", "roxira-orch.timer"])
    rep.add("orch-timer", "no orch timer installed or enabled", "PASS" if "not-found" in out or out.strip() == "disabled" else "WARN",
            f"roxira-orch.timer: {out.strip() or 'unknown'}", "systemctl --user cat roxira-orch.timer")
    gate = Path.home() / ".config/roxira-merge-gate/merge_gate.toml"
    try:
        dry = re.search(r"^dry_run\s*=\s*(\w+)", gate.read_text(), re.M)
        rep.add("merge-gate", "merge gate dry_run state is a conscious choice [owner]", "WARN",
                f"dry_run = {dry.group(1) if dry else 'unset'} (true = it merges nothing)", f"grep -n '^dry_run' {gate}", owner=True)
    except OSError:
        rep.add("merge-gate", "merge gate config readable", "UNKNOWN", "config not found for this user", f"ls {gate}")


def check_private(rep: Report, repo: str, offline: bool) -> None:
    cmd = f"gh api repos/{repo} --jq .private"
    if offline:
        rep.add("private", "repo visibility (the lanes' scope policy applies from the private flip) [owner]", "UNKNOWN", "offline run", cmd, owner=True)
        return
    rc, out = run(["gh", "api", f"repos/{repo}", "--jq", ".private"])
    rep.add("private", "repo visibility (the scope policy applies from the private flip) [owner]", "UNKNOWN" if rc else "WARN",
            "gh unavailable" if rc else f"private={out.strip()} (flip is the owner's call; see docs/ops/PRIVATE_FLIP_CHECKLIST.md)", cmd, owner=True)


def build(args: argparse.Namespace) -> Report:
    repo_dir = Path(args.repo_dir).resolve()
    conf_path = Path(args.conf or os.environ.get("LANE_RUN_CONF") or Path.home() / ".config/roxira-lane/lane-run.conf")
    conf = parse_conf(conf_path)
    rep = Report()
    check_blockers(rep, args.repo, args.offline)
    spec = check_key_spec(rep, repo_dir)
    check_live_key(rep, conf, spec, args.offline)
    pol = check_ladder(rep, repo_dir, spec)
    check_scopes(rep, repo_dir, pol)
    check_lane_run(rep, repo_dir, conf, conf_path)
    check_switches(rep, args.offline)
    check_private(rep, args.repo, args.offline)
    return rep


def render(rep: Report) -> str:
    lines = ["Box lane readiness (read-only; no model call; no key printed)", ""]
    for i in rep.items:
        lines.append(f"[{i.status:<7}] {i.title}" + ("  [owner]" if i.owner and "[owner]" not in i.title else ""))
        if i.detail:
            lines.append(f"           {i.detail}")
        if i.verify:
            lines.append(f"           verify: {i.verify}")
    counts = {s: sum(1 for i in rep.items if i.status == s) for s in ("PASS", "FAIL", "WARN", "UNKNOWN")}
    lines += ["", "summary: " + ", ".join(f"{n} {s}" for s, n in counts.items()),
              "NOT READY for `orch.py tick --apply`: fix every FAIL, then resolve WARN/UNKNOWN by hand." if rep.failed or counts["UNKNOWN"] or counts["WARN"]
              else "Checks green. `--apply` is still the owner's decision; nothing here enables it."]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--offline", action="store_true", help="no network, gh or systemctl calls")
    ap.add_argument("--conf", help="lane-run.conf (default: $LANE_RUN_CONF or ~/.config/roxira-lane/lane-run.conf)")
    ap.add_argument("--repo-dir", default=str(REPO_DIR))
    ap.add_argument("--repo", default=None, help="OWNER/NAME (default: orch.repo(), env ORCH_REPO)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if not args.repo:
        import orch

        args.repo = orch.repo()
    rep = build(args)
    if args.json:
        print(json.dumps([i.__dict__ for i in rep.items], indent=1))
    else:
        print(render(rep))
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
