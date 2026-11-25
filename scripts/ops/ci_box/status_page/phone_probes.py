#!/usr/bin/env python3
"""Phone line probes for the box status page and failure alerts (work package G). Stdlib only.

Two halves, both pure parsers plus thin collectors:

* `collect_phone()` (runs inside box_status.collect as the lane user): containers by ROLE (found by image, so no
  carrier or container name lives in git), SIP registration state and carrier contact qualify state from the
  Asterisk bridge (`docker exec ... asterisk -rx`), LiveKit and TTS sidecar HTTP on loopback, the voice agent's
  systemd unit restarts, log growth per container, recordings found in the bridge, and two optional files:
  the signals file (below) and a nightly voice-test report.
* `phone_probes.py signals` (runs as a sandboxed system unit that may read the adm-only ufw log and the system
  journal, see install_phone_signals_root.sh): writes a SANITISED json file: counts of firewall drops on the SIP
  ports from non-private sources, the last call start/end time, first-audio timings of real turns, agent crash
  starts. It never writes a raw line, an address, a room name, a phone number or a transcript.

`derive_phone_results()` turns the snapshot into {check: (ok, detail)} for monitor_common.evaluate through
box_alert. A source that cannot be read gives "unknown" and is left out (it neither opens nor closes an incident).

Privacy rule for this module: parsers keep status words, counts, timestamps and *_ms numbers only. Addresses seen
while parsing are classified in memory and dropped; container names are used for one command and not stored.

Nightly voice-test report contract (written by the future nightly test, issue #1119; read if present):
  {"ts": <unix seconds>, "setup_ms": {"p50": n, "p95": n}, "first_audio_ms": {"p50": n, "p95": n}}
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# image substring -> role (first match wins; "livekit/sip" must come before "redis" etc.)
ROLE_IMAGES = (("sip", "livekit/sip"), ("server", "livekit/livekit-server"), ("bridge", "asterisk"), ("redis", "redis"))
ROLES = tuple(r for r, _ in ROLE_IMAGES)
AGENT_UNITS = {"agent": "voice-ai-agent.service", "tts": "voice-ai-tts.service"}
LIVEKIT_URL = "http://127.0.0.1:7880/"
TTS_URL = "http://127.0.0.1:5055/health"
DEFAULT_SIGNALS = "/var/lib/roxira-phone/phone-signals.json"
DEFAULT_VOICE_REPORT = "/srv/data/phone/voice-test/latest.json"
DEFAULT_USAGE_STATE = "/srv/data/phone/state/phone_usage_state.json"
DEFAULT_PRICING_FILE = str(Path(__file__).resolve().parents[4] / "config/phone_pricing.json")
DEFAULT_SIP_PORTS = (5060, 5062)
RECORDING_DIRS = ("/var/spool/asterisk/monitor", "/var/spool/asterisk/recording")

CRASH_RESTARTS = 3            # restarts between two samples that count as a crash loop
LOG_MB_DAY = 100.0            # per container, extrapolated from the last hour
LOG_WINDOW_H = 1
SIGNALS_MAX_AGE_S = 20 * 60   # the producer runs every 5 min
VOICE_STALE_S = 36 * 3600
FIRST_AUDIO_TARGET_MS = 1500  # issue #989 / R30: first audio p50 target
KEEP_TURNS = 200

REG_WORDS = r"Unregistered|Registered|Rejected|Failed|Stopped|Retry Wait"


# ------------------------------------------------------------------ small helpers
def _run(cmd: list[str], timeout: float = 20) -> tuple[int, str]:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return res.returncode, res.stdout
    except FileNotFoundError:
        return 127, ""
    except subprocess.TimeoutExpired:
        return 124, ""
    except OSError:
        return 126, ""


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile; None for an empty list."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(1, math.ceil(p / 100.0 * len(vals)))
    return float(vals[k - 1])


def parse_iso(token: str) -> float | None:
    try:
        dt = datetime.fromisoformat(token.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def parse_systemd_ts(value: str) -> float | None:
    """'Sat 2026-11-21 12:58:49 UTC' -> epoch; '' / 'n/a' -> None."""
    m = re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})", value or "")
    return parse_iso(m.group(1) + "T" + m.group(2) + "+00:00") if m else None


def _public_source(addr: str, cidrs: list) -> bool:
    """True when a firewall-drop source counts: not private/loopback/link-local, and inside the optional CIDRs."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
        return False
    return not cidrs or any(ip in net for net in cidrs if net.version == ip.version)


