import re
from pathlib import Path


def test_roxira_fullstack_backend_template_is_valid() -> None:
    from src.factory_pipeline import template_check

    root = Path("templates/roxira-fullstack")
    assert template_check.check_project(root) == []


def test_repository_methods_are_tenant_scoped() -> None:
    text = Path(
        "templates/roxira-fullstack/backend/src/items/items.repository.ts"
    ).read_text(encoding="utf-8")
    signatures = re.findall(r"^\s{2}async\s+(\w+)\s*\(([^)]*)\)", text, re.MULTILINE)

    assert signatures, "no repository methods found"
    for name, params in signatures:
        first = params.split(",")[0].strip()
        assert first.startswith("tenantId"), f"{name} is not tenant-scoped: {first!r}"
