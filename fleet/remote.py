#!/usr/bin/env python3
"""Run a command against a pushed branch in a disposable Daytona sandbox (see remote.sh).
Secrets: only DAYTONA_API_KEY* are read, by name, from the environment; nothing is sent into the sandbox
except the public clone URL, the branch name, the command and synthetic ROXIRA_TEST_PG_* values."""
import base64, json, os, re, signal, sys, time, urllib.request, urllib.error, collections

BASE = "https://app.daytona.io/api"
REPO = os.environ.get("REMOTE_REPO", "https://github.com/Mahan-film/roxira-platform.git")
LABEL = {"roxira-remote": "1"}
CPU, MEM, DISK = (int(os.environ.get(k, d)) for k, d in (("REMOTE_CPU", 4), ("REMOTE_MEM", 4), ("REMOTE_DISK", 10)))
STOP_MIN = int(os.environ.get("REMOTE_STOP_MIN", 20))     # auto-stop backstop; autoDelete=0 deletes on stop
TOTAL = int(os.environ.get("REMOTE_TIMEOUT", 1500))       # whole run, seconds
MAXC = int(os.environ.get("REMOTE_MAX", 4))               # concurrent sandboxes
LOGDIR = "/home/mahan/Developer/roxira-wt/_fleet/logs"
DOCKERFILE = """FROM node:22-trixie
RUN apt-get update && apt-get install -y --no-install-recommends git postgresql-17 && rm -rf /var/lib/apt/lists/*
"""

def log(*a): print("[remote]", *a, flush=True)

class Api:
    def __init__(self, key): self.key = key
    def rq(self, m, p, body=None, t=120):
        last = None
        for i in range(10):   # the edge randomly answers 403 "not available in your location"; retry
            r = urllib.request.Request(BASE + p, data=json.dumps(body).encode() if body is not None else None, method=m)
            r.add_header("Authorization", "Bearer " + self.key); r.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(r, timeout=t) as x:
                    return x.status, json.loads(x.read() or b"{}")
            except urllib.error.HTTPError as e:
                txt = e.read()[:500].decode("utf8", "replace")
                if e.code == 403 and "location" in txt: last = (403, txt); time.sleep(1.5 + i * .5); continue
                return e.code, txt
            except Exception as e:   # network blip
                last = (0, str(e)); time.sleep(2)
        return last or (0, "failed")
    def exec(self, sid, cmd, timeout=60):
        s, b = self.rq("POST", f"/sandbox/{sid}/toolbox/process/execute", {"command": cmd, "timeout": timeout}, t=timeout + 30)
        if s >= 300 or not isinstance(b, dict): return 255, f"api {s} {str(b)[:200]}"
        return int(b.get("exitCode", b.get("exit_code", 0)) or 0), str(b.get("result", b.get("output", "")) or "")

def keys():
    out = []
    for n in ("DAYTONA_API_KEY", "DAYTONA_API_KEY_2", "DAYTONA_API_KEY_3", "DAYTONA_API_KEY_4"):
        if os.environ.get(n): out.append((n, os.environ[n]))
    return out

state = {"api": None, "sid": None}
def cleanup():
    api, sid = state["api"], state["sid"]
    if not sid: return
    for i in range(12):
        s, b = api.rq("DELETE", f"/sandbox/{sid}")
        if s < 300 or s == 404: log("sandbox deleted"); state["sid"] = None; return
        time.sleep(3)
    log(f"WARNING: could not delete sandbox {sid}; auto-stop {STOP_MIN} min + autoDelete=0 will remove it")

def die(code, msg):
    log(msg); cleanup(); sys.exit(code)

def on_sig(n, f): die(130, f"signal {n}, cleaning up")