def parse_cidrs(text: str) -> list:
    out = []
    for part in re.split(r"[,\s]+", text or ""):
        if part:
            try:
                out.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                pass
    return out


def parse_ports(text: str | None) -> tuple[int, ...]:
    ports = tuple(int(p) for p in re.findall(r"\d+", text or "") if 0 < int(p) < 65536)
    return ports or DEFAULT_SIP_PORTS


# ------------------------------------------------------------------ containers
def role_for_image(image: str) -> str | None:
    img = (image or "").lower()
    for role, needle in ROLE_IMAGES:
        if needle in img:
            return role
    return None


def parse_ps(text: str) -> dict:
    """`docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}'` -> {role: (name, status)}. Name is for one command only."""
    out: dict = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        role = role_for_image(parts[1])
        if role and role not in out:
            out[role] = (parts[0].strip(), parts[2].strip())
    return out


def parse_inspect(line: str) -> dict:
    """'running|healthy|0|2026-11-21T12:58:49.5Z' -> state dict. Health 'none' means the image has no healthcheck."""
    f = (line.strip().split("|") + ["", "", "", ""])[:4]
    try:
        restarts = int(f[2])
    except ValueError:
        restarts = 0
    return {"status": f[0] or "unknown", "health": f[1] or "none", "restarts": restarts, "started": parse_iso(f[3])}


def container_ok(c: dict) -> bool:
    return c.get("status") == "running" and c.get("health") in ("none", "healthy", "starting")


# ------------------------------------------------------------------ asterisk output
def parse_registrations(text: str) -> list[str]:
    """Status word per registration row. Rows are recognised by a sip URI on the line; the URI itself is dropped."""
    out = []
    for line in text.splitlines():
        if "/sip" not in line:
            continue
        m = re.search(r"\b(" + REG_WORDS + r")\b", line)
        out.append(m.group(1) if m else "Unknown")
    return out


def parse_contacts(text: str) -> list[dict]:
    """[{loopback: bool, status, rtt_ms}] per Contact row. The URI host is classified, never stored."""
    out = []
    for line in text.splitlines():
        m = re.match(r"^\s*Contact:\s+\S+?/(sips?:\S+)\s+\S+\s+(Avail|Unavail|NonQual|Unknown|Created|Removed)\s+(\S+)", line)
        if not m:
            continue
        hm = re.match(r"sips?:(?:[^@]*@)?\[?([^\]:;>]+)", m.group(1))
        host = hm.group(1) if hm else ""
        try:
            loop = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loop = host == "localhost"
        try:
            rtt = float(m.group(3))
            rtt = None if rtt != rtt else rtt  # 'nan' for unqualified contacts
        except ValueError:
            rtt = None
        out.append({"loopback": loop, "status": m.group(2), "rtt_ms": rtt})
    return out


def carrier_qualify(contacts: list[dict]) -> dict:
    """Summarise the non-loopback contacts (the carrier path): worst status wins, 'none' when there is no such contact."""
    ext = [c for c in contacts if not c["loopback"]]
    if not ext:
        return {"state": "none", "rtt_ms": None}
    bad = [c["status"] for c in ext if c["status"] != "Avail"]
    rtts = [c["rtt_ms"] for c in ext if c["rtt_ms"] is not None]
    return {"state": bad[0] if bad else "Avail", "rtt_ms": max(rtts) if rtts else None}


def parse_channels(text: str) -> dict:
    out = {}
    for key, rx in (("active_calls", r"(\d+) active calls?"), ("calls_processed", r"(\d+) calls? processed")):
        m = re.search(rx, text)
        if m:
            out[key] = int(m.group(1))
    return out


def parse_uptime_seconds(text: str) -> int | None:
    m = re.search(r"System uptime:\s*(\d+)", text)
    return int(m.group(1)) if m else None


# ------------------------------------------------------------------ systemd
def parse_show_blocks(text: str) -> dict:
    """`systemctl show -p Id,ActiveState,... a b` -> {Id: {prop: value}}; blocks are separated by blank lines."""
    out: dict = {}
    for block in re.split(r"\n\s*\n", text.strip()):
        props = {}
        for line in block.splitlines():
            k, sep, v = line.partition("=")
            if sep:
                props[k.strip()] = v.strip()
        if props.get("Id"):
            out[props["Id"]] = props
    return out


def unit_info(props: dict) -> dict:
    try:
        n = int(props.get("NRestarts", "0"))
    except ValueError:
        n = 0
    return {"active": props.get("ActiveState", "unknown"), "sub": props.get("SubState", ""), "restarts": n,
            "since": parse_systemd_ts(props.get("ActiveEnterTimestamp", "")), "result": props.get("Result", "")}


