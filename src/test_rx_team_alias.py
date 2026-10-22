from pathlib import Path


def test_team_alias_uses_omniroute_combo() -> None:
    contents = (Path(__file__).resolve().parents[1] / "scripts/dev/rx").read_text()
    assert "omniroute/team-coding" in contents
    assert "omniroute.env" in contents


def test_team_is_the_last_fallback_and_codex_is_opt_in() -> None:
    # #563: dsflash first, then codestral, then OmniRoute team; codex only when requested.
    contents = (Path(__file__).resolve().parents[1] / "scripts/dev/rx").read_text()
    chain_line = next(line for line in contents.splitlines() if "chain=(" in line)
    workers = chain_line.split("(", 1)[1].split(")", 1)[0].split()
    assert workers[0] == "dsflash"
    assert workers[-1] == "team"
    assert "codex" not in workers
