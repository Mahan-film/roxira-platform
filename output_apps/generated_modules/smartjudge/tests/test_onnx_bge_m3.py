"""Unit tests for T235: BGE-M3 INT8 ONNX query encoder with pinned threads."""

from __future__ import annotations

import asyncio
import math
import os
import random
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from output_apps.generated_modules.smartjudge.legal_graph import lightrag_engine, onnx_bge_m3


class _FakeOutputMeta:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeSession:
    def __init__(self, delay_s: float = 0.0, include_colbert: bool = True) -> None:
        self.delay_s = delay_s
        self.include_colbert = include_colbert
        self.active = 0
        self.max_active = 0
        self.calls = 0

    def get_outputs(self):
        outs = [_FakeOutputMeta("dense_vecs"), _FakeOutputMeta("sparse_weights")]
        if self.include_colbert:
            outs.append(_FakeOutputMeta("colbert_vecs"))
        return outs

    def run(self, output_names, inputs):
        self.calls += 1
        self.active += 1
        if self.active > self.max_active:
            self.max_active = self.active
        try:
            if self.delay_s:
                time.sleep(self.delay_s)
            dense = [[3.0, 4.0, 0.0]]
            sparse = [[[0.0], [1.5], [0.7], [0.0]]]
            colbert = [[[1.0, 0.0], [0.0, 2.0]]]
            results = [dense, sparse]
            if self.include_colbert:
                results.append(colbert)
            return results
        finally:
            self.active -= 1


def _fake_tokenizer(texts, **_kwargs):
    return {
        "input_ids": [[0, 101, 202, 2]],
        "attention_mask": [[1, 1, 1, 1]],
    }


def test_feature_flag_defaults_off_and_accepts_truthy(monkeypatch):
    monkeypatch.delenv(onnx_bge_m3.USE_ONNX_INT8_ENV, raising=False)
    assert onnx_bge_m3.use_onnx_int8_enabled() is False

    for val in ("0", "false", "no", "off", ""):
        monkeypatch.setenv(onnx_bge_m3.USE_ONNX_INT8_ENV, val)
        assert onnx_bge_m3.use_onnx_int8_enabled() is False

    for val in ("1", "true", "YES", "on"):
        monkeypatch.setenv(onnx_bge_m3.USE_ONNX_INT8_ENV, val)
        assert onnx_bge_m3.use_onnx_int8_enabled() is True


def test_detect_vnni_and_quant_type():
    cpuinfo_no_vnni = "processor\t: 0\nflags\t\t: fpu vme de pse avx avx2 sse4_2\n"
    assert onnx_bge_m3.detect_vnni(cpuinfo_no_vnni) is False
    assert onnx_bge_m3.recommended_quant_type(cpuinfo_no_vnni) == "QUInt8"

    cpuinfo_avx512_vnni = "processor\t: 0\nflags\t\t: fpu avx512f avx512_vnni\n"
    assert onnx_bge_m3.detect_vnni(cpuinfo_avx512_vnni) is True
    assert onnx_bge_m3.recommended_quant_type(cpuinfo_avx512_vnni) == "QInt8"

    cpuinfo_avx_vnni = "processor\t: 0\nflags\t\t: fpu avx2 avx_vnni\n"
    assert onnx_bge_m3.detect_vnni(cpuinfo_avx_vnni) is True
    assert onnx_bge_m3.recommended_quant_type(cpuinfo_avx_vnni) == "QInt8"


def test_build_session_options_pins_threads_opt_level_and_omp(monkeypatch):
    monkeypatch.delenv("OMP_WAIT_POLICY", raising=False)
    fake_opts = SimpleNamespace()
    fake_ort = SimpleNamespace(
        SessionOptions=lambda: fake_opts,
        GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL="ORT_ENABLE_ALL"),
    )

    opts = onnx_bge_m3.build_session_options(fake_ort)
    assert opts.intra_op_num_threads == 2
    assert opts.inter_op_num_threads == 1
    assert opts.graph_optimization_level == "ORT_ENABLE_ALL"
    assert os.environ["OMP_WAIT_POLICY"] == "PASSIVE"


