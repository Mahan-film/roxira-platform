"""Offline tests for scripts/gen_system_inventory.py (pure parsing helpers)."""

import importlib.util
from pathlib import Path

import pytest

gen = None  # populated by the fixture before any test runs (no import-time code)


@pytest.fixture(scope="module", autouse=True)
def _load_generator():
    global gen
    if gen is None:
        path = Path(__file__).resolve().parent.parent / "scripts" / "gen_system_inventory.py"
        spec = importlib.util.spec_from_file_location("gen_system_inventory", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        gen = module


def test_parse_compose_ports_image_env():
    text = (
        "services:\n"
        "  b:\n    image: redis:7\n    ports: ['127.0.0.1:6379:6379']\n"
        "  a:\n    build: .\n    environment:\n      - X=${SECRET_A:?x}\n      - PLAIN=1\n"
    )
    r = gen.parse_compose(text)
    assert list(sorted(r)) == ["a", "b"]
    assert r["b"]["image"] == "redis:7"
    assert r["b"]["ports"] == ["127.0.0.1:6379:6379"]
    assert r["a"]["image"] == "build"
    assert {"SECRET_A", "X", "PLAIN"} <= set(r["a"]["env"])


def test_parse_server_names():
    text = "server { server_name b.ir www.b.ir; }\nserver { server_name a.ir b.ir; }"
    assert gen.parse_server_names(text) == ["a.ir", "b.ir", "www.b.ir"]


def test_parse_workflow_triggers():
    text = "name: X\non:\n  push:\n  schedule:\n    - cron: '0 6 * * *'\n"
    assert gen.parse_workflow(text) == ("X", ["push", "schedule"])
    assert gen.parse_workflow("name: Y\non: [pull_request, push]\n") == ("Y", ["pull_request", "push"])


def test_parse_package_versions():
    text = '{"name": "p", "dependencies": {"next": "16.3.4", "zod": "1"}, "devDependencies": {"typescript": "^5"}}'
    name, vers = gen.parse_package_versions(text, ["next", "typescript", "react"])
    assert name == "p"
    assert vers == {"next": "16.3.4", "typescript": "^5"}


def test_parse_python_deps_and_versions():
    text = 'requires-python = ">=3.13"\n"httpx>=0.28.1",\nRUN pip install fastapi uvicorn\n'
    deps = gen.parse_python_deps(text, ["httpx", "fastapi", "qdrant-client"])
    assert deps == {"httpx": ">=0.28.1", "fastapi": "(unpinned)"}
    assert gen.parse_requires_python(text) == ">=3.13"
    assert gen.parse_dockerfile_python("FROM python:3.11-slim\n") == "3.11-slim"


def test_parse_model_roles():
    text = "roles:\n  cheap:\n    models:\n      - id: a/b\n      - id: c/d\n  free:\n    models: []\n"
    assert gen.parse_model_roles(text) == {"cheap": ["a/b", "c/d"], "free": []}
