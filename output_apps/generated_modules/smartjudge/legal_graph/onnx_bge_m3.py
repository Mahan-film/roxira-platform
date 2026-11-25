"""T235: BGE-M3 INT8 ONNX query encoder with pinned CPU threads.

Provides an opt-in (``USE_ONNX_INT8=1``) ONNX Runtime query encoder for
``BAAI/bge-m3`` that emits dense, sparse (lexical weights), and optional
ColBERT multi-vector representations in a single forward pass.

Design invariants (from R18 / issue #974):
- Feature flag ``USE_ONNX_INT8`` defaults to OFF; when off, callers use the
  existing query embedding path with zero behaviour change.
- ONNX Runtime is pinned to ``intra_op_num_threads=2``,
  ``inter_op_num_threads=1``, ``ORT_ENABLE_ALL``, and
  ``OMP_WAIT_POLICY=PASSIVE``.
- Concurrent async inference is bounded by ``asyncio.Semaphore(2)``.
- ``/proc/cpuinfo`` is checked for VNNI (``avx512_vnni`` / ``avx_vnni``):
  without VNNI, unsigned per-channel ``QUInt8`` quantization is selected.
- Runtime dependencies (``onnxruntime``, ``tokenizers`` / ``transformers``,
  ``numpy``) are imported lazily so unit tests and environments without ONNX
  Runtime continue to import and run cleanly.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

USE_ONNX_INT8_ENV = "USE_ONNX_INT8"
ONNX_BGE_M3_MODEL_PATH_ENV = "ONNX_BGE_M3_MODEL_PATH"
ONNX_BGE_M3_TOKENIZER_DIR_ENV = "ONNX_BGE_M3_TOKENIZER_DIR"

DEFAULT_INTRA_OP_THREADS = 2
DEFAULT_INTER_OP_THREADS = 1
DEFAULT_MAX_CONCURRENT_INFERENCE = 2
DEFAULT_MAX_LENGTH = 512

_VNNI_FLAGS = frozenset({"avx512_vnni", "avx_vnni"})


def use_onnx_int8_enabled() -> bool:
    """Return True only when ``USE_ONNX_INT8`` is explicitly enabled (default: False)."""
    return os.environ.get(USE_ONNX_INT8_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def detect_vnni(cpuinfo_text: Optional[str] = None) -> bool:
    """Return True if the host CPU advertises AVX-VNNI or AVX512-VNNI in ``/proc/cpuinfo``.

    On non-Linux hosts or when ``/proc/cpuinfo`` is unavailable, returns False
    so quantization fails safe to unsigned per-channel ``QUInt8``.
    """
    if cpuinfo_text is None:
        cpuinfo_path = Path("/proc/cpuinfo")
        if not cpuinfo_path.is_file():
            return False
        try:
            cpuinfo_text = cpuinfo_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return False

    for line in cpuinfo_text.splitlines():
        if line.lower().startswith("flags"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                flags = set(parts[1].strip().lower().split())
                if flags & _VNNI_FLAGS:
                    return True
    return False


def recommended_quant_type(cpuinfo_text: Optional[str] = None) -> str:
    """Return ``'QInt8'`` on VNNI-capable CPUs, otherwise ``'QUInt8'`` (unsigned per-channel)."""
    return "QInt8" if detect_vnni(cpuinfo_text) else "QUInt8"


def _l2_normalize(vec: Sequence[float]) -> List[float]:
    norm_sq = sum(float(x) * float(x) for x in vec)
    if norm_sq <= 0.0:
        return [float(x) for x in vec]
    inv_norm = 1.0 / math.sqrt(norm_sq)
    return [float(x) * inv_norm for x in vec]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Compute cosine similarity between two equal-length float vectors."""
    if len(a) != len(b) or not a:
        raise ValueError(f"Vector length mismatch or empty: {len(a)} vs {len(b)}")
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        fx = float(x)
        fy = float(y)
        dot += fx * fy
        na += fx * fx
        nb += fy * fy
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


@dataclass(frozen=True)
class BgeM3OnnxOutput:
    """Single-pass output of the BGE-M3 ONNX encoder."""

    dense: List[float]
    sparse: Dict[int, float] = field(default_factory=dict)
    colbert: Optional[List[List[float]]] = None


