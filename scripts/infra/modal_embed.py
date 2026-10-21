#!/usr/bin/env python3
"""Batch BAAI/bge-m3 embeddings on a Modal GPU, a drop-in for the TEI service in corpus builds.

Optional and inert: nothing runs unless the build is started with EMBED_BACKEND=modal
(scripts/legal/ingest_pipeline.py::default_embed calls embed_texts below). The default backend
stays TEI (roxira_embeddings).

Vector contract (must equal TEI so vectors can mix in one Qdrant collection):
  * model BAAI/bge-m3, dense only, 1024 dims, CLS pooling, L2-normalised.
  * TEI side: scripts/legal/ingest_pipeline.py::_embed_http posts {"inputs": [...], "normalize": true}
    to roxira_embeddings (docker-compose.prod.yml: --model-id BAAI/bge-m3, no truncation override).
  * Modal side: sentence-transformers BAAI/bge-m3 with normalize_embeddings=True, the same call the
    local fallback in ingest_pipeline.default_embed uses. fp32 by default; MODAL_EMBED_FP16=1 is
    opt-in only after the parity check below passes.
  * Gate: `parity` must report min cosine >= 0.999 on 50 articles (docs/infra/MODAL_EMBED_PARITY.md).

Env:
  MODAL_TOKEN_ID / MODAL_TOKEN_SECRET   read by the Modal SDK from the environment, never from code
  MODAL_EMBED_MAX_ROWS   hard cap of rows per process/run (default 20000); beyond it -> refuse
  MODAL_GPU              default T4
  MODAL_GPU_USD_PER_HOUR price used by `estimate` (default 0.59 for T4; check modal.com/pricing)
  MODAL_EMBED_ROWS_PER_SEC assumed throughput for `estimate` (default 40, deliberately pessimistic)

CLI (dry-run is the default for `embed`):
  python3 scripts/infra/modal_embed.py estimate rows.jsonl
  python3 scripts/infra/modal_embed.py embed rows.jsonl --out vectors.jsonl [--apply]
  python3 scripts/infra/modal_embed.py parity rows.jsonl --n 50        # needs EMBEDDING_URL + tokens
Rows are JSON lines with a "text" field (override with --text-field).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable, Iterable, Optional, Sequence

MODEL = "BAAI/bge-m3"  # embedding model, not a chat model; same id as LIGHTRAG_QDRANT_EMBED_MODEL
DIM = 1024
BATCH = 64            # matches ingest_pipeline.apply_rows(batch=64): one remote call per upsert batch
DEFAULT_MAX_ROWS = 20000
DEFAULT_GPU = "T4"
COLD_START_SECONDS = 120
PARITY_MIN_COSINE = 0.999


class ModalEmbedError(RuntimeError):
    pass


# --------------------------------------------------------------------------- pure helpers

def max_rows(env: Optional[dict] = None) -> int:
    env = os.environ if env is None else env
    try:
        value = int(env.get("MODAL_EMBED_MAX_ROWS", DEFAULT_MAX_ROWS))
    except ValueError as exc:
        raise ModalEmbedError("MODAL_EMBED_MAX_ROWS must be an integer") from exc
    if value <= 0:
        raise ModalEmbedError("MODAL_EMBED_MAX_ROWS must be positive")
    return value


def estimate(n_rows: int, env: Optional[dict] = None) -> dict:
    env = os.environ if env is None else env
    rps = float(env.get("MODAL_EMBED_ROWS_PER_SEC", 40))
    usd_h = float(env.get("MODAL_GPU_USD_PER_HOUR", 0.59))
    seconds = COLD_START_SECONDS + n_rows / rps
    return {
        "rows": n_rows,
        "max_rows": max_rows(env),
        "within_cap": n_rows <= max_rows(env),
        "gpu": env.get("MODAL_GPU", DEFAULT_GPU),
        "est_seconds": round(seconds),
        "est_usd": round(seconds / 3600 * usd_h, 4),
        "assumptions": {"rows_per_sec": rps, "usd_per_hour": usd_h, "cold_start_s": COLD_START_SECONDS},
    }


def read_jsonl_texts(path: Path, text_field: str = "text") -> list[str]:
    out: list[str] = []
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            text = row.get(text_field)
            if not isinstance(text, str) or not text.strip():
                raise ModalEmbedError(f"{path}:{lineno}: missing non-empty {text_field!r}")
            out.append(text)
    return out


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def check_vectors(vectors: list[list[float]], n_expected: int) -> None:
    if len(vectors) != n_expected:
        raise ModalEmbedError(f"expected {n_expected} vectors, got {len(vectors)}")
    for v in vectors:
        if len(v) != DIM:
            raise ModalEmbedError(f"expected {DIM} dims, got {len(v)}")
        if abs(math.sqrt(sum(x * x for x in v)) - 1.0) > 1e-3:
            raise ModalEmbedError("vector is not L2-normalised")


# --------------------------------------------------------------------------- local driver

_rows_done = 0  # per-process counter for the cost guard
Runner = Callable[[list[str]], list[list[float]]]
_runner: Optional[Runner] = None


def _default_runner() -> Runner:
    """Start the Modal app once per process and return a function that embeds one batch."""
    if not (os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET")):
        raise ModalEmbedError("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET must be set in the environment")
    if modal is None:
        raise ModalEmbedError("the modal SDK is not installed (pip install 'modal>=1.0')")
    import atexit

    ctx = app.run()
    ctx.__enter__()
    atexit.register(lambda: ctx.__exit__(None, None, None))
    embedder = Embedder()
    return lambda batch: embedder.embed.remote(batch)


def embed_texts(texts: Sequence[str], *, runner: Optional[Runner] = None, batch: int = BATCH) -> list[list[float]]:
    """Embed texts on Modal in batches. Raises ModalEmbedError past the per-run row cap."""
    global _rows_done, _runner
    cap = max_rows()
    if _rows_done + len(texts) > cap:
        raise ModalEmbedError(
            f"cost guard: {_rows_done + len(texts)} rows would exceed MODAL_EMBED_MAX_ROWS={cap}; "
            "raise the cap deliberately or split the run"
        )
    if runner is None:
        if _runner is None:
            _runner = _default_runner()
        runner = _runner
    out: list[list[float]] = []
    for start in range(0, len(texts), batch):
        chunk = list(texts[start:start + batch])
        vectors = runner(chunk)
        check_vectors(vectors, len(chunk))
        out.extend([[float(x) for x in v] for v in vectors])
        _rows_done += len(chunk)
    return out


def tei_embed(texts: Sequence[str], url: str) -> list[list[float]]:
    """Reference vectors from TEI, identical request to ingest_pipeline._embed_http (batches of 4)."""
    out: list[list[float]] = []
    for start in range(0, len(texts), 4):
        body = json.dumps({"inputs": list(texts[start:start + 4]), "normalize": True}).encode()
        req = urllib.request.Request(url.rstrip("/") + "/embed", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            out.extend([[float(x) for x in v] for v in json.loads(resp.read())])
    return out


def parity(texts: Sequence[str], modal_vecs: list[list[float]], tei_vecs: list[list[float]],
           threshold: float = PARITY_MIN_COSINE) -> dict:
    cos = [cosine(a, b) for a, b in zip(modal_vecs, tei_vecs)]
    return {"n": len(cos), "min_cosine": min(cos), "mean_cosine": sum(cos) / len(cos),
            "threshold": threshold, "ok": len(cos) == len(texts) and min(cos) >= threshold}


# --------------------------------------------------------------------------- Modal side

try:  # the SDK is only needed for real runs; tests and TEI-only hosts never import it
    import modal
except ImportError:  # pragma: no cover - depends on environment
    modal = None  # type: ignore[assignment]

if modal is not None:
    _GPU = os.environ.get("MODAL_GPU", DEFAULT_GPU)
    _FP16 = os.environ.get("MODAL_EMBED_FP16") == "1"

    def _download_model() -> None:
        from sentence_transformers import SentenceTransformer
        SentenceTransformer(MODEL)

    app = modal.App("roxira-bge-m3-embed")
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install("sentence-transformers>=3,<6", "torch")
        .run_function(_download_model)  # weights baked into the image: no download per cold start
    )

    @app.cls(image=image, gpu=_GPU, timeout=3600, scaledown_window=120, max_containers=1)
    class Embedder:  # max_containers=1 caps spend: one GPU at a time
        @modal.enter()
        def load(self) -> None:
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(MODEL, device="cuda")
            self.model.max_seq_length = 8192  # bge-m3 limit; TEI does not truncate either
            if _FP16:
                self.model.half()

        @modal.method()
        def embed(self, texts: list[str]) -> list[list[float]]:
            vecs = self.model.encode(texts, normalize_embeddings=True, batch_size=32)
            return [[float(x) for x in v] for v in vecs]


# --------------------------------------------------------------------------- CLI

def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("estimate", "embed", "parity"):
        p = sub.add_parser(name)
        p.add_argument("jsonl", type=Path)
        p.add_argument("--text-field", default="text")
        if name == "embed":
            p.add_argument("--out", type=Path, required=True)
            p.add_argument("--apply", action="store_true", help="really call Modal (default: dry-run estimate)")
        if name == "parity":
            p.add_argument("--n", type=int, default=50)
    args = ap.parse_args(argv)
    try:
        texts = read_jsonl_texts(args.jsonl, args.text_field)
        if args.cmd == "estimate" or (args.cmd == "embed" and not args.apply):
            print(json.dumps(estimate(len(texts)), indent=2))
            if args.cmd == "embed":
                print("dry-run: nothing sent to Modal; add --apply")
            return 0 if estimate(len(texts))["within_cap"] else 1
        if args.cmd == "embed":
            started = time.monotonic()
            vectors = embed_texts(texts)
            with args.out.open("w", encoding="utf-8") as fh:
                for v in vectors:
                    fh.write(json.dumps(v) + "\n")
            print(f"embedded {len(vectors)} rows in {time.monotonic() - started:.0f}s -> {args.out}")
            return 0
        tei_url = os.environ.get("EMBEDDING_URL", "").strip()
        if not tei_url:
            raise ModalEmbedError("parity needs EMBEDDING_URL (the TEI service)")
        sample = texts[: args.n]
        report = parity(sample, embed_texts(sample), tei_embed(sample, tei_url))
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] else 1
    except (ModalEmbedError, OSError, ValueError) as exc:
        print(f"modal_embed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
