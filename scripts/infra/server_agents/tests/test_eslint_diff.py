"""eslint_diff tests: new-error-only comparison. No docker, no network."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import eslint_diff  # noqa: E402


def msg(rule, severity=2):
    return {"ruleId": rule, "severity": severity, "message": rule}


def doc(*files):
    return [{"filePath": p, "messages": list(m)} for p, m in files]


def test_no_errors_no_new():
    new, pre = eslint_diff.compare(doc(("/work/a.tsx", [])), doc(("/work/a.tsx", [])))
    assert new == [] and pre == 0
    assert eslint_diff.report(new, pre) == "no new errors (0 pre-existing)"


def test_pre_existing_errors_do_not_fail():
    base = doc(("/work/a.tsx", [msg("react-hooks/rules-of-hooks")]))
    cur = doc(("/work/a.tsx", [msg("react-hooks/rules-of-hooks")]))
    new, pre = eslint_diff.compare(cur, base)
    assert new == [] and pre == 1
    assert eslint_diff.report(new, pre) == "no new errors (1 pre-existing)"


def test_same_rule_more_errors_is_new():
    base = doc(("/work/a.tsx", [msg("no-unused-vars")]))
    cur = doc(("/work/a.tsx", [msg("no-unused-vars"), msg("no-unused-vars")]))
    new, pre = eslint_diff.compare(cur, base)
    assert new == [("a.tsx", "no-unused-vars", 1)] and pre == 1
    assert eslint_diff.report(new, pre) == "new errors: a.tsx:no-unused-vars x 1"


def test_different_rule_is_new():
    base = doc(("/work/a.tsx", [msg("old-rule")]))
    cur = doc(("/work/a.tsx", [msg("old-rule"), msg("new-rule")]))
    new, pre = eslint_diff.compare(cur, base)
    assert new == [("a.tsx", "new-rule", 1)] and pre == 1


def test_new_file_all_errors_are_new():
    cur = doc(("/work/new.tsx", [msg("r1"), msg("r2")]))
    base = doc()
    new, pre = eslint_diff.compare(cur, base)
    assert new == [("new.tsx", "r1", 1), ("new.tsx", "r2", 1)] and pre == 0


def test_warnings_ignored():
    cur = doc(("/work/a.tsx", [msg("r", severity=1)]))
    new, pre = eslint_diff.compare(cur, doc())
    assert new == [] and pre == 0


def test_fixed_errors_not_pre_existing():
    base = doc(("/work/a.tsx", [msg("r"), msg("r")]))
    cur = doc(("/work/a.tsx", [msg("r")]))
    new, pre = eslint_diff.compare(cur, base)
    assert new == [] and pre == 1


def test_missing_rule_id_bucketed():
    cur = doc(("/work/a.tsx", [{"severity": 2, "message": "boom"}]))
    new, _ = eslint_diff.compare(cur, doc())
    assert new == [("a.tsx", "(unknown)", 1)]


def test_cli_new_errors(tmp_path, capsys):
    cur = tmp_path / "cur.json"
    cur.write_text(json.dumps(doc(("/work/a.tsx", [msg("r")]))))
    base = tmp_path / "base.json"
    base.write_text(json.dumps(doc()))
    assert eslint_diff.main(["eslint_diff.py", str(cur), str(base)]) == 1
    assert capsys.readouterr().out.strip() == "new errors: a.tsx:r x 1"


def test_cli_preexisting_exit_zero(tmp_path, capsys):
    b = doc(("/work/a.tsx", [msg("r")]))
    report = tmp_path / "r.json"
    report.write_text(json.dumps(b))
    assert eslint_diff.main(["eslint_diff.py", str(report), str(report)]) == 0
    assert capsys.readouterr().out.strip() == "no new errors (1 pre-existing)"


def test_cli_bad_args():
    assert eslint_diff.main(["eslint_diff.py"]) == 2