def build_session_options(
    ort_module: Any = None,
    *,
    intra_op_num_threads: int = DEFAULT_INTRA_OP_THREADS,
    inter_op_num_threads: int = DEFAULT_INTER_OP_THREADS,
) -> Any:
    """Build pinned ONNX Runtime ``SessionOptions`` and ensure ``OMP_WAIT_POLICY=PASSIVE``."""
    os.environ["OMP_WAIT_POLICY"] = "PASSIVE"
    if ort_module is None:
        import onnxruntime as ort_module  # type: ignore

    opts = ort_module.SessionOptions()
    opts.intra_op_num_threads = intra_op_num_threads
    opts.inter_op_num_threads = inter_op_num_threads
    opts.graph_optimization_level = ort_module.GraphOptimizationLevel.ORT_ENABLE_ALL
    return opts


class OnnxBgeM3Encoder:
    """Thread-pinned INT8 ONNX Runtime encoder for BAAI/bge-m3 (dense + sparse + ColBERT)."""

    def __init__(
        self,
        model_path: str | Path,
        tokenizer_dir: Optional[str | Path] = None,
        *,
        intra_op_num_threads: int = DEFAULT_INTRA_OP_THREADS,
        inter_op_num_threads: int = DEFAULT_INTER_OP_THREADS,
        max_concurrent: int = DEFAULT_MAX_CONCURRENT_INFERENCE,
        max_length: int = DEFAULT_MAX_LENGTH,
        session: Any = None,
        tokenizer: Any = None,
    ) -> None:
        self.model_path = Path(model_path)
        self.tokenizer_dir = Path(tokenizer_dir) if tokenizer_dir else self.model_path.parent
        self.intra_op_num_threads = intra_op_num_threads
        self.inter_op_num_threads = inter_op_num_threads
        self.max_concurrent = max_concurrent
        self.max_length = max_length

        self._session = session
        self._tokenizer = tokenizer
        self._init_lock = threading.Lock()
        self._semaphores: Dict[int, asyncio.Semaphore] = {}

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Return an ``asyncio.Semaphore(max_concurrent)`` bound to the active event loop."""
        loop = asyncio.get_running_loop()
        loop_id = id(loop)
        sem = self._semaphores.get(loop_id)
        if sem is None:
            sem = asyncio.Semaphore(self.max_concurrent)
            self._semaphores[loop_id] = sem
        return sem

    def _ensure_loaded(self) -> None:
        if self._session is not None and self._tokenizer is not None:
            return
        with self._init_lock:
            if self._session is None:
                import onnxruntime as ort  # type: ignore

                opts = build_session_options(
                    ort,
                    intra_op_num_threads=self.intra_op_num_threads,
                    inter_op_num_threads=self.inter_op_num_threads,
                )
                self._session = ort.InferenceSession(
                    str(self.model_path),
                    sess_options=opts,
                    providers=["CPUExecutionProvider"],
                )
            if self._tokenizer is None:
                from transformers import AutoTokenizer  # type: ignore

                self._tokenizer = AutoTokenizer.from_pretrained(
                    str(self.tokenizer_dir),
                    trust_remote_code=False,
                    local_files_only=True,
                )

    def _tokenize(self, text: str) -> Dict[str, Any]:
        encoded = self._tokenizer(
            [text],
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="np",
        )
        return {
            "input_ids": encoded["input_ids"],
            "attention_mask": encoded["attention_mask"],
        }

    @staticmethod
    def _extract_sparse(
        input_ids: Any,
        attention_mask: Any,
        sparse_weights: Any,
    ) -> Dict[int, float]:
        """Extract positive lexical weights keyed by token id (skipping CLS/SEP/PAD)."""
        ids_row = input_ids[0].tolist() if hasattr(input_ids[0], "tolist") else list(input_ids[0])
        mask_row = (
            attention_mask[0].tolist()
            if hasattr(attention_mask[0], "tolist")
            else list(attention_mask[0])
        )
        weights_row = (
            sparse_weights[0].tolist()
            if hasattr(sparse_weights[0], "tolist")
            else list(sparse_weights[0])
        )
        lexical: Dict[int, float] = {}
        for tok_id, mask_val, raw_w in zip(ids_row, mask_row, weights_row):
            if not mask_val:
                continue
            w = float(raw_w[0] if isinstance(raw_w, (list, tuple)) else raw_w)
            if w <= 0.0:
                continue
            tid = int(tok_id)
            if tid in (0, 1, 2):  # XLM-R special tokens: <s>, <pad>, </s>
                continue
            prev = lexical.get(tid)
            if prev is None or w > prev:
                lexical[tid] = w
        return lexical

    def encode(self, text: str) -> BgeM3OnnxOutput:
        """Synchronously encode a single query into dense + sparse (+ optional ColBERT)."""
        self._ensure_loaded()
        inputs = self._tokenize(text)
        output_names = [out.name for out in self._session.get_outputs()]
        raw_outputs = self._session.run(output_names, inputs)
        by_name = dict(zip(output_names, raw_outputs))

        dense_arr = by_name.get("dense_vecs")
        if dense_arr is None:
            dense_arr = raw_outputs[0]
        dense_row = dense_arr[0].tolist() if hasattr(dense_arr[0], "tolist") else list(dense_arr[0])
        dense = _l2_normalize(dense_row)

        sparse: Dict[int, float] = {}
        sparse_arr = by_name.get("sparse_weights")
        if sparse_arr is None:
            sparse_arr = by_name.get("lexical_weights")
        if sparse_arr is not None:
            sparse = self._extract_sparse(
                inputs["input_ids"],
                inputs["attention_mask"],
                sparse_arr,
            )

        colbert: Optional[List[List[float]]] = None
        colbert_arr = by_name.get("colbert_vecs")
        if colbert_arr is not None:
            c_row = colbert_arr[0].tolist() if hasattr(colbert_arr[0], "tolist") else list(colbert_arr[0])
            colbert = [_l2_normalize(tok_vec) for tok_vec in c_row]

        return BgeM3OnnxOutput(dense=dense, sparse=sparse, colbert=colbert)

    def encode_dense(self, text: str) -> List[float]:
        """Return only the L2-normalized dense query vector."""
        return self.encode(text).dense

    async def encode_async(self, text: str) -> BgeM3OnnxOutput:
        """Asynchronously encode a query, bounded by ``asyncio.Semaphore(2)``."""
        sem = self._get_semaphore()
        async with sem:
            return await asyncio.to_thread(self.encode, text)


_encoder_lock = threading.Lock()
_encoder_instance: Optional[OnnxBgeM3Encoder] = None
_encoder_failed = False


def reset_onnx_encoder_cache() -> None:
    """Reset the module-level singleton (intended for tests)."""
    global _encoder_instance, _encoder_failed
    with _encoder_lock:
        _encoder_instance = None
        _encoder_failed = False


def get_onnx_bge_m3_encoder() -> Optional[OnnxBgeM3Encoder]:
    """Return the singleton ``OnnxBgeM3Encoder`` when ``USE_ONNX_INT8`` is on and configured."""
    global _encoder_instance, _encoder_failed
    if not use_onnx_int8_enabled():
        return None
    if _encoder_instance is not None:
        return _encoder_instance
    if _encoder_failed:
        return None

    model_path_str = os.environ.get(ONNX_BGE_M3_MODEL_PATH_ENV, "").strip()
    if not model_path_str:
        logger.warning(
            "%s is enabled but %s is not set; falling back to legacy embedder",
            USE_ONNX_INT8_ENV,
            ONNX_BGE_M3_MODEL_PATH_ENV,
        )
        return None

    model_path = Path(model_path_str)
    if not model_path.is_file():
        logger.warning(
            "ONNX BGE-M3 model file not found at %s; falling back to legacy embedder",
            model_path,
        )
        return None

    tokenizer_dir = os.environ.get(ONNX_BGE_M3_TOKENIZER_DIR_ENV, "").strip() or None
    with _encoder_lock:
        if _encoder_instance is not None:
            return _encoder_instance
        try:
            _encoder_instance = OnnxBgeM3Encoder(
                model_path=model_path,
                tokenizer_dir=tokenizer_dir,
            )
            return _encoder_instance
        except Exception as exc:  # noqa: BLE001
            _encoder_failed = True
            logger.warning("Failed to initialize OnnxBgeM3Encoder: %s", exc)
            return None


__all__ = [
    "BgeM3OnnxOutput",
    "DEFAULT_INTER_OP_THREADS",
    "DEFAULT_INTRA_OP_THREADS",
    "DEFAULT_MAX_CONCURRENT_INFERENCE",
    "ONNX_BGE_M3_MODEL_PATH_ENV",
    "ONNX_BGE_M3_TOKENIZER_DIR_ENV",
    "OnnxBgeM3Encoder",
    "USE_ONNX_INT8_ENV",
    "build_session_options",
    "cosine_similarity",
    "detect_vnni",
    "get_onnx_bge_m3_encoder",
    "recommended_quant_type",
    "reset_onnx_encoder_cache",
    "use_onnx_int8_enabled",
]
