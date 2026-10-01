"""Focused policy tests using small, self-contained Compose documents."""

import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def policy():
    spec = importlib.util.spec_from_file_location(
        "compose_policy", Path(__file__).parents[2] / "scripts/ci/compose_policy.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("service", "expected"),
    [
        ({"privileged": True, "mem_limit": "1g"}, "privileged containers"),
        ({"volumes": ["/var/run/docker.sock:/var/run/docker.sock"], "mem_limit": "1g"}, "Docker socket"),
        ({"image": "postgres:latest", "mem_limit": "1g"}, "non-latest tag"),
        ({"image": "postgres", "mem_limit": "1g"}, "non-latest tag"),
        ({"image": "postgres:17"}, "memory limit"),
        ({"ports": ["8080:80"], "mem_limit": "1g"}, "published ports"),
        ({"network_mode": "host", "mem_limit": "1g"}, "host network"),
    ],
)
def test_each_policy_rule(policy, service, expected):
    findings = policy.check({"services": {"app": service}})
    assert any(expected in finding for finding in findings)


def test_clean_compose_is_allowed(policy):
    compose = {
        "services": {
            "nginx_gateway": {"image": "nginx:1.27", "mem_limit": "256m", "ports": ["80:80", "443:443"]},
            "app": {"image": "example/app:1.0", "deploy": {"resources": {"limits": {"memory": "512m"}}}, "ports": ["127.0.0.1:8080:8080"]},
        }
    }
    assert policy.check(compose) == []
