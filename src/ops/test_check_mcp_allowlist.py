"""Focused tests for the MCP allowlist checker (issue #334)."""

import importlib.util
import json
from pathlib import Path

import pytest
import yaml


@pytest.fixture
def checker():
    spec = importlib.util.spec_from_file_location(
        "check_mcp_allowlist",
        Path(__file__).parents[2] / "scripts/ci/check_mcp_allowlist.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_inputs(tmp_path: Path, servers: dict, entries: list) -> list[str]:
    config = tmp_path / ".mcp.json"
    allowlist = tmp_path / "mcp_allowlist.yaml"
    config.write_text(json.dumps({"mcpServers": servers}), encoding="utf-8")
    allowlist.write_text(yaml.safe_dump({"servers": entries}), encoding="utf-8")
    return ["--config", str(config), "--allowlist", str(allowlist)]


def _entry(**overrides) -> dict:
    entry = {
        "name": "context7",
        "owner": "platform",
        "transport": "http",
        "data_class": "public",
        "scopes": ["docs:read"],
        "network": ["mcp.context7.com"],
        "expires": "2999-01-01",
    }
    entry.update(overrides)
    return entry


def test_allowlisted_server_passes(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http", "url": "https://mcp.context7.com/mcp"}}
    assert checker.main(_write_inputs(tmp_path, servers, [_entry()])) == 0
    assert "OK" in capsys.readouterr().out


def test_stdio_with_no_network_passes(checker, tmp_path):
    servers = {"local": {"type": "stdio", "command": "radar-mcp"}}
    entry = _entry(name="local", transport="stdio", network="none")
    assert checker.main(_write_inputs(tmp_path, servers, [entry])) == 0


def test_configured_server_must_be_allowlisted(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http"}, "rogue": {"type": "stdio"}}
    assert checker.main(_write_inputs(tmp_path, servers, [_entry()])) == 1
    out = capsys.readouterr().out
    assert "rogue" in out and "not allowlisted" in out


def test_expired_entry_fails(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http"}}
    args = _write_inputs(tmp_path, servers, [_entry(expires="2000-01-01")])
    assert checker.main(args) == 1
    assert "expired" in capsys.readouterr().out


def test_unknown_transport_fails(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http"}}
    args = _write_inputs(tmp_path, servers, [_entry(transport="grpc")])
    assert checker.main(args) == 1
    assert "unknown transport" in capsys.readouterr().out


def test_unknown_data_class_fails(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http"}}
    args = _write_inputs(tmp_path, servers, [_entry(data_class="secret")])
    assert checker.main(args) == 1
    assert "unknown data_class" in capsys.readouterr().out


def test_http_without_network_host_fails(checker, tmp_path, capsys):
    servers = {"context7": {"type": "http"}}
    args = _write_inputs(tmp_path, servers, [_entry(network=[])])
    assert checker.main(args) == 1
    assert "network" in capsys.readouterr().out


def test_report_only_always_exits_zero(checker, tmp_path, capsys):
    servers = {"rogue": {"type": "stdio"}}
    args = _write_inputs(tmp_path, servers, []) + ["--report-only"]
    assert checker.main(args) == 0
    assert "rogue" in capsys.readouterr().out