def main():
    branch, cmd = sys.argv[1], (sys.argv[2] if len(sys.argv) == 3 else __import__("shlex").join(sys.argv[2:]))
    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP): signal.signal(s, on_sig)
    t0 = time.time(); deadline = t0 + TOTAL
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", branch): sys.exit("bad branch name")
    ks = keys()
    if not ks: sys.exit("no DAYTONA_API_KEY* in environment")
    want_pg = os.environ.get("REMOTE_PG", "auto")
    pg = want_pg == "1" or (want_pg == "auto" and "pg" in cmd)   # 'pg' covers *.pg.spec.ts and 'pg' words
    body = {"buildInfo": {"dockerfileContent": DOCKERFILE}, "cpu": CPU, "memory": MEM, "disk": DISK, "labels": LABEL,
            "autoStopInterval": STOP_MIN, "autoDeleteInterval": 0, "public": False}
    # pick a key: create on the first that accepts; rotate on 429 / quota / auth errors
    for name, k in ks:
        api = Api(k)
        waited = 0
        while True:   # concurrency cap
            s, b = api.rq("GET", "/sandbox")
            n = sum(1 for x in b.get("items", []) if (x.get("labels") or {}).get("roxira-remote") == "1" and x.get("state") not in ("destroying", "destroyed")) if s == 200 and isinstance(b, dict) else 0
            if n < MAXC: break
            if waited > 300: die(3, f"{n} remote sandboxes already running (cap {MAXC})")
            time.sleep(15); waited += 15
        s, b = api.rq("POST", "/sandbox", body, t=300)
        if s < 300 and isinstance(b, dict) and b.get("id"):
            state["api"], state["sid"] = api, b["id"]; log(f"sandbox {b['id'][:8]} created with {name} ({CPU} cpu/{MEM} GB/{DISK} GB)"); break
        log(f"{name}: create refused {s} {str(b)[:160]}; rotating")
    else:
        die(3, "no key could create a sandbox")
    api, sid = state["api"], state["sid"]
    # wait for build + start
    while time.time() < deadline:
        s, b = api.rq("GET", f"/sandbox/{sid}")
        st = b.get("state") if isinstance(b, dict) else None
        if st == "started": break
        if st in ("error", "build_failed"): die(4, f"sandbox state {st}: ...{str(b.get('errorReason'))[-700:]}")
        time.sleep(4)
    else:
        die(124, "timeout waiting for sandbox")
    log(f"sandbox started after {int(time.time()-t0)}s")
    # remote script (public code only; synthetic PG settings only), piped to `bash -s` over ssh
    script = f"""set -u
exec 2>&1
cd /tmp && rm -rf repo && echo '## clone' && git clone -q --depth 1 -b '{branch}' '{REPO}' repo || {{ echo 'CLONE FAILED'; exit 97; }}
cd repo && echo "## sha $(git rev-parse --short HEAD)"
cd output_apps/enterprise_hub || {{ echo 'no output_apps/enterprise_hub'; exit 98; }}
rm -f node_modules
echo '## npm ci'; S=$(date +%s)
npm ci --no-audit --no-fund --ignore-scripts >/tmp/npmci.log 2>&1 || {{ tail -n 40 /tmp/npmci.log; exit 99; }}
echo "## npm ci done in $(( $(date +%s)-S ))s"
export CI=1
"""
    if pg:
        script += """echo '## postgres 17'
PGB=/usr/lib/postgresql/17/bin; D=/tmp/pgdata; install -d -o postgres -g postgres $D
runuser -u postgres -- $PGB/initdb -D $D -U postgres -A trust >/tmp/initdb.log 2>&1 || { tail -n 20 /tmp/initdb.log; exit 96; }
runuser -u postgres -- $PGB/pg_ctl -D $D -o "-p 55432 -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200" -l /tmp/pg.log -w start >/dev/null || { tail -n 20 /tmp/pg.log; exit 96; }
$PGB/pg_isready -h 127.0.0.1 -p 55432
export ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55432 ROXIRA_TEST_PG_USER=postgres
"""
    script += f"""echo '## run'; S=$(date +%s)
( {cmd} )
rc=$?
echo "## exit $rc after $(( $(date +%s)-S ))s"
exit $rc
"""
    s_, b_ = api.rq("POST", f"/sandbox/{sid}/ssh-access?expiresInMinutes={TOTAL // 60 + 10}")
    if s_ >= 300 or not isinstance(b_, dict) or not b_.get("token"): die(5, f"ssh-access refused {s_} {str(b_)[:200]}")
    import subprocess, threading
    os.makedirs(LOGDIR, exist_ok=True)
    lp = f"{LOGDIR}/remote-{time.strftime('%Y%m%d-%H%M%S')}-{sid[:6]}.log"
    lines = collections.deque(maxlen=200)
    ssh = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
           "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-o", "ConnectTimeout=20", "-o", "BatchMode=yes",
           f"{b_['token']}@ssh.app.daytona.io", "bash -s"]
    rc = None
    for attempt in range(4):   # the ssh gateway/network can blip before the script starts
        p = subprocess.Popen(ssh, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            p.stdin.write(script); p.stdin.close()
        except BrokenPipeError: pass
        timer = threading.Timer(max(1, deadline - time.time()), lambda: p.kill()); timer.start()
        started = False
        with open(lp, "a") as lf:
            for l in p.stdout:
                started = True; lf.write(l); lf.flush(); lines.append(l.rstrip("\n"))
                if l.startswith("## "): log(l[3:].rstrip())
        rc = p.wait(); timer.cancel()
        if time.time() >= deadline:
            rc = 124; lines.append(f"## TIMEOUT after {TOTAL}s"); break
        if rc == 255 and not started and attempt < 3: log("ssh connect failed, retrying"); time.sleep(5); continue
        break
    wall = time.time() - t0
    print(f"----- last {len(lines)} lines (full log {lp}) -----")
    print("\n".join(list(lines)[-200:]))
    est = wall / 3600 * (CPU * 0.0504 + MEM * 0.0162 + max(0, DISK - 5) * 0.000108)
    print(f"----- exit {rc} | wall {wall:.0f}s | sandbox {CPU}cpu/{MEM}GB/{DISK}GB | est. credit ~${est:.4f} (API exposes no usage to keys) -----")
    cleanup()
    sys.exit(rc if rc is not None else 1)

try:
    main()
except SystemExit: raise
except BaseException as e:
    log(f"error {type(e).__name__}: {str(e)[:200]}"); cleanup(); sys.exit(1)
