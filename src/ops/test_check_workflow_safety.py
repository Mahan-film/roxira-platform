import importlib.util
from pathlib import Path
from typing import List

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/check_workflow_safety.py"
BASELINE = ROOT / "scripts/ci/workflow_safety_baseline.txt"


@pytest.fixture
def module():
    spec = importlib.util.spec_from_file_location("check_workflow_safety", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def checker(module):
    return module.WorkflowSafetyChecker()


@pytest.fixture
def temp_workflow(tmp_path: Path) -> Path:
    return tmp_path / "test_workflow.yml"


def test_pull_request_target_with_untrusted_checkout(checker, temp_workflow: Path):
    temp_workflow.write_text("""
on:
  pull_request_target:
permissions: {}
jobs:
  test_job:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
""")
    findings = checker.check_workflow(temp_workflow)
    assert len(findings) == 1
    assert "pwn-request" in findings[0]

    # baseline suppression
    checker.baseline_findings.add(findings[0])
    assert checker.check_workflow(temp_workflow) == []

    # safe case
    temp_workflow.write_text("""
on:
  pull_request_target:
permissions: {}
jobs:
  test_job:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: 'main'
""")
    assert checker.check_workflow(temp_workflow) == []


def test_unquoted_on_key_is_detected(checker, temp_workflow: Path):
    temp_workflow.write_text("""
on: pull_request_target
permissions: {}
jobs:
  j:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
""")
    assert any("pwn-request" in f for f in checker.check_workflow(temp_workflow))


def test_missing_permissions(checker, temp_workflow: Path):
    temp_workflow.write_text("""
jobs:
  test_job:
    steps:
      - run: echo 'Hello'
""")
    findings = checker.check_workflow(temp_workflow)
    assert len(findings) == 1
    assert "missing-permissions" in findings[0]

    checker.baseline_findings.add(findings[0])
    assert checker.check_workflow(temp_workflow) == []

    temp_workflow.write_text("""
permissions:
  contents: read
jobs:
  test_job:
    steps:
      - run: echo 'Hello'
""")
    assert checker.check_workflow(temp_workflow) == []

    temp_workflow.write_text("""
jobs:
  test_job:
    permissions:
      contents: read
    steps:
      - run: echo 'Hello'
""")
    assert checker.check_workflow(temp_workflow) == []


def test_script_injection(checker, temp_workflow: Path):
    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - run: echo ${{ github.event.pull_request.title }}
""")
    findings = checker.check_workflow(temp_workflow)
    assert len(findings) == 1
    assert "script-injection" in findings[0]

    checker.baseline_findings.add(findings[0])
    assert checker.check_workflow(temp_workflow) == []

    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - run: echo "$TITLE"
        env:
          TITLE: ${{ github.event.pull_request.title }}
""")
    assert checker.check_workflow(temp_workflow) == []


def test_gh_without_repo(checker, temp_workflow: Path):
    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - run: gh pr view 1
""")
    findings = checker.check_workflow(temp_workflow)
    assert len(findings) == 1
    assert "gh-without-repo" in findings[0]

    checker.baseline_findings.add(findings[0])
    assert checker.check_workflow(temp_workflow) == []

    # safe: --repo
    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - run: gh pr list --repo ${{ github.repository }}
""")
    assert checker.check_workflow(temp_workflow) == []

    # safe: GH_REPO env
    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - run: gh pr view 1
        env:
          GH_REPO: ${{ github.repository }}
""")
    assert checker.check_workflow(temp_workflow) == []

    # safe: checkout provides the git remote
    temp_workflow.write_text("""
permissions: {}
jobs:
  test_job:
    steps:
      - uses: actions/checkout@v4
      - run: gh pr list
""")
    assert checker.check_workflow(temp_workflow) == []


def test_current_workflows_zero_findings(module):
    checker = module.WorkflowSafetyChecker(str(BASELINE))
    findings: List[str] = checker.check_directory(ROOT / ".github/workflows")
    assert len(findings) == 0, f"Current workflows have non-baseline findings: {findings}"
