"""Runs INSIDE roxira_app_prod (piped after anonymise.py). Read-only SELECT of the last 24 h.

Prints one JSON line `SI_TURNS [...]` of ANONYMISED turns only; raw text never leaves this
process. Uses a read-only transaction. Only logged-in users' chats are stored by the app.
"""
import json
import os
import re

import psycopg

_HOURS = int(os.environ.get("SI_HOURS", "24"))
_LIMIT = int(os.environ.get("SI_LIMIT", "400"))
_NOT_FOUND = re.compile(r"در\s*منابع\s*(?:موجود\s*)?(?:یافت|پیدا)\s*نشد")
_dsn = "host=%s port=%s dbname=%s user=%s password=%s" % tuple(
    os.environ.get(k, "") for k in ("POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"))
_SQL = """
SELECT u.content, a.content, a.metadata, u.created_at
FROM chat_messages u
JOIN LATERAL (
  SELECT m.content, m.metadata FROM chat_messages m
  WHERE m.conversation_id = u.conversation_id AND m.role = 'assistant' AND m.created_at >= u.created_at
  ORDER BY m.created_at LIMIT 1) a ON TRUE
WHERE u.role = 'user' AND u.created_at > now() - make_interval(hours => %s)
ORDER BY u.created_at DESC LIMIT %s
"""
_out = []
with psycopg.connect(_dsn) as _c:
    _c.read_only = True
    with _c.cursor() as _cur:
        _cur.execute("SET TRANSACTION READ ONLY")
        _cur.execute(_SQL, (_HOURS, _LIMIT))
        for _q, _a, _meta, _ts in _cur.fetchall():
            _meta = _meta if isinstance(_meta, dict) else {}
            _laws = _meta.get("laws") if isinstance(_meta.get("laws"), list) else []
            _prec = _meta.get("precedents") if isinstance(_meta.get("precedents"), list) else []
            _norm = re.sub(r"[\u200c\s]+", " ", str(_a or ""))
            _out.append({"q": anonymise_text(_q, 300),  # noqa: F821 - defined by anonymise.py above
                         "hour": _ts.strftime("%H"), "answer_len": len(str(_a or "")),
                         "sources": len(_laws) + len(_prec), "laws": len(_laws),
                         "not_found": bool(_NOT_FOUND.search(_norm))})
print("SI_TURNS " + json.dumps(_out, ensure_ascii=False))
