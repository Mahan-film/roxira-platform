#!/usr/bin/env python3
"""Control test: runs inside the agent sandbox and proves each limit holds. Prints one line per control."""
import os
import socket
import sys

LOCAL_HOST = "127.0.0.1"
GATEWAY_PORT = 4000
BLOCKED_PORTS = (22, 3000, 3001, 5432, 6333, 6379, 6432, 8000, 8090)
HIDDEN_PATHS = ("/opt/roxira_platform/.env", "/root", "/etc/roxira", "/var/lib/docker", "/var/lib/roxira-factory",
                "/var/lib/roxira-agents/logs", "/var/lib/roxira-agents/taskq", "/var/lib/roxira-agents/taskq.db")
STATE_WORKTREES = "/var/lib/roxira-agents/worktrees"
READONLY_DIRS = ("/usr", "/etc", "/var/lib/roxira-agents/patches")


def can_connect(host: str, port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(2)
        try:
            sock.connect((host, port))
        except OSError:
            return False
    return True


def can_read(path: str) -> bool:
    try:
        if os.path.isdir(path):
            os.listdir(path)
        else:
            with open(path, "rb") as handle:
                handle.read(1)
    except OSError:
        return False
    return True


def can_write(directory: str) -> bool:
    path = os.path.join(directory, f".sandbox-probe-{os.getpid()}")
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("x")
        os.unlink(path)
    except OSError:
        return False
    return True


def can_use_docker() -> bool:
    with socket.socket(socket.AF_UNIX) as sock:
        try:
            sock.connect("/var/run/docker.sock")
        except OSError:
            return False
    return True


def main() -> int:
    workdir = sys.argv[1]
    results = [("not root", os.getuid() != 0), ("write workdir", can_write(workdir))]
    results.append(("gateway reachable", can_connect(LOCAL_HOST, GATEWAY_PORT)))
    results += [(f"port {port} blocked", not can_connect(LOCAL_HOST, port)) for port in BLOCKED_PORTS]
    results.append(("metadata blocked", not can_connect("169.254.169.254", 80)))
    results.append(("internet port 80 blocked", not can_connect("1.1.1.1", 80)))
    results += [(f"hidden {path}", not can_read(path)) for path in HIDDEN_PATHS]
    results += [(f"read-only {path}", not can_write(path)) for path in READONLY_DIRS]
    results.append(("docker socket blocked", not can_use_docker()))
    # other runs' worktrees are hidden: only this run's directory is visible under worktrees/
    if workdir.startswith(STATE_WORKTREES + "/"):
        others = [d for d in os.listdir(STATE_WORKTREES) if os.path.join(STATE_WORKTREES, d) != workdir]
        results.append(("other worktrees hidden", not others))
    secrets = [k for k in ("OPENROUTER_API_KEY_AGENTS", "KEYPOOL_MASTER_KEY", "GROQ_API_KEY") if os.environ.get(k)]
    results.append(("no API key in the check environment", not secrets))
    for name, passed in results:
        print(("ok   " if passed else "FAIL ") + name)
    return 0 if all(passed for _, passed in results) else 1


if __name__ == "__main__":
    sys.exit(main())
