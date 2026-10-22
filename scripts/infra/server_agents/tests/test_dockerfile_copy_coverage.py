"""dockerfile_copy_coverage tests: a fixture tree, no docker and no network.

Reproduces incident #807: app.module.ts imports a top-level dir (mcp/) that the
backend Dockerfile never COPYed, so the image built but every deploy failed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dockerfile_copy_coverage as dcc  # noqa: E402

APP_MODULE = (
    "import { Module } from '@nestjs/common';\n"
    "import { A } from './modules/a/a.module';\n"
    "import { Mcp } from './mcp/mcp.module';\n"
    "import { G } from './security/global-guards';\n"
)
DOCKERFILE_OK = (
    "FROM node:20-alpine AS deps\n"
    "COPY package.json package-lock.json ./\n"
    "FROM node:20-alpine AS builder\n"
    "COPY main.ts app.module.ts ./\n"
    "COPY modules ./modules\n"
    "COPY security ./security\n"
    "COPY mcp ./mcp\n"
)


def make_hub(tmp_path: Path, dockerfile: str, app_module: str = APP_MODULE) -> Path:
    hub = tmp_path / "output_apps" / "enterprise_hub"
    for d in ("modules/a", "mcp", "security"):
        (hub / d).mkdir(parents=True, exist_ok=True)
    (hub / "modules/a/a.module.ts").write_text("export const a = 1;\n")
    (hub / "mcp/mcp.module.ts").write_text("export const m = 1;\n")
    (hub / "security/global-guards.ts").write_text("export const g = 1;\n")
    (hub / "app.module.ts").write_text(app_module)
    (hub / "Dockerfile").write_text(dockerfile)
    return hub


def test_missing_mcp_is_reported(tmp_path):
    dockerfile = DOCKERFILE_OK.replace("COPY mcp ./mcp\n", "")
    assert dcc.missing_copies(make_hub(tmp_path, dockerfile)) == ["mcp"]


def test_all_imported_dirs_copied(tmp_path):
    assert dcc.missing_copies(make_hub(tmp_path, DOCKERFILE_OK)) == []


def test_copy_of_whole_context_covers_everything(tmp_path):
    dockerfile = "FROM node:20-alpine AS builder\nCOPY . .\nRUN npm run build\n"
    assert dcc.missing_copies(make_hub(tmp_path, dockerfile)) == []


def test_copy_from_stage_is_not_counted(tmp_path):
    dockerfile = DOCKERFILE_OK.replace("COPY mcp ./mcp\n", "COPY --from=deps /app/mcp ./mcp\n")
    assert dcc.missing_copies(make_hub(tmp_path, dockerfile)) == ["mcp"]


def test_directory_without_ts_is_ignored(tmp_path):
    hub = make_hub(tmp_path, DOCKERFILE_OK)
    (hub / "config").mkdir()
    (hub / "config/data.json").write_text("{}")
    (hub / "app.module.ts").write_text(APP_MODULE + "import './config/data';\n")
    assert dcc.missing_copies(hub) == []


def test_single_file_import_is_not_a_directory(tmp_path):
    hub = make_hub(tmp_path, DOCKERFILE_OK)
    (hub / "app.module.ts").write_text(APP_MODULE + "import './main';\n")
    assert dcc.missing_copies(hub) == []


def test_trailing_slash_copy_is_matched(tmp_path):
    dockerfile = DOCKERFILE_OK.replace("COPY mcp ./mcp\n", "COPY mcp/ ./mcp\n")
    assert dcc.missing_copies(make_hub(tmp_path, dockerfile)) == []


def test_import_parsing_ignores_packages(tmp_path):
    dirs = dcc.relative_import_dirs("import { Module } from '@nestjs/common';\nimport x from './a/b';\n")
    assert dirs == {"a"}


def test_cli_exit_codes(tmp_path, capsys, monkeypatch):
    dockerfile = DOCKERFILE_OK.replace("COPY mcp ./mcp\n", "")
    hub = make_hub(tmp_path, dockerfile)
    assert dcc.main([str(hub)]) == 1
    assert "missing COPY for: mcp" in capsys.readouterr().out
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.chdir(empty)  # no output_apps tree here -> nothing to check, not a failure
    assert dcc.main([]) == 0
    assert dcc.main(["a", "b"]) == 2
