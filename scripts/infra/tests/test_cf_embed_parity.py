"""Offline tests for scripts/infra/cf_embed_parity.py. No network, no tokens.

Run only this file:
  python3 -m pytest scripts/infra/tests/test_cf_embed_parity.py -q
"""
import importlib.util
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


cf = _load("cf_embed_parity_t", "scripts/infra/cf_embed_parity.py")


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CF_AI_TOKEN", "EMBEDDING_URL", "CF_EMBED_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)
    yield


def test_extract_accepts_data_and_response():
    assert cf._extract_vectors({"result": {"data": [[1.0, 0.0]]}}) == [[1.0, 0.0]]
    assert cf._extract_vectors({"result": {"response": [[0.0, 1.0]]}}) == [[0.0, 1.0]]
    assert cf._extract_vectors({"data": [[2.0]]}) == [[2.0]]
    assert cf._extract_vectors({"result": {"response": "text"}}) == []


def _vec(*head):
    """A Cloudflare-sized (1024-dim) vector with ``head`` in the leading positions."""
    vector = [0.0] * cf.DIM
    for index, value in enumerate(head):
        vector[index] = float(value)
    return vector


def test_l2_normalise():
    assert cf._l2_normalise([3.0, 4.0]) == [0.6, 0.8]
    assert cf._l2_normalise([0.0, 0.0]) == [0.0, 0.0]


def test_cf_embed_missing_env_refuses():
    with pytest.raises(cf.CFParityError, match="CF_ACCOUNT_ID"):
        cf.cf_embed(["x"])


def test_cf_embed_calls_workers_ai(monkeypatch):
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_AI_TOKEN", "tok")
    calls = []

    def post(url, payload, timeout, token):
        calls.append((url, payload, timeout, token))
        return 200, {"result": {"data": [_vec(3.0, 4.0)]}}

    monkeypatch.setattr(cf, "_cf_post_json", post)
    result = cf.cf_embed(["q"])
    assert len(result[0]) == cf.DIM and result[0][:2] == [0.6, 0.8]
    url, payload, timeout, token = calls[0]
    assert "@cf/baai/bge-m3" in url and payload == {"text": ["q"]}
    assert timeout == 30 and token == "tok"


def test_cf_embed_rejects_http_error(monkeypatch):
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_AI_TOKEN", "tok")
    monkeypatch.setattr(cf, "_cf_post_json", lambda *a, **k: (500, {}))
    with pytest.raises(cf.CFParityError, match="HTTP 500"):
        cf.cf_embed(["q"])


def test_cf_embed_rejects_bad_dims(monkeypatch):
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_AI_TOKEN", "tok")
    monkeypatch.setattr(
        cf, "_cf_post_json", lambda *a, **k: (200, {"result": {"data": [[1.0, 2.0]]}})
    )
    with pytest.raises(cf.CFParityError, match="1024"):
        cf.cf_embed(["q"])


def test_report_threshold():
    good = [[1.0, 0.0]]
    assert cf.report(["x"], good, good)["ok"]
    near = [[math.cos(0.1), math.sin(0.1)]]
    assert cf.report(["x"], good, near)["ok"] is False


def test_cli_parity_pass_and_fail(tmp_path, monkeypatch, capsys):
    f = tmp_path / "sample.jsonl"
    f.write_text("\n".join(json.dumps({"text": f"ماده {i}"}) for i in range(5)), encoding="utf-8")
    monkeypatch.setenv("EMBEDDING_URL", "http://emb:80")
    vec = [0.0] * cf.DIM
    vec[0] = 1.0
    monkeypatch.setattr(cf, "cf_embed", lambda texts: [list(vec) for _ in texts])
    monkeypatch.setattr(cf, "tei_embed", lambda texts, url: [list(vec) for _ in texts])
    assert cf.main(["parity", str(f), "--n", "3"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] and report["n"] == 3

    bad = [list(vec)]
    bad[0][1] = 0.5  # cosine well below 0.999
    monkeypatch.setattr(cf, "cf_embed", lambda texts: [list(bad[0]) for _ in texts])
    assert cf.main(["parity", str(f), "--n", "3"]) == 1


def test_cli_requires_embedding_url(tmp_path, monkeypatch):
    f = tmp_path / "sample.jsonl"
    f.write_text(json.dumps({"text": "x"}), encoding="utf-8")
    assert cf.main(["parity", str(f)]) == 2