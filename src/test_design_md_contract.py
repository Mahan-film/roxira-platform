from pathlib import Path


def test_design_md_contains_required_contract_sections() -> None:
    design_document = (
        Path(__file__).resolve().parents[1]
        / "output_apps/enterprise_hub/frontend/DESIGN.md"
    ).read_text(encoding="utf-8")

    for required_text in ("Personality", "RTL rules", "Anti-patterns", "Vazirmatn"):
        assert required_text in design_document
