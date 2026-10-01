from pathlib import Path

import yaml


def test_research_stack_compose_configuration() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    compose_path = repo_root / "docker/research-stack/docker-compose.yml"
    settings_path = repo_root / "docker/research-stack/searxng/settings.yml"

    compose_text = compose_path.read_text()
    compose = yaml.safe_load(compose_text)
    settings = yaml.safe_load(settings_path.read_text())

    assert {"searxng", "valkey", "crawl4ai"} <= compose["services"].keys()
    assert compose["services"]["searxng"]["ports"][0].startswith("127.0.0.1:")
    assert compose["services"]["crawl4ai"]["ports"][0].startswith("127.0.0.1:")
    assert "ports" not in compose["services"]["valkey"]
    assert compose["services"]["crawl4ai"]["mem_limit"] == "1536m"
    assert compose["services"]["crawl4ai"]["cpus"] == 1.0
    assert compose["services"]["crawl4ai"]["pids_limit"] == 256
    assert compose["services"]["crawl4ai"]["shm_size"] == "1gb"
    assert compose["services"]["crawl4ai"]["image"] == "unclecode/crawl4ai:0.9.4"
    assert "SEARXNG_SECRET" in compose_text
    assert ":?" in compose_text
    assert "SEARXNG_SECRET:-" not in compose_text
    assert "SEARXNG_SECRET-" not in compose_text
    assert "json" in settings["search"]["formats"]
    assert settings["server"]["limiter"] is True
