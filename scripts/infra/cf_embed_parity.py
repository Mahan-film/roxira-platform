#!/usr/bin/env python3
"""Parity check: Cloudflare Workers AI `@cf/baai/bge-m3` vs the TEI service.

Usage:
  python3 scripts/infra/cf_embed_parity.py parity sample.jsonl --n 50

Reads JSON lines with a "text" field, embeds the first ``--n`` texts through both backends
and exits 0 only if the minimum cosine across pairs is >= 0.999. Needs ``CF_ACCOUNT_ID``,
``CF_AI_TOKEN`` and ``EMBEDDING_URL`` in the environment; no token is ever printed.

The vector contract matches the app's Qdrant query path: BAAI/bge-m3, dense only, 1024
dims, L2-normalised (TEI is asked with ``normalize=true``). Offline tests live in
scripts/infra/tests/test_cf_embed_parity.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from modal_embed import ModalEmbedError, cosine, read_jsonl_texts, tei_embed

MODEL = "@cf/baai/bge-m3"
DIM = 1024
PARITY_MIN_COSINE = 0.999
CF_EMBED_URL_TEMPLATE = (
    "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/" + MODEL
)


class CFParityError(RuntimeError):
    pass


def _l2_normalise(vector: Sequence[float]) -> list[float]:
    norm = sum(float(x) * float(x) for x in vector) ** 0.5
    if norm <= 0.0:
        return [float(x) for x in vector]
    return [float(x) / norm for x in vector]


def _extract_vectors(payload: Any) -> list[list[float]]:
    """Pull vectors from a Workers AI response — accepts both ``data`` and ``response``.

    The docs are ambiguous, so both keys are checked inside ``result`` and at the top level.
    """
    if not isinstance(payload, dict):
        return []
    for container in (payload.get("result"), payload):
        if not isinstance(container, dict):
            continue
        for key in ("data", "response"):
            value = container.get(key)
            if isinstance(value, list) and all(isinstance(v, list) for v in value):
                return [[float(x) for x in v] for v in value]
    return []


def _cf_post_json(url: str, payload: dict, timeout: float, token: str) -> tuple[int, Any]:
    """Signed POST to Workers AI; returns ``(status, parsed)`` (mocked in tests)."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        status = int(getattr(response, "status", 200) or 200)
        raw = response.read().decode("utf-8") or "{}"
    return status, json.loads(raw)


def cf_embed(texts: Sequence[str]) -> list[list[float]]:
    """Embed texts through Cloudflare Workers AI (``@cf/baai/bge-m3``, L2-normalised)."""
    account = os.environ.get("CF_ACCOUNT_ID", "").strip()
    token = os.environ.get("CF_AI_TOKEN", "").strip()
    if not account or not token:
        raise CFParityError("CF_ACCOUNT_ID and CF_AI_TOKEN must be set in the environment")
    url = CF_EMBED_URL_TEMPLATE.format(account=account)
    timeout = float(os.environ.get("CF_EMBED_TIMEOUT", "30"))
    status, payload = _cf_post_json(url, {"text": list(texts)}, timeout, token)
    if status != 200:
        raise CFParityError(f"Workers AI returned HTTP {status}")
    vectors = _extract_vectors(payload)
    if len(vectors) != len(texts):
        raise CFParityError(f"expected {len(texts)} vectors, got {len(vectors)}")
    for vector in vectors:
        if len(vector) != DIM:
            raise CFParityError(f"expected {DIM} dims, got {len(vector)}")
    return [_l2_normalise(vector) for vector in vectors]


def report(
    texts: Sequence[str],
    cf_vecs: Sequence[Sequence[float]],
    tei_vecs: Sequence[Sequence[float]],
    threshold: float = PARITY_MIN_COSINE,
) -> dict:
    cos = [cosine(a, b) for a, b in zip(cf_vecs, tei_vecs, strict=False)]
    return {
        "model": MODEL,
        "n": len(cos),
        "min_cosine": min(cos) if cos else 0.0,
        "mean_cosine": (sum(cos) / len(cos)) if cos else 0.0,
        "threshold": threshold,
        "ok": bool(cos) and len(cos) == len(texts) and min(cos) >= threshold,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("parity")
    p.add_argument("jsonl", type=Path)
    p.add_argument("--text-field", default="text")
    p.add_argument("--n", type=int, default=50)
    args = ap.parse_args(argv)
    try:
        texts = read_jsonl_texts(args.jsonl, args.text_field)[: args.n]
        if not texts:
            raise CFParityError("no texts to compare")
        tei_url = os.environ.get("EMBEDDING_URL", "").strip()
        if not tei_url:
            raise CFParityError("parity needs EMBEDDING_URL (the TEI service)")
        result = report(texts, cf_embed(texts), tei_embed(texts, tei_url))
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1
    except (CFParityError, ModalEmbedError, OSError, ValueError) as exc:
        print(f"cf_embed_parity: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())