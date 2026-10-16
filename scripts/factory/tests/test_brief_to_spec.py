"""Offline tests for scripts/factory/brief_to_spec.py and the bot's spec callbacks."""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[2] / "ops" / "notify"))

import brief_to_spec as b  # noqa: E402
import control_bot  # noqa: E402

SPEC = """# Spec
## Problem & customer
x
## Task list
### T1: Create schema
- Scope: apps/api, db/
- Acceptance: pytest tests/test_schema.py
### T2: Landing page
- Scope: `apps/web`
- Acceptance: curl -f localhost:3000
## Open questions
- none
"""


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(b, "HOME", str(tmp_path))
    return tmp_path


def _new(tmp_path, brief="Build a thing {x}\nvisibility: public\n", slug="demo"):
    f = tmp_path / "brief.txt"
    f.write_text(brief)
    assert b.cmd_new(str(f), slug) == 0


def test_questions_embed_brief():
    qs = b.build_questions("My brief {with braces}")
    assert set(qs) == {"market", "tech", "compliance"}
    assert all("My brief {with braces}" in q for q in qs.values())


def test_parse_tasks():
    tasks = b.parse_tasks(SPEC)
    assert [t["id"] for t in tasks] == ["T1", "T2"]
    assert tasks[0]["scope"] == ["apps/api", "db/"]
    assert tasks[1]["scope"] == ["apps/web"]
    assert tasks[0]["acceptance"].startswith("pytest")
    assert b.parse_tasks("no section") == []


@pytest.mark.parametrize("slug,ok", [("a-1", True), ("A", False), ("a_b", False), ("", False),
                                     ("x" * 41, False), ("a\n", False), ("../x", False)])
def test_slug_validation(slug, ok):
    assert b.valid_slug(slug) is ok


def test_visibility_and_models():
    assert b.visibility("visibility: Private") == "private"
    assert b.spec_models("visibility: private") == ["private"]
    assert b.spec_models("hello")[0] == "agent-strong-free"


def test_state_transitions_and_research_failure_recorded(home):
    _new(home)
    assert b.load_state("demo")["status"] == "researching"

    def post(url, payload, headers, timeout):
        if "competitors" in payload["query"]:
            return {"report_markdown": "# R", "sources": ["http://s"], "costs": {}}
        raise OSError("down")

    assert b.cmd_research("demo", post=post, token="t") == 2
    st = b.load_state("demo")
    assert st["status"] == "researched"
    assert st["research"]["market"] == "ok" and st["research"]["tech"].startswith("failed")
    assert (home / "projects/demo/research/market.md").exists()


def test_spec_propose_approve_without_repo(home):
    _new(home)

    def post(url, payload, headers, timeout):
        content = SPEC if "spec.md" in payload["messages"][0]["content"] else "خلاصه"
        return {"choices": [{"message": {"content": content}}]}

    assert b.cmd_spec("demo", post=post, key="k") == 0
    assert b.load_state("demo")["task_count"] == 2
    sent = []
    assert b.cmd_propose("demo", send=lambda t, buttons=None: sent.append(buttons) or True) == 0
    assert sent[0] == [("✅ تأیید", "spec:approve:demo"), ("❌ رد", "spec:reject:demo")]
    assert b.load_state("demo")["status"] == "awaiting_approval"
    calls = []
    assert b.cmd_approve("demo", run=lambda *a, **k: calls.append(a)) == 0
    assert calls == [] and b.load_state("demo")["status"] == "approved"
    assert (home / "projects/demo/tasks/t1.md").exists()


