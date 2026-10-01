from src.automation.project_brief import run_project_brief


def test_project_brief_selects_requested_layers(monkeypatch, tmp_path):
    monkeypatch.setenv("ROXIRA_OFFLINE_TEST", "1")

    result = run_project_brief(
        "test idea",
        out_path=tmp_path / "b.md",
        offline=True,
        layers=["ui_ux", "frontend"],
    )
    assert [layer["layer"] for layer in result["layers"]] == ["ui_ux", "frontend"]

    try:
        run_project_brief("test idea", offline=True, layers=["nope"])
    except ValueError as exc:
        assert str(exc) == "unknown layer: nope"
    else:
        raise AssertionError("unknown layers must raise ValueError")

    all_layers = run_project_brief(
        "test idea", out_path=tmp_path / "all.md", offline=True, layers=None
    )
    assert len(all_layers["layers"]) == 9
