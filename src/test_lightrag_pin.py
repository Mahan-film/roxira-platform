from pathlib import Path


def test_dockerfile_pins_lightrag_and_openai() -> None:
    root = Path(__file__).resolve().parents[1]
    dockerfile = root / "Dockerfile.prod"
    contents = dockerfile.read_text()

    assert "lightrag-hku==1.5.7" in contents
    assert "openai==3.51.0" in contents
    assert "FROM python:3.13-slim AS builder" in contents
    assert "FROM python:3.13-slim" in contents

    pyproject = (root / "pyproject.toml").read_text()
    assert "openai==3.51.0" in pyproject
