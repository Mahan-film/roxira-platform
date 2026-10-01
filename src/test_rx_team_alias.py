from pathlib import Path


def test_team_alias_uses_omniroute_combo() -> None:
    contents = (Path(__file__).resolve().parents[1] / "scripts/dev/rx").read_text()
    assert "omniroute/team-coding" in contents
    assert "omniroute.env" in contents


def test_team_is_not_a_default_chain_worker() -> None:
    contents = (Path(__file__).resolve().parents[1] / "scripts/dev/rx").read_text()
    chain_line = next(line for line in contents.splitlines() if "chain=(" in line)
    assert "team" not in chain_line
