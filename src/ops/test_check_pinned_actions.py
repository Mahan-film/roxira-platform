import importlib.util
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/check_pinned_actions.py"


@pytest.fixture
def module():
    spec = importlib.util.spec_from_file_location("check_pinned_actions", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def temp_workflow(tmp_path: Path) -> Path:
    return tmp_path / "workflow.yml"


def test_fails_on_unpinned_action(module, temp_workflow: Path):
    temp_workflow.write_text("""
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
""")
    errors = module.check_workflow(temp_workflow)
    assert any("unpinned action" in e for e in errors)


def test_fails_on_missing_version_comment(module, temp_workflow: Path):
    temp_workflow.write_text("""
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
""")
    errors = module.check_workflow(temp_workflow)
    assert any("missing version comment" in e for e in errors)


def test_fails_on_missing_top_level_permissions(module, temp_workflow: Path):
    temp_workflow.write_text("""
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
""")
    errors = module.check_workflow(temp_workflow)
    assert any("missing top-level permissions" in e for e in errors)


def test_fails_on_permissive_top_level_permissions(module, temp_workflow: Path):
    temp_workflow.write_text("""
permissions:
  contents: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
""")
    errors = module.check_workflow(temp_workflow)
    assert any("top-level permissions must strictly be 'contents: read'" in e for e in errors)


def test_fails_on_unsafe_pull_request_target_checkout(module, temp_workflow: Path):
    temp_workflow.write_text("""
on:
  pull_request_target:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
""")
    errors = module.check_workflow(temp_workflow)
    assert any("pull_request_target workflow checks out untrusted PR head" in e for e in errors)


def test_passes_on_hardened_workflow(module, temp_workflow: Path):
    temp_workflow.write_text("""
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: main
      - uses: actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0 # v7.1.0
      - uses: ./local-action
""")
    errors = module.check_workflow(temp_workflow)
    assert errors == []


def test_all_current_workflows_pass(module):
    workflows = sorted((ROOT / ".github/workflows").glob("*.yml"))
    assert len(workflows) >= 4
    for wf in workflows:
        errors = module.check_workflow(wf)
        assert errors == [], f"Workflow {wf.name} failed hardening check: {errors}"
