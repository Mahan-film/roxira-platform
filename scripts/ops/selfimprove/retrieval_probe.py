"""Runs INSIDE roxira_app_prod (piped via `docker exec -i ... python3 -`). Read-only, no LLM.

The runner prepends: `ecg` (scripts/eval_chat_golden.py loaded as a module) and SET_JSON
(retrieval_golden.json text). Prints one JSON line: per-case results + latency.
"""
import asyncio
import json
import time

from output_apps.generated_modules.smartjudge import source_filter
from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine as eng

_cases = json.loads(SET_JSON)["cases"]  # noqa: F821 - injected by the runner
_res, _lat = [], []
for _c in _cases:
    _t0 = time.perf_counter()
    try:
        _rows = asyncio.run(eng.qdrant_fallback_laws(_c["question"], limit=5))
        _kept = source_filter.filter_relevant(_rows)
        _ok = ecg.retrieval_hit(_c, _kept)  # noqa: F821
        _err = None
    except Exception as _e:  # noqa: BLE001
        _ok, _err = False, type(_e).__name__
    _ms = round((time.perf_counter() - _t0) * 1000)
    _lat.append(_ms)
    _res.append({"id": _c["id"], "hit": bool(_ok), "gap": bool(_c.get("corpus_gap")), "err": _err, "ms": _ms})
print("SI_RESULT " + json.dumps({"cases": _res}))