# ------------------------------------------------------------------ signals file (producer side, privileged logs)
def parse_ufw_blocks(text: str, now: float, ports=DEFAULT_SIP_PORTS, cidrs=None) -> dict:
    """Count '[UFW BLOCK]' lines to the SIP ports from non-private sources. Returns counts and the last time, no addresses."""
    cidrs = cidrs or []
    n1 = n24 = 0
    last = None
    for line in text.splitlines():
        if "[UFW BLOCK]" not in line:
            continue
        ts = parse_iso(line.split(" ", 1)[0])
        src = re.search(r"\bSRC=(\S+)", line)
        dpt = re.search(r"\bDPT=(\d+)", line)
        if ts is None or not src or not dpt or int(dpt.group(1)) not in ports or not _public_source(src.group(1), cidrs):
            continue
        age = now - ts
        if age < 0 or age > 86400:
            continue
        n24 += 1
        n1 += 1 if age <= 3600 else 0
        last = ts if last is None or ts > last else last
    return {"drops_1h": n1, "drops_24h": n24, "last_ts": last}


def parse_agent_journal(text: str, now: float) -> dict:
    """Agent unit journal (`journalctl -o short-iso`) -> call times, first-audio timings of real turns, crash starts.

    Only matched numbers and times are kept: no room name (it can hold the caller number), no transcript text."""
    calls = ends = crash1h = 0
    last_start = last_end = None
    fa: list[tuple[float, int]] = []
    for line in text.splitlines():
        ts = parse_iso(line.split(" ", 1)[0]) if line else None
        if ts is None:
            continue
        if "joined; caller" in line:
            calls += 1
            last_start = ts if last_start is None or ts > last_start else last_start
        elif re.search(r"\bended \([^)]*\) after \d+ s", line):
            ends += 1
            last_end = ts if last_end is None or ts > last_end else last_end
        m = re.search(r"\bfirst_audio_ms:\s*(\d+)", line)
        if m:
            fa.append((ts, int(m.group(1))))
        if "Failed with result" in line and 0 <= now - ts <= 3600:
            crash1h += 1
    fa.sort()
    return {"calls": calls, "ended": ends, "last_call_start": last_start, "last_call_end": last_end,
            "first_audio_ms": [v for _, v in fa][-KEEP_TURNS:], "crash_starts_1h": crash1h}


def build_signals(ufw_text: str | None, journal_text: str | None, now: float, ports=DEFAULT_SIP_PORTS, cidrs=None) -> dict:
    """The sanitised signals document. A source that could not be read is None and stays out of the file."""
    doc: dict = {"generated": now, "version": 1}
    if ufw_text is not None:
        doc["ufw"] = parse_ufw_blocks(ufw_text, now, ports, cidrs)
    if journal_text is not None:
        doc["agent"] = parse_agent_journal(journal_text, now)
    return doc


def read_signals(path: str, now: float) -> dict:
    """{'state': 'absent'|'unknown'|'stale'|'ok', ...}. 'absent' = producer not installed (nothing is expected)."""
    p = Path(path)
    if not p.exists():
        return {"state": "absent"}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        gen = float(doc["generated"])
    except (OSError, ValueError, KeyError, TypeError):
        return {"state": "unknown", "error": "signals file unreadable"}
    out = {"state": "ok" if now - gen <= SIGNALS_MAX_AGE_S else "stale", "age_s": max(0, int(now - gen))}
    for key in ("ufw", "agent"):
        if isinstance(doc.get(key), dict):
            out[key] = doc[key]
    return out


def read_voice_report(path: str, now: float) -> dict:
    """Optional nightly voice-test report; 'absent' when the nightly test does not exist yet."""
    p = Path(path)
    if not p.exists():
        return {"state": "absent"}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        ts = float(doc["ts"])
        out = {"state": "ok", "ts": ts, "age_s": max(0, int(now - ts))}
        for key in ("setup_ms", "first_audio_ms"):
            if isinstance(doc.get(key), dict):
                out[key] = {k: float(v) for k, v in doc[key].items() if k in ("p50", "p95") and isinstance(v, (int, float))}
        return out
    except (OSError, ValueError, KeyError, TypeError):
        return {"state": "unknown", "error": "voice report unreadable"}


