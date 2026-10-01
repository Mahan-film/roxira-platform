"""Tests for spec artifact validation and templates."""

from pathlib import Path

import pytest

from src.factory_pipeline.spec_artifacts import REQUIRED, check_dir, render_template


def write_valid(directory: Path) -> None:
    for name, content in render_template("example").items():
        (directory / name).write_text(content, encoding="utf-8")


def test_reports_missing_file(tmp_path: Path) -> None:
    assert check_dir(tmp_path) == [f"missing file: {name}" for name in REQUIRED]


def test_reports_empty_file(tmp_path: Path) -> None:
    write_valid(tmp_path)
    (tmp_path / "plan.md").write_text("  \n", encoding="utf-8")
    assert check_dir(tmp_path) == ["empty file: plan.md"]


@pytest.mark.parametrize(
    ("name", "content", "problem"),
    [
        ("acceptance.md", "# Acceptance\n", "acceptance.md has no checklist line"),
        (
            "tasks.md",
            "# Tasks\n\n- Implement it (owned:)\n",
            "tasks.md has no task line with owned: path list",
        ),
        (
            "spec.md",
            "# Spec\n\n## Purpose\n",
            "spec.md has no version: line in its first 10 lines",
        ),
    ],
)
def test_reports_missing_required_marker(
    tmp_path: Path, name: str, content: str, problem: str
) -> None:
    write_valid(tmp_path)
    (tmp_path / name).write_text(content, encoding="utf-8")
    assert check_dir(tmp_path) == [problem]


def test_accepts_valid_directory(tmp_path: Path) -> None:
    write_valid(tmp_path)
    assert check_dir(tmp_path) == []


def test_render_template_contains_all_required_markers() -> None:
    template = render_template("my-feature")
    assert tuple(template) == REQUIRED
    assert "version:" in template["spec.md"]
    assert "owned:" in template["tasks.md"]
    assert "- [ ]" in template["acceptance.md"]
