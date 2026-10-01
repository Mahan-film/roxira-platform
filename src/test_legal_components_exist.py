def test_legal_components_exist():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "output_apps/enterprise_hub/frontend/src"
    provenance = (root / "components/legal/legal-provenance-card.tsx").read_text()
    result_state = (root / "components/legal/legal-result-state.tsx").read_text()
    content = provenance + result_state

    assert "LegalProvenanceCard" in content
    assert "LegalResultState" in content
    assert "noopener noreferrer" in content
    assert "مشاهده منبع رسمی" in content
    assert "flex-row-reverse" not in content
