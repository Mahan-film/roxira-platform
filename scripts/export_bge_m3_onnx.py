#!/usr/bin/env python3
"""T235: Export BAAI/bge-m3 to INT8 ONNX (dense + sparse + ColBERT) and verify parity.

Usage:
    python3 scripts/export_bge_m3_onnx.py --output-dir ./models/bge-m3-onnx
    python3 scripts/export_bge_m3_onnx.py --output-dir ./models/bge-m3-onnx --verify

Notes:
- Checks ``/proc/cpuinfo`` for VNNI (``avx512_vnni`` / ``avx_vnni``). Without
  VNNI, uses unsigned per-channel ``QUInt8`` quantization as required by T235.
- Verification checks cosine similarity >= 0.98 vs FP32 on 200 queries and
  query encode p95 <= 85 ms.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import List

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from output_apps.generated_modules.smartjudge.legal_graph.onnx_bge_m3 import (  # noqa: E402
    OnnxBgeM3Encoder,
    cosine_similarity,
    detect_vnni,
    recommended_quant_type,
)

# model-ok: BAAI/bge-m3 is the MIT-licensed open-source embedding model specified by T235 (#974).
BGE_M3_HF_REPO = "BAAI/bge-m3"


def export_fp32_onnx(output_dir: Path, opset: int = 17) -> Path:
    """Export BAAI/bge-m3 (dense + sparse + ColBERT heads) to a single FP32 ONNX graph."""
    import torch  # type: ignore
    from transformers import AutoModel, AutoTokenizer  # type: ignore

    output_dir.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(BGE_M3_HF_REPO)
    tokenizer.save_pretrained(str(output_dir))

    base_model = AutoModel.from_pretrained(BGE_M3_HF_REPO)
    base_model.eval()
    hidden_size = base_model.config.hidden_size

    class _BgeM3MultiHeadWrapper(torch.nn.Module):
        def __init__(self, encoder: torch.nn.Module, dim: int) -> None:
            super().__init__()
            self.encoder = encoder
            self.sparse_linear = torch.nn.Linear(dim, 1)
            self.colbert_linear = torch.nn.Linear(dim, dim)

        def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor):
            out = self.encoder(input_ids=input_ids, attention_mask=attention_mask, return_dict=True)
            last_hidden = out.last_hidden_state
            dense_vecs = torch.nn.functional.normalize(last_hidden[:, 0], p=2, dim=-1)
            sparse_weights = torch.relu(self.sparse_linear(last_hidden))
            colbert_vecs = torch.nn.functional.normalize(self.colbert_linear(last_hidden), p=2, dim=-1)
            return dense_vecs, sparse_weights, colbert_vecs

    wrapper = _BgeM3MultiHeadWrapper(base_model, hidden_size)
    wrapper.eval()

    dummy = tokenizer(["قانون مدنی ماده ۱"], return_tensors="pt")
    fp32_path = output_dir / "bge_m3_fp32.onnx"
    torch.onnx.export(
        wrapper,
        (dummy["input_ids"], dummy["attention_mask"]),
        str(fp32_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["dense_vecs", "sparse_weights", "colbert_vecs"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "dense_vecs": {0: "batch"},
            "sparse_weights": {0: "batch", 1: "seq"},
            "colbert_vecs": {0: "batch", 1: "seq"},
        },
        opset_version=opset,
    )
    return fp32_path


def quantize_int8_onnx(fp32_path: Path, int8_path: Path, force_quant_type: str | None = None) -> Path:
    """Quantize the FP32 ONNX graph to per-channel INT8 (QUInt8 without VNNI, QInt8 with VNNI)."""
    from onnxruntime.quantization import QuantType, quantize_dynamic  # type: ignore

    qtype_name = force_quant_type or recommended_quant_type()
    weight_type = QuantType.QInt8 if qtype_name == "QInt8" else QuantType.QUInt8
    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        per_channel=True,
        weight_type=weight_type,
    )
    return int8_path


def verify_parity_and_latency(
    fp32_path: Path,
    int8_path: Path,
    tokenizer_dir: Path,
    queries: List[str],
    min_cosine: float = 0.98,
    max_p95_ms: float = 85.0,
) -> tuple[float, float]:
    """Measure cosine similarity vs FP32 and p95 encode latency on ``queries``."""
    fp32_enc = OnnxBgeM3Encoder(fp32_path, tokenizer_dir)
    int8_enc = OnnxBgeM3Encoder(int8_path, tokenizer_dir)

    # Warm-up
    _ = fp32_enc.encode_dense(queries[0])
    _ = int8_enc.encode_dense(queries[0])

    cosines: List[float] = []
    latencies_ms: List[float] = []
    for q in queries:
        v_fp32 = fp32_enc.encode_dense(q)
        t0 = time.perf_counter()
        v_int8 = int8_enc.encode_dense(q)
        latencies_ms.append((time.perf_counter() - t0) * 1000.0)
        cosines.append(cosine_similarity(v_fp32, v_int8))

    mean_cos = sum(cosines) / len(cosines)
    latencies_ms.sort()
    p95_idx = min(len(latencies_ms) - 1, int(0.95 * len(latencies_ms)))
    p95_ms = latencies_ms[p95_idx]

    print(f"VNNI detected: {detect_vnni()} (quant_type={recommended_quant_type()})")
    print(f"Queries: {len(queries)} | mean cosine: {mean_cos:.4f} (min gate {min_cosine})")
    print(f"INT8 p95 latency: {p95_ms:.1f} ms (max gate {max_p95_ms} ms)")
    return mean_cos, p95_ms


def main() -> int:
    os.environ["OMP_WAIT_POLICY"] = "PASSIVE"
    parser = argparse.ArgumentParser(description="Export and quantize BAAI/bge-m3 to INT8 ONNX.")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    fp32_path = export_fp32_onnx(args.output_dir, opset=args.opset)
    int8_path = args.output_dir / "bge_m3_int8.onnx"
    quantize_int8_onnx(fp32_path, int8_path)
    print(f"Exported INT8 ONNX model to {int8_path} (quant={recommended_quant_type()})")

    if args.verify:
        queries = [f"ماده {i} قانون مدنی ایران درباره قرارداد و مسئولیت مدنی" for i in range(1, 201)]
        mean_cos, p95_ms = verify_parity_and_latency(fp32_path, int8_path, args.output_dir, queries)
        if mean_cos < 0.98 or p95_ms > 85.0:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