def read_phone_costs(state_path: str, pricing_path: str, now: float) -> dict:
    """Read usage state and evaluate against pricing config caps. Returns dict with state and metrics."""
    sp = Path(state_path)
    if not sp.exists():
        return {"state": "absent"}
    try:
        data = json.loads(sp.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"state": "unknown", "error": "usage state unreadable"}

    pp = Path(pricing_path)
    if not pp.exists():
        return {"state": "unknown", "error": "pricing config absent"}
    try:
        cfg = json.loads(pp.read_text(encoding="utf-8"))
        caps = cfg.get("abuse_caps", {})
        spend_cap_cents = int(caps["monthly_spend_cap"]["cap_usd_cents"])
        alert_ratio_raw = caps["monthly_spend_cap"]["alert_threshold_ratio"]
        global_max_calls = int(caps["global_daily"]["max_calls"])
        global_max_seconds = int(caps["global_daily"]["max_connected_seconds"])
        per_caller_max_calls = int(caps["per_caller_daily"]["max_calls"])
        per_caller_max_seconds = int(caps["per_caller_daily"]["max_connected_seconds"])
    except (OSError, ValueError, KeyError, TypeError):
        return {"state": "unknown", "error": "pricing config unreadable"}

    monthly_total = int(round(float(data.get("monthlyTotalCents", 0))))
    alert_bps = int(round(float(alert_ratio_raw) * 10000))
    ratio_bps = (monthly_total * 10000) // spend_cap_cents if spend_cap_cents > 0 else 0
    ratio = ratio_bps / 10000
    alert_80 = (monthly_total * 10000) >= (spend_cap_cents * alert_bps) if spend_cap_cents > 0 else False
    cap_exceeded = monthly_total >= spend_cap_cents if spend_cap_cents > 0 else False

    today_str = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
    today_usage = data.get("dailyUsage", {}).get(today_str, {})
    today_calls = int(today_usage.get("totalCalls", 0))
    today_seconds = int(today_usage.get("totalConnectedSeconds", 0))

    callers = today_usage.get("callers", {})
    per_caller_exceeded_count = 0
    if isinstance(callers, dict):
        for c_usage in callers.values():
            if not isinstance(c_usage, dict):
                continue
            if (
                int(c_usage.get("calls", 0)) >= per_caller_max_calls
                or int(c_usage.get("connectedSeconds", 0)) >= per_caller_max_seconds
            ):
                per_caller_exceeded_count += 1

    global_daily_exceeded = today_calls >= global_max_calls or today_seconds >= global_max_seconds
    daily_exceeded = global_daily_exceeded or per_caller_exceeded_count > 0

    return {
        "state": "ok",
        "spend_cents": monthly_total,
        "cap_cents": spend_cap_cents,
        "ratio": ratio,
        "alert_80": alert_80,
        "cap_exceeded": cap_exceeded,
        "today_calls": today_calls,
        "max_daily_calls": global_max_calls,
        "today_seconds": today_seconds,
        "max_daily_seconds": global_max_seconds,
        "per_caller_exceeded_count": per_caller_exceeded_count,
        "global_daily_exceeded": global_daily_exceeded,
        "daily_exceeded": daily_exceeded,
    }


# ------------------------------------------------------------------ collectors
def http_ok(url: str, timeout: float = 4.0) -> dict:
    """Loopback GET with the proxy bypassed (the user units set HTTP_PROXY). state ok only for HTTP 200."""
    t0 = time.monotonic()
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=timeout) as resp:
            code = resp.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except Exception as exc:
        return {"state": "failed", "text": "no answer (" + type(exc).__name__ + ")", "ms": None}
    return {"state": "ok" if code == 200 else "failed", "text": f"HTTP {code}", "ms": int((time.monotonic() - t0) * 1000)}


