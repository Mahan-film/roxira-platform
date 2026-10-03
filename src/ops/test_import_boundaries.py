"""Focused tests for the product import-boundary checker (tmp_path only)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/ci/check_import_boundaries.py"


@pytest.fixture
def boundaries():
    """Load the checker without importing it at collection time."""
    spec = importlib.util.spec_from_file_location("check_import_boundaries", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CONFIG = {
    "scan_roots": ["output_apps", "src"],
    "import_roots": [".", "output_apps/generated_modules", "output_apps/ecosystem_core/src"],
    "products": {
        "smart_judge": {"paths": ["output_apps/generated_modules/smartjudge"], "exclude": []},
        "roxira": {"paths": ["output_apps/ecosystem_core/src/accounting"], "exclude": []},
        "core": {"paths": ["output_apps/ecosystem_core/src/auth"], "exclude": []},
    },
    "restricted_pairs": [["smart_judge", "roxira"], ["roxira", "smart_judge"]],
    "allowed_edges": [],
}

SJ = "output_apps/generated_modules/smartjudge"
RX = "output_apps/ecosystem_core/src/accounting"
CORE = "output_apps/ecosystem_core/src/auth"


def _write(repo: Path, rel: str, text: str = "") -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _config(**overrides):
    return {**json.loads(json.dumps(CONFIG)), **overrides}


def _repo(tmp_path: Path) -> Path:
    _write(tmp_path, f"{SJ}/engine.py")
    _write(tmp_path, f"{RX}/ledger.py")
    _write(tmp_path, f"{CORE}/login.py")
    return tmp_path


def test_product_of_longest_prefix_and_exclude(boundaries):
    products = {
        "a": {"paths": ["x"], "exclude": ["x/frontend"]},
        "b": {"paths": ["x/deep"], "exclude": []},
    }
    assert boundaries.product_of("x/mod.py", products) == "a"
    assert boundaries.product_of("x/frontend/app.py", products) is None
    assert boundaries.product_of("x/deep/mod.py", products) == "b"
    assert boundaries.product_of("xx/mod.py", products) is None


def test_new_cross_edge_detected(boundaries, tmp_path):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", f"from {SJ.replace('/', '.')} import engine\n")
    found, new, stale = boundaries.evaluate(repo, _config())
    assert [(e["from"], e["to"]) for e in new] == [(f"{RX}/ledger.py", f"{SJ}/engine.py")]
    assert found == new and stale == []


def test_baselined_edge_passes_and_stale_reported(boundaries, tmp_path):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", f"import {SJ.replace('/', '.')}.engine\n")
    allowed = [
        {"from": f"{RX}/ledger.py", "to": f"{SJ}/engine.py"},
        {"from": f"{RX}/gone.py", "to": f"{SJ}/engine.py"},
    ]
    found, new, stale = boundaries.evaluate(repo, _config(allowed_edges=allowed))
    assert len(found) == 1 and new == []
    assert [e["from"] for e in stale] == [f"{RX}/gone.py"]


def test_core_and_same_product_edges_ignored(boundaries, tmp_path):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", "from output_apps.ecosystem_core.src.auth import login\n")
    _write(repo, f"{SJ}/engine.py", "from . import helper\n")
    _write(repo, f"{SJ}/helper.py")
    _write(repo, f"{CORE}/login.py", f"import {SJ.replace('/', '.')}.engine\n")
    found, new, _ = boundaries.evaluate(repo, _config())
    assert found == [] and new == []


def test_relative_import_crossing_boundary(boundaries, tmp_path):
    repo = _repo(tmp_path)
    cfg = _config(
        scan_roots=["pkg"],
        products={
            "smart_judge": {"paths": ["pkg/sj"], "exclude": []},
            "roxira": {"paths": ["pkg/rx"], "exclude": []},
        },
    )
    _write(repo, "pkg/sj/a.py")
    _write(repo, "pkg/rx/b.py", "from ..sj import a\n")
    _, new, _ = boundaries.evaluate(repo, cfg)
    assert [(e["from"], e["to"]) for e in new] == [("pkg/rx/b.py", "pkg/sj/a.py")]


def test_path_literal_dynamic_import_detected(boundaries, tmp_path):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", f'mod = dynamic_import("x", "{SJ}/engine.py")\n')
    _, new, _ = boundaries.evaluate(repo, _config())
    assert len(new) == 1


def test_syntax_error_file_skipped(boundaries, tmp_path):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", "def broken(:\n")
    assert boundaries.evaluate(repo, _config()) == ([], [], [])


def test_main_exit_codes_and_write_baseline(boundaries, tmp_path, capsys):
    repo = _repo(tmp_path)
    _write(repo, f"{RX}/ledger.py", f"from {SJ.replace('/', '.')} import engine\n")
    cfg_path = repo / "config/import_boundaries.json"
    _write(repo, "config/import_boundaries.json", json.dumps(CONFIG))
    args = ["--repo", str(repo), "--config", str(cfg_path)]
    assert boundaries.main(args) == 1
    assert "NEW" in capsys.readouterr().out
    assert boundaries.main([*args, "--write-baseline"]) == 0
    assert len(json.loads(cfg_path.read_text())["allowed_edges"]) == 1
    assert boundaries.main(args) == 0
    assert "OK" in capsys.readouterr().out
