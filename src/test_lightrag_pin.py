from pathlib import Path


def test_dockerfile_pins_lightrag_and_openai() -> None:
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile.prod"
    contents = dockerfile.read_text()

    assert "lightrag-hku==1.5.7" in contents
    assert "openai==3.22.1" in contents