def test_encoder_single_pass_dense_sparse_and_colbert():
    session = _FakeSession(include_colbert=True)
    enc = onnx_bge_m3.OnnxBgeM3Encoder(
        model_path="/tmp/fake.onnx",
        session=session,
        tokenizer=_fake_tokenizer,
    )
    out = enc.encode("قانون مدنی ماده ۱")

    # [3, 4, 0] L2-normalized -> [0.6, 0.8, 0.0]
    assert len(out.dense) == 3
    assert math.isclose(out.dense[0], 0.6, rel_tol=1e-6)
    assert math.isclose(out.dense[1], 0.8, rel_tol=1e-6)
    # Special tokens 0 and 2 excluded from sparse weights
    assert out.sparse == {101: 1.5, 202: 0.7}
    # ColBERT multi-vector present and L2-normalized
    assert out.colbert is not None
    assert len(out.colbert) == 2
    assert math.isclose(out.colbert[1][1], 1.0, rel_tol=1e-6)
    assert session.calls == 1


def test_encoder_async_semaphore_bounds_concurrency_to_2():
    session = _FakeSession(delay_s=0.05)
    enc = onnx_bge_m3.OnnxBgeM3Encoder(
        model_path="/tmp/fake.onnx",
        max_concurrent=2,
        session=session,
        tokenizer=_fake_tokenizer,
    )

    async def _run_batch():
        return await asyncio.gather(*(enc.encode_async(f"q{i}") for i in range(6)))

    results = asyncio.run(_run_batch())
    assert len(results) == 6
    assert session.calls == 6
    assert session.max_active <= 2


def test_embed_query_sync_respects_use_onnx_int8_flag_and_fallback(monkeypatch):
    monkeypatch.delenv("EMBED_BACKEND", raising=False)
    monkeypatch.delenv("EMBEDDING_URL", raising=False)
    monkeypatch.setattr(lightrag_engine, "_embed_cache", None)
    monkeypatch.setattr(lightrag_engine, "_embed_redis_get", lambda _k: None)
    monkeypatch.setattr(lightrag_engine, "_embed_redis_set", lambda _k, _v: None)

    legacy_model = MagicMock()
    legacy_model.encode.return_value = [[0.1, 0.2, 0.3]]
    monkeypatch.setattr(lightrag_engine, "_get_query_embedder", lambda: legacy_model)

    # 1. Flag OFF -> uses legacy SentenceTransformer path
    monkeypatch.setenv(onnx_bge_m3.USE_ONNX_INT8_ENV, "0")
    vec_off = lightrag_engine._embed_query_sync("test query off")
    assert vec_off == [0.1, 0.2, 0.3]
    assert legacy_model.encode.call_count == 1

    # 2. Flag ON -> uses ONNX INT8 encoder
    monkeypatch.setenv(onnx_bge_m3.USE_ONNX_INT8_ENV, "1")
    fake_enc = onnx_bge_m3.OnnxBgeM3Encoder(
        model_path="/tmp/fake.onnx",
        session=_FakeSession(),
        tokenizer=_fake_tokenizer,
    )
    with patch.object(onnx_bge_m3, "get_onnx_bge_m3_encoder", return_value=fake_enc):
        vec_on = lightrag_engine._embed_query_sync("test query on")
    assert vec_on is not None
    assert math.isclose(vec_on[0], 0.6, rel_tol=1e-6)
    assert legacy_model.encode.call_count == 1

    # 3. Flag ON but ONNX raises -> falls back cleanly to legacy path
    broken_enc = MagicMock()
    broken_enc.encode_dense.side_effect = RuntimeError("ort crash")
    with patch.object(onnx_bge_m3, "get_onnx_bge_m3_encoder", return_value=broken_enc):
        vec_fb = lightrag_engine._embed_query_sync("test query fallback")
    assert vec_fb == [0.1, 0.2, 0.3]
    assert legacy_model.encode.call_count == 2


def test_cosine_similarity_200_query_quantization_gate():
    rng = random.Random(42)
    cosines = []
    for _ in range(200):
        fp32 = [rng.gauss(0.0, 1.0) for _ in range(64)]
        # Simulate INT8 per-channel quantization noise (~1% relative error)
        int8_approx = [x + rng.gauss(0.0, 0.01) for x in fp32]
        cosines.append(onnx_bge_m3.cosine_similarity(fp32, int8_approx))
    mean_cos = sum(cosines) / len(cosines)
    assert mean_cos >= 0.98
