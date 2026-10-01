def test_globals_define_semantic_status_tokens():
    from pathlib import Path

    css_path = (
        Path(__file__).resolve().parents[1]
        / "output_apps/enterprise_hub/frontend/src/app/globals.css"
    )
    css = css_path.read_text(encoding="utf-8")

    for name in ("success", "warning", "info", "confidence"):
        assert css.count(f"--{name}:") >= 2
        assert css.count(f"--color-{name}:") == 1
