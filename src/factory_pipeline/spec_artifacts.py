"""Validation and starter templates for factory spec artifacts."""

from pathlib import Path
import re


REQUIRED = ("spec.md", "plan.md", "tasks.md", "acceptance.md")


def check_dir(path: Path) -> list[str]:
    """Return validation problems for the spec artifacts in *path*."""
    problems: list[str] = []
    contents: dict[str, str] = {}
    for name in REQUIRED:
        artifact = path / name
        if not artifact.is_file():
            problems.append(f"missing file: {name}")
            continue
        content = artifact.read_text(encoding="utf-8")
        if not content.strip():
            problems.append(f"empty file: {name}")
            continue
        contents[name] = content

    acceptance = contents.get("acceptance.md", "")
    if acceptance and not any(
        line.startswith(("- [ ]", "- [x]")) for line in acceptance.splitlines()
    ):
        problems.append("acceptance.md has no checklist line")

    tasks = contents.get("tasks.md", "")
    if tasks and not any(
        line.startswith("- ")
        and re.search(r"owned:\s*[^\s,)]", line)
        for line in tasks.splitlines()
    ):
        problems.append("tasks.md has no task line with owned: path list")

    spec = contents.get("spec.md", "")
    if spec and not any(
        line.startswith("version:") for line in spec.splitlines()[:10]
    ):
        problems.append("spec.md has no version: line in its first 10 lines")
    return problems


def render_template(slug: str) -> dict[str, str]:
    """Return starter content for the four required artifacts."""
    return {
        "spec.md": f"# {slug}\n\nversion: 0.1.0\n\n## Purpose\n",
        "plan.md": f"# Plan: {slug}\n\n## Approach\n",
        "tasks.md": "# Tasks\n\n- Implement the change (owned: src/)\n",
        "acceptance.md": "# Acceptance\n\n- [ ] Acceptance criterion\n",
    }
