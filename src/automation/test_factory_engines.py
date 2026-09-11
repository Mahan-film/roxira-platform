import os
import sys
import pathlib

_CURRENT_DIR = pathlib.Path(__file__).resolve().parent
_REPO_ROOT = _CURRENT_DIR.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from __future__ import annotations

import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.automation.cerebras_client import CerebrasClient
from src.automation.git_worktree_manager import GitWorktreeManager
from src.automation.provider_base import get_env_var
from src.automation.sambanova_client import SambaNovaClient


def _line(label: str, value: str) -> None:
    print(f"  {label:<28} {value}")


def test_engine(name: str, client, budget_ms: float) -> bool:
    print(f"\n[{name}]")
    _line("API key", "CONFIGURED" if client.configured else "MISSING")
    if not client.configured:
        return False

    health = client.health()
    code = health.get("http_code")
    _line("GET /models", f"HTTP {code} ({health.get('elapsed_ms')} ms)")
    if health.get("status") != "SUCCESS":
        _line("error", str(health.get("error"))[:160])
        return False

    models = client.list_models()
    _line("models", ", ".join(models[:6]) if models else "n/a")

    latency = client.measure_latency(samples=3, budget_ms=budget_ms)
    _line("latency samples (ms)", ", ".join(str(x) for x in latency["samples_ms"]))
    _line("latency min/avg (ms)", f"{latency['min_ms']} / {latency['avg_ms']}")
    verdict = "PASS" if latency["within_budget"] else "OVER BUDGET"
    _line(f"budget <{budget_ms:.0f}ms", verdict)

    probe = client.chat("Reply with the single word OK", max_tokens=4, temperature=0.0)
    if probe.get("status") == "SUCCESS":
        _line("inference probe", f"OK ({probe.get('elapsed_ms')} ms)")
    else:
        _line("inference probe", f"HTTP {probe.get('http_code')} (billing/quota)")
    return True


def test_worktree_manager() -> bool:
    print("\n[GitWorktreeManager]")
    manager = GitWorktreeManager()
    _line("repo", str(manager.repo_path))
    _line("worktrees root", str(manager.worktrees_root))
    if not manager.is_git_repo():
        _line("git repo", "NOT A GIT REPOSITORY")
        return False

    task_id = "engine-selftest"
    created = manager.create(task_id)
    _line("create", created.get("status", "ERROR"))
    if created.get("status") not in ("CREATED", "EXISTS"):
        _line("error", str(created.get("error"))[:160])
        return False

    probe = "probe_isolation.py"
    manager.write_file(task_id, probe, "value = 1 + 1\n")
    check = manager.validate_python(task_id, probe)
    _line("isolated py_compile", check.get("status", "ERROR"))
    manager.remove(task_id, delete_branch=True)
    _line("remove", "DONE")
    return check.get("status") == "SUCCESS"


def main() -> int:
    budget_ms = float(get_env_var("FACTORY_LATENCY_BUDGET_MS", "200"))
    print("=" * 60)
    print("ROXIRA FACTORY ENGINE CONNECTIVITY & LATENCY TEST")
    print("=" * 60)
    _line("latency budget", f"{budget_ms:.0f} ms")

    cerebras_ok = test_engine("Cerebras", CerebrasClient(), budget_ms)
    sambanova_ok = test_engine("SambaNova", SambaNovaClient(), budget_ms)
    worktree_ok = test_worktree_manager()

    print("\n" + "=" * 60)
    _line("Cerebras connectivity", "PASS" if cerebras_ok else "FAIL")
    _line("SambaNova connectivity", "PASS" if sambanova_ok else "FAIL")
    _line("Worktree isolation", "PASS" if worktree_ok else "FAIL")
    print("=" * 60)
    return 0 if (cerebras_ok and sambanova_ok and worktree_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
