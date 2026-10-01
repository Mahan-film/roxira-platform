def test_check_reports_missing_status_and_secret(tmp_path):
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parents[1] / "scripts" / "check_agent_docs.py"
    spec = importlib.util.spec_from_file_location("check_agent_docs", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    docs = tmp_path / "docs"
    decisions = docs / "decisions"
    decisions.mkdir(parents=True)
    (decisions / "missing-status.md").write_text("# ADR\n\nNo status\n", encoding="utf-8")
    (decisions / "has-status.md").write_text("# ADR\nStatus: accepted\n", encoding="utf-8")
    (docs / "STATE.md").write_text("state\n", encoding="utf-8")
    (docs / "SYSTEM_MAP.md").write_text("map\n", encoding="utf-8")
    (docs / "notes.md").write_text("sk-" + "a" * 24, encoding="utf-8")

    assert module.check(tmp_path) == [
        "docs/decisions/missing-status.md: missing Status: in first 6 lines",
        "docs/notes.md: possible secret matches sk-[A-Za-z0-9]{20,}",
    ]
