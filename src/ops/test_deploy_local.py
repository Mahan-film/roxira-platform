"""Offline tests for scripts/ops/deploy_local.sh (no ssh, no network)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path



def script_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts/ops/deploy_local.sh"


def test_script_exists_with_bash_shebang() -> None:
    path = script_path()
    assert path.is_file()
    assert path.read_text(encoding="utf-8").startswith("#!/usr/bin/env bash")


def test_script_passes_bash_syntax_check() -> None:
    result = subprocess.run(["bash", "-n", str(script_path())], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_script_refuses_without_subcommand() -> None:
    result = subprocess.run(
        ["bash", str(script_path())], capture_output=True, text=True, timeout=20
    )
    assert result.returncode != 0
    assert "Usage" in result.stderr


def test_script_text_has_no_password_or_foreign_ip() -> None:
    text = script_path().read_text(encoding="utf-8")
    assert "password" not in text.lower()
    ips = set(re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text))
    assert ips <= {"127.0.0.1"}  # host comes from the ROXIRA_HOST ssh alias, never a literal IP


def test_rollback_dry_run_proves_no_execution(tmp_path: Path) -> None:
    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True)
    (state_dir / "prev_commit").write_text("abcdef1234567890\n", encoding="utf-8")
    (state_dir / "services").write_text("roxira_enterprise_backend\n", encoding="utf-8")

    import os
    env = {
        **os.environ,
        "DEPLOY_SSH_HOST": "local",
        "DEPLOY_STATE_DIR": str(state_dir),
    }
    result = subprocess.run(
        ["bash", str(script_path()), "rollback"],
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    assert result.returncode == 0
    assert "dry-run: pass --yes to roll back" in (result.stdout + result.stderr)
    assert "rolled back to" not in (result.stdout + result.stderr)


def test_smoke_test_definition_includes_erp_backend_and_tenant_checks() -> None:
    text = script_path().read_text(encoding="utf-8")
    assert "BACKEND_HEALTH_PATH" in text
    assert "/api/backend/health/system" in text
    assert "SMOKE_TENANT_ROUTE" in text
    assert "/api/backend/tenants/me" in text
    assert "SMOKE_AUTH_TOKEN" in text
    assert "http_code_auth" in text
    assert "smoke test FAILED; rolling back automatically" in text


def test_smoke_test_fails_and_rolls_back_when_erp_unhealthy(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True)
    fake_curl = bin_dir / "curl"
    fake_curl.write_text(
        """#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *"https://ghazihoushmand.ir/health"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      echo '{"status":"ONLINE","loaded_routers":[]}'
      exit 0 ;;
    *"https://ghazihoushmand.ir/admin"*|*"https://roxira.ir/admin"*|*"https://roxira.net/admin"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "404"; exit 0; fi
      exit 0 ;;
    *"/chat"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
    *"/pricing/plans"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
    *"/api/backend/health/system"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "502"; exit 0; fi
      exit 0 ;;
    *"/api/backend/tenants/me"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
  esac
done
echo -n "200"
exit 0
""",
        encoding="utf-8",
    )
    fake_curl.chmod(0o755)

    import os
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "DEPLOY_SSH_HOST": "local",
        "DEPLOY_SMOKE_AUTH_TOKEN": "test-token",
    }
    result = subprocess.run(
        ["bash", str(script_path()), "smoke"],
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    assert result.returncode != 0
    assert "backend health" in (result.stdout + result.stderr)
    assert "smoke FAIL" in (result.stdout + result.stderr)


def test_smoke_test_succeeds_when_all_services_healthy(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True)
    fake_curl = bin_dir / "curl"
    fake_curl.write_text(
        """#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *"https://ghazihoushmand.ir/health"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      echo '{"status":"ONLINE","loaded_routers":[]}'
      exit 0 ;;
    *"https://ghazihoushmand.ir/admin"*|*"https://roxira.ir/admin"*|*"https://roxira.net/admin"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "404"; exit 0; fi
      exit 0 ;;
    *"/chat"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
    *"/pricing/plans"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
    *"/api/backend/health/system"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
    *"/api/backend/tenants/me"*)
      if [[ "$*" == *"-w %{http_code}"* ]]; then echo -n "200"; exit 0; fi
      exit 0 ;;
  esac
done
echo -n "200"
exit 0
""",
        encoding="utf-8",
    )
    fake_curl.chmod(0o755)

    import os
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "DEPLOY_SSH_HOST": "local",
        "DEPLOY_SMOKE_AUTH_TOKEN": "test-token",
    }
    result = subprocess.run(
        ["bash", str(script_path()), "smoke"],
        capture_output=True,
        text=True,
        env=env,
        timeout=10,
    )
    assert result.returncode == 0
    assert "backend health /api/backend/health/system 200" in (result.stdout + result.stderr)
    assert "authenticated tenant read /api/backend/tenants/me 200" in (result.stdout + result.stderr)

