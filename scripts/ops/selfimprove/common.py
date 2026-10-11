"""Shared paths, env and plumbing for the self-improvement loop. Stdlib only."""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("ROXIRA_REPO_DIR") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO, "scripts", "ops", "monitor"))
sys.path.insert(0, os.path.join(REPO, "scripts"))

STATE_DIR = os.environ.get("SELFIMPROVE_STATE_DIR", "/var/lib/roxira-selfimprove")
APP_CONTAINER = os.environ.get("SELFIMPROVE_APP_CONTAINER", "roxira_app_prod")
METRICS = os.path.join(STATE_DIR, "metrics.jsonl")
LEDGER = os.path.join(STATE_DIR, "ledger.jsonl")
REPORT_DIR = os.path.join(STATE_DIR, "reports")
MODELS_YAML = os.path.join(REPO, "config", "models.yaml")


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def role_models(role: str, path: str = MODELS_YAML) -> list:
    """Model ids of a role in config/models.yaml (minimal parser, PyYAML is not on the host)."""
    ids, in_roles, in_role, in_models = [], False, False, False
    for line in read_text(path).splitlines():
        if re.match(r"^roles:\s*$", line):
            in_roles = True
            continue
        if not in_roles or not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^  ([A-Za-z_]+):\s*$", line)
        if m:
            in_role, in_models = (m.group(1) == role), False
            continue
        if in_role:
            if re.match(r"^    models:\s*$", line):
                in_models = True
            elif in_models:
                m = re.match(r"^      - id:\s*(\S+)", line)
                if m:
                    ids.append(m.group(1))
    return ids


def model_prices(model_id: str, path: str = MODELS_YAML) -> tuple:
    """(in, out) USD per 1M tokens for a model id; (1.0, 4.0) when unknown (conservative)."""
    text = read_text(path)
    m = re.search(r"- id:\s*" + re.escape(model_id) + r"\s*\n\s*price_per_1m:\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)", text)
    return (float(m.group(1)), float(m.group(2))) if m else (1.0, 4.0)


def docker_exec_stdin(code: str, args=(), timeout: int = 300) -> subprocess.CompletedProcess:
    """Run Python code inside the app container via stdin (nothing is copied or installed)."""
    return subprocess.run(["docker", "exec", "-i", APP_CONTAINER, "python3", "-", *args],
                          input=code, capture_output=True, text=True, timeout=timeout, check=False)


def docker_logs(since: str, timeout: int = 120) -> list:
    r = subprocess.run(["docker", "logs", "--since", since, APP_CONTAINER],
                       capture_output=True, text=True, timeout=timeout, check=False, errors="replace")
    return (r.stdout + "\n" + r.stderr).splitlines()
