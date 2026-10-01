from pathlib import Path


def test_roxira_static_rtl_template_is_valid() -> None:
    import yaml

    from src.factory_pipeline import template_check

    root = Path("templates/roxira-static-rtl")
    assert not template_check.check_project(root)
    manifest = yaml.safe_load((root / "factory.yaml").read_text())
    assert {"name", "stack", "locale", "rtl", "allowed_paths", "owned_by", "deploy"} <= manifest.keys()