def collect_phone(env: dict, now: float, runner=_run, prev: dict | None = None, http=http_ok) -> dict:
    """Snapshot of the phone line. Every sub-source is defensive: it becomes {'state': 'unknown'} instead of raising."""
    prev = prev or {}
    out: dict = {"state": "ok"}
    rc, text = runner(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"], 20)
    found: dict = {}
    if rc != 0:
        out["state"] = "unknown"
        out["error"] = f"docker ps rc {rc}"
    else:
        found = parse_ps(text)
    cont: dict = {}
    for role in ROLES:
        if role not in found:
            continue
        name = found[role][0]
        rc, line = runner(["docker", "inspect", "-f",
                           "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.StartedAt}}", name], 20)
        info = parse_inspect(line) if rc == 0 else {"status": "unknown", "health": "none", "restarts": 0, "started": None}
        info["state"] = "ok" if container_ok(info) else ("unknown" if rc != 0 else "failed")
        # log growth: bytes of the last window, extrapolated to MB per day (json-file logs have no rotation here)
        # bytes are counted in the shell: containers log to stderr too, and no log text should reach this process
        rc, count = runner(["sh", "-c", f'docker logs --since {LOG_WINDOW_H}h "$1" 2>&1 | wc -c', "_", name], 60)
        if rc == 0 and count.strip().isdigit():
            info["log_mb_day"] = round(int(count.strip()) / 1048576.0 * 24 / LOG_WINDOW_H, 2)
        cont[role] = info
    out["containers"] = cont
    out["missing_roles"] = [r for r in ROLES if r not in found] if out["state"] == "ok" else []

    sip: dict = {"state": "unknown"}
    bridge = (found.get("bridge") or ("", ""))[0]
    if bridge and cont.get("bridge", {}).get("status") == "running":
        def ast(cmd: str) -> tuple[int, str]:
            return runner(["docker", "exec", bridge, "asterisk", "-rx", cmd], 15)
        rc1, t1 = ast("pjsip show registrations")
        rc2, t2 = ast("pjsip show contacts")
        rc3, t3 = ast("core show channels count")
        rc4, t4 = ast("core show uptime seconds")
        sip = {"state": "ok" if rc1 == 0 and rc2 == 0 else "unknown"}
        if rc1 == 0:
            sip["registrations"] = parse_registrations(t1)
        if rc2 == 0:
            sip["qualify"] = carrier_qualify(parse_contacts(t2))
        if rc3 == 0:
            sip.update(parse_channels(t3))
        if rc4 == 0:
            sip["asterisk_uptime_s"] = parse_uptime_seconds(t4)
        rc5, t5 = runner(["docker", "exec", bridge, "sh", "-c",
                          "find " + " ".join(RECORDING_DIRS) + " -type f 2>/dev/null | wc -l"], 15)
        if rc5 == 0 and t5.strip().isdigit():
            sip["recording_files"] = int(t5.strip())
    out["sip"] = sip

    out["livekit"] = http(env.get("PHONE_LIVEKIT_URL") or LIVEKIT_URL)
    out["tts"] = http(env.get("PHONE_TTS_URL") or TTS_URL)

    units: dict = {}
    rc, text = runner(["systemctl", "show", "-p", "Id,LoadState,ActiveState,SubState,NRestarts,ActiveEnterTimestamp,Result", *AGENT_UNITS.values()], 10)
    if rc == 0:
        blocks = parse_show_blocks(text)
        for key, unit in AGENT_UNITS.items():
            if unit in blocks and blocks[unit].get("LoadState", "loaded") != "not-found":
                units[key] = unit_info(blocks[unit])
    out["units"] = units

    sig = read_signals(env.get("PHONE_SIGNALS_FILE") or DEFAULT_SIGNALS, now)
    out["signals"] = sig
    out["voice_test"] = read_voice_report(env.get("PHONE_VOICE_REPORT") or DEFAULT_VOICE_REPORT, now)
    costs_state = env.get("PHONE_STATE_FILE") or DEFAULT_USAGE_STATE
    pricing_file = env.get("PHONE_PRICING_JSON") or DEFAULT_PRICING_FILE
    out["costs"] = read_phone_costs(costs_state, pricing_file, now)

    # last inbound call: the journal signal when available, else the bridge's own call counter seen to move
    cur, old = sip.get("calls_processed"), prev.get("last_calls_processed")
    last_ts = (sig.get("agent") or {}).get("last_call_start") if sig.get("state") in ("ok", "stale") else None
    source = "agent journal" if last_ts else None
    if last_ts is None:
        last_ts, source = prev.get("last_call_ts"), prev.get("last_call_source")
        if cur is not None and old is not None and cur > old:
            last_ts, source = now, "bridge call counter"
    out["last_call_ts"], out["last_call_source"] = last_ts, source
    out["last_calls_processed"] = cur if cur is not None else old
    turns = (sig.get("agent") or {}).get("first_audio_ms") or []
    out["first_audio"] = {"n": len(turns), "p50": percentile(turns, 50), "p95": percentile(turns, 95)} if turns else {"n": 0}
    return out


# ------------------------------------------------------------------ results for the alert state machine
def _float(env, key: str, default: float) -> float:
    try:
        return float(env.get(key, "") or default)
    except ValueError:
        return default


def derive_phone_results(phone: dict | None, state: dict, now: float, env=None) -> dict:
    """{check_key: (ok, detail)}. Missing/unreadable sources are omitted. Mutates state['phone_prev'] (restart counters)."""
    env = os.environ if env is None else env
    res: dict = {}
    if not phone:
        return res
    containers, units = phone.get("containers") or {}, phone.get("units") or {}
    if not containers and not units:
        return res  # no phone stack on this box (or nothing readable): nothing is expected
    prev = state.setdefault("phone_prev", {})
    nxt: dict = {}
    if containers:  # a role that disappeared (e.g. `phone-stack down` removed it) must not silently drop its checks
        for role in phone.get("missing_roles") or []:
            res[f"phone:container:{role}"] = (False, f"phone {role} container not found (removed or never started)")

    for role, c in containers.items():
        if c.get("state") in ("ok", "failed"):
            res[f"phone:container:{role}"] = (c["state"] == "ok", f"phone {role} container {c.get('status')} (health {c.get('health')})")
            key = f"restarts:{role}"
            nxt[key] = c.get("restarts", 0)
            d = nxt[key] - prev[key] if key in prev and nxt[key] >= prev[key] else 0
            res[f"phone:restart-loop:{role}"] = (d < CRASH_RESTARTS, f"phone {role} container restarted {d} times since the last check")
        mb = c.get("log_mb_day")
        if mb is not None:
            limit = _float(env, "PHONE_LOG_MB_DAY", LOG_MB_DAY)
            res[f"phone:log-growth:{role}"] = (mb < limit, f"phone {role} container logs grow about {mb:g} MB a day (limit {limit:g}); no log rotation is set")

    sip = phone.get("sip") or {}
    regs = sip.get("registrations")
    if regs:
        bad = sorted({r for r in regs if r != "Registered"})
        res["phone:sip-registration"] = (not bad, "SIP registration " + (", ".join(bad) if bad else "Registered"))
    q = sip.get("qualify") or {}
    if q.get("state") not in (None, "none"):
        res["phone:sip-qualify"] = (q["state"] == "Avail", f"carrier contact qualify {q['state']} (the OPTIONS keepalive keeps the UDP path open)")
    if sip.get("recording_files") is not None:
        res["phone:recordings"] = (sip["recording_files"] == 0, f"{sip['recording_files']} call recording files in the bridge; no real customer data may be kept on this box")

    for key in ("livekit", "tts"):
        h = phone.get(key) or {}
        if h.get("state") in ("ok", "failed"):
            res[f"phone:{key}-http"] = (h["state"] == "ok", ("LiveKit" if key == "livekit" else "TTS sidecar") + f" health: {h.get('text')}")

    for key, u in units.items():
        res[f"phone:unit:{key}"] = (u.get("active") == "active", f"phone {key} unit is {u.get('active')}/{u.get('sub')}")
        k = f"unit_restarts:{key}"
        nxt[k] = u.get("restarts", 0)
        d = nxt[k] - prev[k] if k in prev and nxt[k] >= prev[k] else 0
        res[f"phone:crash-loop:{key}"] = (d < CRASH_RESTARTS, f"phone {key} unit restarted {d} times since the last check (a crash loop looks 'active' most of the time)")

    sig = phone.get("signals") or {}
    if sig.get("state") == "stale":
        res["phone:signals-fresh"] = (False, f"phone signals file not updated for {sig.get('age_s', 0) // 60} min (producer timer stopped?)")
    elif sig.get("state") == "ok":
        res["phone:signals-fresh"] = (True, "signals fresh")
        if "ufw" in sig:
            n = sig["ufw"].get("drops_1h", 0)
            res["phone:ufw-sip-drops"] = (n == 0, f"{n} firewall drops on the SIP ports from outside the LAN in the last hour (carrier INVITEs are lost if the UDP conntrack entry expired)")
        ag = sig.get("agent") or {}
        if "crash_starts_1h" in ag:
            res["phone:agent-crash-starts"] = (ag["crash_starts_1h"] < CRASH_RESTARTS, f"{ag['crash_starts_1h']} agent start failures in the last hour")
        stale_h = _float(env, "PHONE_CALL_STALE_H", 0)  # off by default: the line has had two calls so far
        if stale_h > 0 and phone.get("last_call_ts"):
            age_h = (now - phone["last_call_ts"]) / 3600
            res["phone:last-call"] = (age_h < stale_h, f"last inbound call {age_h:.0f} h ago (limit {stale_h:g} h)")

    vt = phone.get("voice_test") or {}
    if vt.get("state") == "ok":
        res["phone:voice-test-fresh"] = (vt["age_s"] < VOICE_STALE_S, f"nightly voice test report is {vt['age_s'] // 3600} h old")
        p50 = (vt.get("first_audio_ms") or {}).get("p50")
        if p50 is not None:
            target = _float(env, "PHONE_FIRST_AUDIO_TARGET_MS", FIRST_AUDIO_TARGET_MS)
            res["phone:first-audio"] = (p50 <= target, f"nightly voice test first audio p50 {p50:.0f} ms (target {target:g} ms)")

    costs = phone.get("costs") or {}
    if costs.get("state") == "ok":
        spend_cents = int(costs.get("spend_cents", 0))
        cap_cents = int(costs.get("cap_cents", 100000))
        spend_d, spend_c = divmod(abs(spend_cents), 100)
        cap_d, cap_c = divmod(abs(cap_cents), 100)
        spend_str = f"${spend_d}.{spend_c:02d}"
        cap_str = f"${cap_d}.{cap_c:02d}"
        ratio = costs.get("ratio", 0.0)
        per_caller_hits = int(costs.get("per_caller_exceeded_count", 0))
        res["phone:monthly-spend-cap"] = (
            not costs.get("cap_exceeded", False),
            f"phone monthly spend is {spend_str} of {cap_str} cap ({ratio * 100:.1f}%)",
        )
        res["phone:spend-alert-80"] = (
            not costs.get("alert_80", False),
            f"phone monthly spend is {spend_str} ({ratio * 100:.1f}% of {cap_str} cap; alert threshold 80%)",
        )
        daily_detail = (
            f"phone daily usage: {costs.get('today_calls', 0)}/{costs.get('max_daily_calls', 0)} calls "
            f"({costs.get('today_seconds', 0)}s connected"
            + (f", {per_caller_hits} caller(s) capped)" if per_caller_hits > 0 else ")")
        )
        res["phone:daily-caps"] = (
            not costs.get("daily_exceeded", False),
            daily_detail,
        )
    elif costs.get("state") == "unknown":
        res["phone:monthly-spend-cap"] = (False, f"phone usage state unreadable: {costs.get('error')}")

    state["phone_prev"] = nxt
    return res


# ------------------------------------------------------------------ html section (called by box_status.render_html)
def render_section(phone: dict | None, e, dot, now: float) -> str:
    """HTML body of the phone panel. `e` escapes, `dot(state, text)` draws a state dot (both from box_status)."""
    if not phone or phone.get("state") == "unknown":
        return "<p>" + dot("unknown", (phone or {}).get("error", "not collected")) + "</p>"
    t = "<table>"
    for role in ROLES:
        c = (phone.get("containers") or {}).get(role)
        if c is None:
            t += f"<tr><td>{e(role)}</td><td>{dot('failed', 'container not found')}</td></tr>"
            continue
        up = ", up %d min" % ((now - c["started"]) // 60) if c.get("started") else ""
        log = ", logs %g MB/day" % c["log_mb_day"] if c.get("log_mb_day") is not None else ""
        txt = "%s / health %s, restarts %s%s%s" % (c.get("status"), c.get("health"), c.get("restarts"), up, log)
        t += f"<tr><td>{e(role)}</td><td>{dot(c.get('state', 'unknown'), txt)}</td></tr>"
    sip = phone.get("sip") or {}
    regs = sip.get("registrations")
    if regs is not None:
        word = ", ".join(sorted(set(regs))) or "no registration configured"
        st = "neutral" if not regs else ("ok" if set(regs) == {"Registered"} else "failed")
        t += f"<tr><td>SIP registration</td><td>{dot(st, word)}</td></tr>"
    q = sip.get("qualify")
    if q:
        rtt = " (%g ms)" % q["rtt_ms"] if q.get("rtt_ms") is not None else ""
        t += f"<tr><td>carrier qualify</td><td>{dot('ok' if q['state'] == 'Avail' else 'failed', q['state'] + rtt)}</td></tr>"
    if "active_calls" in sip:
        t += f"<tr><td>calls now / since bridge start</td><td>{e(sip.get('active_calls'))} / {e(sip.get('calls_processed', '?'))}</td></tr>"
    for key, label in (("livekit", "LiveKit health"), ("tts", "TTS sidecar")):
        h = phone.get(key) or {}
        ms = " (%d ms)" % h["ms"] if h.get("ms") is not None else ""
        t += f"<tr><td>{label}</td><td>{dot(h.get('state', 'unknown'), (h.get('text') or '') + ms)}</td></tr>"
    for key, u in (phone.get("units") or {}).items():
        txt = "%s/%s, restarts %s" % (u.get("active"), u.get("sub"), u.get("restarts"))
        t += f"<tr><td>{e(key)} unit</td><td>{dot('ok' if u.get('active') == 'active' else 'failed', txt)}</td></tr>"
    if sip.get("recording_files") is not None:
        t += f"<tr><td>call recordings in bridge</td><td>{dot('ok' if sip['recording_files'] == 0 else 'failed', str(sip['recording_files']))}</td></tr>"
    lc = phone.get("last_call_ts")
    if lc:
        when = datetime.fromtimestamp(lc, timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        t += f"<tr><td>last inbound call</td><td>{e(when)} ({e(phone.get('last_call_source'))})</td></tr>"
    else:
        t += "<tr><td>last inbound call</td><td class=\"neutral\">none seen yet</td></tr>"
    fa = phone.get("first_audio") or {}
    if fa.get("n"):
        t += (f"<tr><td>first audio, real turns (info only)</td><td>p50 {fa['p50']:.0f} ms, p95 {fa['p95']:.0f} ms over {fa['n']} turns "
              f"(target p50 {FIRST_AUDIO_TARGET_MS} ms)</td></tr>")
    vt = phone.get("voice_test") or {}
    if vt.get("state") == "absent":
        t += "<tr><td>nightly voice test</td><td class=\"neutral\">not set up yet (issue #1119)</td></tr>"
    elif vt.get("state") == "ok":
        t += f"<tr><td>nightly voice test</td><td>{dot('ok', str(vt.get('age_s', 0) // 3600) + ' h old')}</td></tr>"
    else:
        t += f"<tr><td>nightly voice test</td><td>{dot('unknown', vt.get('error', ''))}</td></tr>"
    sig = phone.get("signals") or {}
    if sig.get("state") == "absent":
        t += "<tr><td>firewall and call signals</td><td class=\"neutral\">producer not installed (owner step); these probes are off</td></tr>"
    elif "ufw" in sig:
        u = sig["ufw"]
        txt = "%s / %s" % (u.get("drops_1h", 0), u.get("drops_24h", 0))
        t += f"<tr><td>SIP-port firewall drops (1 h / 24 h)</td><td>{dot('ok' if not u.get('drops_1h') else 'failed', txt)}</td></tr>"
    costs = phone.get("costs") or {}
    if costs.get("state") == "ok":
        spend_cents = costs.get("spend_cents", 0.0)
        cap_cents = costs.get("cap_cents", 100000)
        pct = costs.get("ratio", 0.0) * 100
        txt = f"${spend_cents / 100:.2f} / ${cap_cents / 100:.2f} ({pct:.1f}%)"
        st = "failed" if costs.get("cap_exceeded") else ("warning" if costs.get("alert_80") else "ok")
        t += f"<tr><td>phone monthly spend</td><td>{dot(st, txt)}</td></tr>"
    return t + "</table>"


# ------------------------------------------------------------------ cli: the privileged signals producer
def _read_text(path: str) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def run_signals(out_path: Path, env, now: float | None = None, runner=_run, ufw_log: str = "/var/log/ufw.log") -> int:
    now = time.time() if now is None else now
    ports, cidrs = parse_ports(env.get("PHONE_SIP_PORTS")), parse_cidrs(env.get("PHONE_CARRIER_CIDRS", ""))
    ufw = _read_text(ufw_log)
    rc, journal = runner(["journalctl", "-u", AGENT_UNITS["agent"], "--since", "-7d", "-o", "short-iso", "--no-pager", "-q"], 60)
    doc = build_signals(ufw, journal if rc == 0 and journal.strip() else None, now, ports, cidrs)
    tmp = out_path.with_name(out_path.name + ".tmp")
    tmp.write_text(json.dumps(doc, sort_keys=True), encoding="utf-8")
    os.chmod(tmp, 0o644)
    os.replace(tmp, out_path)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("signals", help="write the sanitised signals file (needs read access to the ufw log and the journal)")
    s.add_argument("--out", default=DEFAULT_SIGNALS)
    sub.add_parser("print", help="print the phone snapshot as json (read-only probes as the current user)")
    a = p.parse_args(argv)
    if a.cmd == "signals":
        return run_signals(Path(a.out), dict(os.environ))
    print(json.dumps(collect_phone(dict(os.environ), time.time()), indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
