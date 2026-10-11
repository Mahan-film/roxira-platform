"""Parse app log lines into latency / error statistics. Stdlib only; never keeps message text."""
import collections
import re

import metrics

STAGES = ("embed_ms", "qdrant_ms", "sql_ms", "retrieval_ms", "ttft_ms", "llm_ms", "total_ms")
_KV = re.compile(r"\b(" + "|".join(STAGES) + r")=(\d+(?:\.\d+)?)")
_KIND = re.compile(r"(?:^|\s)kind=([A-Za-z0-9_.-]{1,40})(?=\s|$)")
_KIND_OK = re.compile(r"[A-Za-z0-9_.-]{1,40}")


def parse(lines) -> dict:
    stage = {s: [] for s in STAGES}
    chats = unavailable = 0
    client = collections.Counter()
    for line in lines:
        if "[CHAT-TIMING]" in line:
            vals = {k: float(v) for k, v in _KV.findall(line)}
            if vals.get("total_ms", 0) <= 5:  # cached / rejected request, no real work
                continue
            chats += 1
            for s, v in vals.items():
                if v > 0:
                    stage[s].append(v)
        elif "[LLM-UNAVAILABLE]" in line:
            unavailable += 1
        elif "[CLIENT-ERROR]" in line:
            rest = line.split("[CLIENT-ERROR]", 1)[1]
            m = _KIND.search(rest)
            client[m.group(1) if m and _KIND_OK.fullmatch(m.group(1)) else "unknown"] += 1
    out = {"chats": chats, "llm_unavailable": unavailable, "client_errors": dict(client.most_common(10))}
    for s in STAGES:
        out[s + "_p50"] = metrics.percentile(stage[s], 50)
        out[s + "_p95"] = metrics.percentile(stage[s], 95)
    out["slow_over_20s"] = sum(1 for v in stage["total_ms"] if v > 20000)
    return out
