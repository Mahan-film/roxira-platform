"""Tests for semgrep custom rules in .semgrep/roxira.yml (Issue #1343 / LESSONS 6 & 8)."""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".semgrep/roxira.yml"


def _get_semgrep() -> str:
    found = shutil.which("semgrep")
    if found:
        return found
    venv_bin = Path(sys.executable).parent / "semgrep"
    if venv_bin.is_file():
        return str(venv_bin)
    return str(ROOT / ".venv/bin/semgrep")


@pytest.fixture(scope="module")
def semgrep_available():
    semgrep = _get_semgrep()
    if not (shutil.which("semgrep") or Path(semgrep).is_file()):
        pytest.skip("semgrep not installed in venv or PATH")


def run_semgrep(rule_id: str, code: str, ext: str = ".ts", path_prefix: str = "output_apps/enterprise_hub/") -> list[dict]:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir) / path_prefix
        tmp_path.mkdir(parents=True, exist_ok=True)
        rel_file = f"{path_prefix}sample{ext}"
        (Path(tmpdir) / rel_file).write_text(code, encoding="utf-8")

        res = subprocess.run(
            [
                _get_semgrep(),
                "scan",
                "--config",
                str(CONFIG),
                "--metrics=off",
                "--disable-version-check",
                "--json",
                rel_file,
            ],
            cwd=tmpdir,
            capture_output=True,
            text=True,
        )
        try:
            data = json.loads(res.stdout)
            return [r for r in data.get("results", []) if r.get("check_id", "").endswith(rule_id)]
        except json.JSONDecodeError:
            pytest.fail(f"Semgrep failed to produce JSON output: {res.stderr}\n{res.stdout}")


@pytest.mark.parametrize(
    "code",
    [
        "const a = Number(invoice.totalAmount);",
        "const b = parseFloat(item.price);",
        "const c = parseInt(feeAmount, 10);",
        "const d = +invoice.totalAmount;",
        "const e = invoice.totalAmount * 1.05;",
        "const f = invoice.totalAmount / 100.0;",
    ],
)
def test_money_as_number_violations(semgrep_available, code):
    findings = run_semgrep("enterprise-hub-money-as-number", code, ext=".ts")
    assert len(findings) >= 1, f"Expected violation for: {code}"


@pytest.mark.parametrize(
    "code",
    [
        "const a = Number(items.length);",
        "const b = parseInt(pageStr, 10);",
        "const c = +index;",
        "const count = items.length * 2;",
    ],
)
def test_money_as_number_allowed(semgrep_available, code):
    findings = run_semgrep("enterprise-hub-money-as-number", code, ext=".ts")
    assert len(findings) == 0, f"Expected no violation for: {code}"


@pytest.mark.parametrize(
    "code,ext",
    [
        ("this.logger.log(`Phone: ${phone}`);", ".ts"),
        ("logger.error(`User email: ${user.email}`);", ".ts"),
        ("console.warn(`National ID: ${nationalId}`);", ".ts"),
        ("this.logger.debug(`Token: ${token}`);", ".ts"),
        ("logger.info(f'User phone: {user_phone}')", ".py"),
        ("logger.error(f'Failed token: {auth_token}')", ".py"),
        ("logging.warning('User email: %s' % email)", ".py"),
    ],
)
def test_logger_pii_violations(semgrep_available, code, ext):
    findings = run_semgrep("logger-pii-interpolation", code, ext=ext, path_prefix="src/")
    assert len(findings) >= 1, f"Expected violation for: {code}"


@pytest.mark.parametrize(
    "code,ext",
    [
        ("this.logger.log(`User created: ${userId}`);", ".ts"),
        ("logger.info('System startup complete');", ".ts"),
        ("console.error('Database connection failed');", ".ts"),
        ("logger.info(f'Processed batch: {batch_id}')", ".py"),
        ("logging.info('Worker ready')", ".py"),
    ],
)
def test_logger_pii_allowed(semgrep_available, code, ext):
    findings = run_semgrep("logger-pii-interpolation", code, ext=ext, path_prefix="src/")
    assert len(findings) == 0, f"Expected no violation for: {code}"