def test_approve_enqueues_with_repo_and_public_flag(home):
    _new(home)
    (home / "projects/demo/spec.md").write_text(SPEC)
    st = b.load_state("demo")
    st["repo_dir"] = "/srv/repo"
    b.save_state("demo", st)
    cmds = []

    class R:
        returncode = 0

    b.cmd_approve("demo", run=lambda cmd, **k: cmds.append(cmd) or R())
    assert len(cmds) == 2 and "--public" in cmds[0]
    assert b.load_state("demo")["queued"] == 2
    # unspecified/private briefs are never public
    _new(home, brief="plain", slug="p2")
    (home / "projects/p2/spec.md").write_text(SPEC)
    st = b.load_state("p2")
    st["repo_dir"] = "/r"
    b.save_state("p2", st)
    cmds.clear()
    b.cmd_approve("p2", run=lambda cmd, **k: cmds.append(cmd) or R())
    assert "--public" not in cmds[0]


def test_reject(home):
    _new(home)
    b.cmd_reject("demo")
    assert b.load_state("demo")["status"] == "rejected"


# ------------------------------------------------------------- bot routing
def _bot(tmp_path, runner):
    sent = []
    bot = control_bot.Bot(
        token="t", chat_id="555", api="https://x",
        http=lambda url, payload, timeout=10: sent.append((url.rsplit("/", 1)[-1], payload)) or {},
        paths={"freeze": tmp_path / "f", "autodeploy_last": tmp_path / "a",
               "offset": tmp_path / "o", "repo": "/opt/roxira_platform"},
        runner=runner, log=lambda _m: None,
    )
    return bot, sent


def _cb(data, chat=555):
    return {"callback_query": {"id": "1", "data": data, "message": {"chat": {"id": chat}}}}


def test_bot_spec_callback_runs_fixed_argv(tmp_path):
    calls = []
    bot, sent = _bot(tmp_path, lambda cmd, timeout=15: calls.append(cmd) or (0, ""))
    bot.handle_update(_cb("spec:approve:my-app"))
    assert calls[0][1:] == ["/opt/roxira_platform/scripts/factory/brief_to_spec.py", "approve", "my-app"]
    bot.handle_update(_cb("spec:reject:my-app"))
    assert calls[1][-2:] == ["reject", "my-app"]


@pytest.mark.parametrize("data", ["spec:approve:Bad Slug", "spec:approve:a;rm", "spec:nuke:x",
                                  "spec:approve:", "spec:approve:x:y", "spec:approve:a\n"])
def test_bot_spec_callback_rejects_bad_input(tmp_path, data):
    calls = []
    bot, _ = _bot(tmp_path, lambda cmd, timeout=15: calls.append(cmd) or (0, ""))
    bot.handle_update(_cb(data))
    assert calls == []


def test_bot_spec_callback_other_chat_ignored(tmp_path):
    calls = []
    bot, _ = _bot(tmp_path, lambda cmd, timeout=15: calls.append(cmd) or (0, ""))
    bot.handle_update(_cb("spec:approve:x", chat=999))
    assert calls == []


def test_json_state_is_valid(home):
    _new(home)
    json.loads((home / "projects/demo/state.json").read_text())


def test_second_approve_is_a_no_op(home, capsys):
    pdir = b.project_dir("dup-test")
    pathlib.Path(pdir).mkdir(parents=True, exist_ok=True)
    pathlib.Path(pdir, "state.json").write_text(json.dumps({"status": "approved"}))
    calls = []
    assert b.cmd_approve("dup-test", run=lambda *a, **k: calls.append(a)) == 0
    assert calls == [] and "already approved" in capsys.readouterr().out


def test_degenerate_detects_loops():
    assert b.degenerate("برای " + "وکلا " * 20)
    assert not b.degenerate("یک خلاصهٔ کوتاه و عادی برای مالک با چند جملهٔ متفاوت.")


def test_spec_ok_requires_sections_and_tasks():
    tasks = "".join(f"### T{i}: t{i}\nScope: docs/\nAcceptance: ok\n\n" for i in range(1, 6))
    good = "## Options\nx\n## Recommendation\ny\n## Task list\n" + tasks + "## Kill criteria\nz\n"
    assert b.spec_ok(good)
    assert not b.spec_ok(good.replace("## Kill criteria", "## Other"))
