"""Unit tests for check_main_push.py. gh and Telegram are fakes; no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import check_main_push as cmp_  # noqa: E402
import merge_gate as mg  # noqa: E402

A, B, C = "a" * 40, "b" * 40, "c" * 40
CFG = {"repo": "o/r", "base": "main"}


class FakeApi:
    def __init__(self, head, commits=(), merged=(), compare_fails=False):
        self.head, self.commits, self.merged, self.compare_fails = head, commits, set(merged), compare_fails

    def __call__(self, method, path, fields=None, paginate=False):
        if path.endswith("/commits/main"):
            return {"sha": self.head}
        if "/compare/" in path:
            if self.compare_fails:
                raise mg.GhError("404 not found")
            return {"commits": [{"sha": s} for s in self.commits]}
        sha = path.split("/commits/")[1].split("/")[0]
        return [{"merged_at": "2026-11-21T00:00:00Z"}] if sha in self.merged else []


class Sent(list):
    def __call__(self, text):
        self.append(text)
        return True


def run(tmp_path, api, dry=False, last=A):
    if last:
        (tmp_path / cmp_.STATE_FILE).write_text(last + "\n")
    sent = Sent()
    return cmp_.check(CFG, api, tmp_path, dry, sent), sent


def test_first_run_initialises_state_without_alert(tmp_path):
    sent = Sent()
    assert cmp_.check(CFG, FakeApi(B), tmp_path, False, sent) == 0
    assert (tmp_path / cmp_.STATE_FILE).read_text().strip() == B and not sent


def test_unchanged_main_is_quiet(tmp_path):
    rc, sent = run(tmp_path, FakeApi(A))
    assert rc == 0 and not sent


def test_all_commits_from_merged_prs_is_ok_and_advances_state(tmp_path):
    rc, sent = run(tmp_path, FakeApi(C, commits=[B, C], merged=[B, C]))
    assert rc == 0 and not sent
    assert (tmp_path / cmp_.STATE_FILE).read_text().strip() == C


def test_direct_push_alerts_once_and_names_only_the_direct_commit(tmp_path):
    rc, sent = run(tmp_path, FakeApi(C, commits=[B, C], merged=[B]))
    assert rc == 1 and len(sent) == 1
    assert C[:8] in sent[0] and B[:8] not in sent[0] and "Direct push" in sent[0]
    # state advanced: the next tick does not alert again
    sent2 = Sent()
    assert cmp_.check(CFG, FakeApi(C), tmp_path, False, sent2) == 0 and not sent2


def test_dry_run_sends_nothing_and_writes_no_state(tmp_path):
    rc, sent = run(tmp_path, FakeApi(C, commits=[C]), dry=True)
    assert rc == 1 and not sent
    assert (tmp_path / cmp_.STATE_FILE).read_text().strip() == A


def test_dry_run_first_run_writes_no_state(tmp_path):
    assert cmp_.check(CFG, FakeApi(B), tmp_path, True, Sent()) == 0
    assert not (tmp_path / cmp_.STATE_FILE).exists()


def test_failed_compare_is_treated_as_rewritten_history(tmp_path):
    rc, sent = run(tmp_path, FakeApi(C, compare_fails=True))
    assert rc == 1 and len(sent) == 1 and "rewritten" in sent[0]


def test_alert_never_contains_token(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTIFY_BOT_TOKEN", "123456:SECRETTOKEN")
    rc, sent = run(tmp_path, FakeApi(C, commits=[C]))
    assert "SECRETTOKEN" not in sent[0]


def test_kill_switch_stops_the_run(tmp_path):
    cfgfile = tmp_path / "c.toml"
    cfgfile.write_text(f'state_dir = "{tmp_path}"\n')
    (tmp_path / "KILL").write_text("")
    assert cmp_.main(["--config", str(cfgfile)]) == 0
    assert not (tmp_path / cmp_.STATE_FILE).exists()
