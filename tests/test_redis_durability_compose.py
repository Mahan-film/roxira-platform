"""Tests for Redis durability, AOF, memory limits, and DB segregation (T217 / #931)."""

import os
import pathlib
import sys
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))


def test_compose_prod_redis_durability() -> None:
    compose_path = REPO_ROOT / "docker-compose.prod.yml"
    assert compose_path.is_file(), "docker-compose.prod.yml missing"

    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    assert "redis_prod" in services, "redis_prod service missing"

    redis = services["redis_prod"]
    command = redis.get("command", "")
    assert "--appendonly yes" in command, "AOF appendonly yes must be configured"
    assert "--appendfsync everysec" in command, "appendfsync everysec must be configured"
    assert "--maxmemory 200mb" in command, "maxmemory 200mb must be configured"
    assert "--maxmemory-policy noeviction" in command, "maxmemory-policy noeviction must be configured"
    assert redis.get("mem_limit") == "256m", "container mem_limit must be 256m"
    assert redis.get("oom_score_adj") == -500, "oom_score_adj must protect Redis"


def test_smartjudge_chat_auth_redis_cache_db(monkeypatch) -> None:
    from output_apps.generated_modules.smartjudge import chat_auth

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("REDIS_PORT", "6379")
    monkeypatch.delenv("REDIS_CACHE_DB", raising=False)
    monkeypatch.delenv("REDIS_CACHE_HOST", raising=False)
    monkeypatch.delenv("REDIS_CACHE_PORT", raising=False)

    url = chat_auth._redis_url()
    assert url == "redis://127.0.0.1:6379/1", f"expected cache DB 1, got {url}"

    monkeypatch.setenv("REDIS_CACHE_DB", "2")
    monkeypatch.setenv("REDIS_CACHE_HOST", "redis-cache")
    monkeypatch.setenv("REDIS_CACHE_PORT", "6380")
    url = chat_auth._redis_url()
    assert url == "redis://redis-cache:6380/2"


def test_smartjudge_llm_router_redis_cache_db(monkeypatch) -> None:
    from output_apps.generated_modules.smartjudge import llm_router

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("REDIS_HOST", "127.0.0.1")
    monkeypatch.setenv("REDIS_PORT", "6379")
    monkeypatch.delenv("REDIS_CACHE_DB", raising=False)
    monkeypatch.delenv("REDIS_CACHE_HOST", raising=False)
    monkeypatch.delenv("REDIS_CACHE_PORT", raising=False)

    url = llm_router._redis_url()
    assert url == "redis://127.0.0.1:6379/1", f"expected cache DB 1, got {url}"
