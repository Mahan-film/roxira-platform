import pytest

from output_apps.generated_modules.smartjudge import jurisdiction_rules


def test_rules_file_loads_with_unique_ids_and_expected_peace_court_threshold():
    rules = jurisdiction_rules.load_rules()

    assert len({rule["id"] for rule in rules}) == len(rules)
    peace_court_rule = next(rule for rule in rules if rule["id"] == "peace_court_monetary")
    assert peace_court_rule["threshold_rials"] == 1000000000


def test_confirmed_rules_contains_only_confirmed_entries():
    confirmed = jurisdiction_rules.confirmed_rules()

    assert confirmed
    assert all(rule["status"] == "confirmed" for rule in confirmed)


@pytest.mark.parametrize(
    "contents",
    [
        """rules:
  - {id: duplicate, forum: forum, matter: matter, threshold_rials: null, legal_basis: basis, source_url: null, status: confirmed, note: note}
  - {id: duplicate, forum: forum, matter: matter, threshold_rials: null, legal_basis: basis, source_url: null, status: confirmed, note: note}
""",
        """rules:
  - {id: invalid-status, forum: forum, matter: matter, threshold_rials: null, legal_basis: basis, source_url: null, status: pending, note: note}
""",
    ],
)
def test_invalid_rule_yaml_raises_value_error(tmp_path, contents):
    rules_path = tmp_path / "rules.yaml"
    rules_path.write_text(contents, encoding="utf-8")

    with pytest.raises(ValueError):
        jurisdiction_rules.load_rules(rules_path)
