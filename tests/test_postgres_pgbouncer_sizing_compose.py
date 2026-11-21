"""Tests for PostgreSQL and PgBouncer sizing configuration (T214 / #928)."""

import pathlib
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_pgbouncer_prod_sizing() -> None:
    compose_path = REPO_ROOT / "docker-compose.prod.yml"
    assert compose_path.is_file(), "docker-compose.prod.yml missing"

    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    assert "pgbouncer_prod" in services, "pgbouncer_prod missing"

    pgb = services["pgbouncer_prod"]
    env = pgb.get("environment", [])
    env_dict = {}
    for item in env:
        if isinstance(item, str) and "=" in item:
            k, v = item.split("=", 1)
            env_dict[k.strip()] = v.strip()

    assert env_dict.get("DEFAULT_POOL_SIZE") == "40", (
        f"expected DEFAULT_POOL_SIZE=40, got {env_dict.get('DEFAULT_POOL_SIZE')}"
    )
    assert env_dict.get("MAX_DB_CONNECTIONS") == "60", (
        f"expected MAX_DB_CONNECTIONS=60, got {env_dict.get('MAX_DB_CONNECTIONS')}"
    )
    assert env_dict.get("POOL_MODE") == "transaction"


def test_postgres_prod_sizing() -> None:
    compose_path = REPO_ROOT / "docker-compose.prod.yml"
    assert compose_path.is_file(), "docker-compose.prod.yml missing"

    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    assert "postgres_prod" in services, "postgres_prod missing"

    pg = services["postgres_prod"]
    command = pg.get("command", "")
    assert "shared_buffers=256MB" in command, "expected shared_buffers=256MB"
    assert "effective_cache_size=512MB" in command, "expected effective_cache_size=512MB"
    assert "work_mem=4MB" in command, "expected work_mem=4MB"
    assert "maintenance_work_mem=64MB" in command, "expected maintenance_work_mem=64MB"
    assert "max_connections=100" in command, "expected max_connections=100"


def test_stress_benchmark_max_db_connections_default() -> None:
    script_path = REPO_ROOT / "scripts" / "stress_benchmark.py"
    assert script_path.is_file()
    content = script_path.read_text(encoding="utf-8")
    assert 'int(os.getenv("PGBOUNCER_MAX_DB_CONNECTIONS", "60"))' in content
