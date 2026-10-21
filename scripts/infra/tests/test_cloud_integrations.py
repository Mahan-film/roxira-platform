"""Offline tests for scripts/infra/qdrant_replica.py and scripts/infra/modal_embed.py.

No network, no Docker, no Modal SDK. Run only this file:
  python3 -m pytest scripts/infra/tests/test_cloud_integrations.py -q
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


rep = _load("qdrant_replica_t", "scripts/infra/qdrant_replica.py")
me = _load("modal_embed_t", "scripts/infra/modal_embed.py")


# ------------------------------------------------------------------ qdrant_replica

def _unit(i):
    v = [0.0] * 4
    v[i % 4] = 1.0
    return v


class FakeQdrant:
    """In-memory stand-in for one Qdrant: ids -> vectors, brute-force cosine search."""

    def __init__(self, points):
        self.points = dict(points)
        self.snapshots = []

    def handle(self, method, path, body):
        if path.endswith("/points/count"):
            return {"result": {"count": len(self.points)}}
        if path.endswith("/points/scroll"):
            pts = [{"id": k, "vector": v} for k, v in list(self.points.items())[: body["limit"]]]
            return {"result": {"points": pts}}
        if path.endswith("/points/search"):
            q = body["vector"]
            ranked = sorted(self.points, key=lambda k: (-sum(a * b for a, b in zip(self.points[k], q)), str(k)))
            return {"result": [{"id": k} for k in ranked[: body["limit"]]]}
        if method == "POST" and "/snapshots" in path:
            self.snapshots.append("snap1.snapshot")
            return {"result": {"name": "snap1.snapshot"}}
        if method == "DELETE" and "/snapshots/" in path:
            self.snapshots.clear()
            return {"result": True}
        raise AssertionError((method, path))


def _api(local, cloud):
    def api(ep, method, path, body=None, timeout=None):
        return (local if ep.base.startswith("http://local") else cloud).handle(method, path, body)
    return api


def _eps():
    return rep.Endpoint("http://local:6333"), rep.Endpoint("https://c.cloud.qdrant.io:6333", "KEY-SECRET", require_https=True)


def test_replicate_ok_and_local_snapshot_deleted(tmp_path):
    pts = {i: _unit(i) for i in range(8)}
    local, cloud = FakeQdrant(pts), FakeQdrant({})
    lep, cep = _eps()

    def upload(ep, coll, path):  # the real upload would restore the snapshot in the cloud
        cloud.points = dict(local.points)

    report = rep.replicate(_api(local, cloud), lep, cep, "iran_laws_v3", 5, tmp_path,
                           download=lambda ep, c, n, dest: (dest.write_bytes(b"x"), 1)[1], upload=upload)
    assert report["ok"] and report["local_count"] == report["cloud_count"] == 8
    assert report["samples"] == 5 and report["sample_mismatches"] == 0
    assert local.snapshots == []
    assert not any(tmp_path.iterdir())


def test_verify_detects_count_and_search_drift():
    pts = {i: _unit(i) for i in range(4)}
    lep, cep = _eps()
    assert rep.verify(_api(FakeQdrant(pts), FakeQdrant({0: _unit(0)})), lep, cep, "c", 3)["ok"] is False
    drifted = {i: _unit(i + 1) for i in range(4)}  # same count, different vectors per id
    r = rep.verify(_api(FakeQdrant(pts), FakeQdrant(drifted)), lep, cep, "c", 4)
    assert r["count_ok"] and r["sample_mismatches"] > 0 and r["ok"] is False


def test_inert_without_cloud_url(capsys):
    assert rep.main(["--apply"], env={}) == 0
    assert "inert" in capsys.readouterr().out


def test_dry_run_is_read_only(capsys):
    local, cloud = FakeQdrant({1: _unit(1)}), FakeQdrant({})
    env = {"QDRANT_CLOUD_URL": "https://c.cloud.qdrant.io:6333", "QDRANT_CLOUD_API_KEY": "KEY-SECRET",
           "QDRANT_LOCAL_URL": "http://local:6333"}
    assert rep.main(["--dry-run"], env=env, api=_api(local, cloud)) == 0
    out = capsys.readouterr().out
    assert "iran_laws_v3" in out and "KEY-SECRET" not in out
    assert local.snapshots == []


def test_rejects_http_cloud_and_bad_collection_and_hides_key():
    assert rep.main(["--apply"], env={"QDRANT_CLOUD_URL": "http://x:6333"}) == 2
    with pytest.raises(rep.ReplicaError):
        rep.collections_from_env({"QDRANT_REPLICA_COLLECTIONS": "a;drop"})
    assert "KEY-SECRET" not in repr(_eps()[1])


def test_multipart_body_length_matches(tmp_path):
    f = tmp_path / "s.snapshot"
    f.write_bytes(b"A" * 3_000_000)
    body = rep._MultipartFile(f, "bnd")
    total = 0
    while chunk := body.read(65536):
        total += len(chunk)
    body.close()
    assert total == body.length


# ---- multiple spare cloud accounts -----------------------------------------------------------------

def _cloud_urls(n_extra):
    return ["https://c1.cloud.qdrant.io:6333"] + [
        f"https://c{i}.cloud.qdrant.io:6333" for i in range(2, 2 + n_extra)
    ]


def _cloud_env(urls, local="http://local:6333"):
    env = {"QDRANT_LOCAL_URL": local}
    for i, url in enumerate(urls, start=1):
        suffix = "" if i == 1 else f"_{i}"
        env[f"QDRANT_CLOUD_URL{suffix}"] = url
        env[f"QDRANT_CLOUD_API_KEY{suffix}"] = f"K{i}"
    return env


def _multi_api(mapping):
    def api(ep, method, path, body=None, timeout=None):
        return mapping[ep.base].handle(method, path, body)

    return api


def _cloud_mapping(urls, cloud_points, local_points):
    mapping = {"http://local:6333": FakeQdrant(local_points)}
    for url, pts in zip(urls, cloud_points):
        mapping[url] = FakeQdrant(pts)
    return _multi_api(mapping)


def test_cloud_endpoints_zero_one_and_three_extra():
    base = {"QDRANT_CLOUD_URL": "https://c1.cloud.qdrant.io:6333", "QDRANT_CLOUD_API_KEY": "K1"}
    assert [label for label, _ in rep.cloud_endpoints_from_env(base)] == ["qdrant-cloud"]
    one = {**base, "QDRANT_CLOUD_URL_2": "https://c2.cloud.qdrant.io:6333", "QDRANT_CLOUD_API_KEY_2": "K2"}
    assert [label for label, _ in rep.cloud_endpoints_from_env(one)] == ["qdrant-cloud", "qdrant-cloud-2"]
    three = {
        **one,
        "QDRANT_CLOUD_URL_3": "https://c3.cloud.qdrant.io:6333",
        "QDRANT_CLOUD_URL_4": "https://c4.cloud.qdrant.io:6333",
    }
    assert [label for label, _ in rep.cloud_endpoints_from_env(three)] == [
        "qdrant-cloud", "qdrant-cloud-2", "qdrant-cloud-3", "qdrant-cloud-4",
    ]


def test_dry_run_lists_every_cluster_without_keys(capsys):
    pts = {1: _unit(1)}
    urls = _cloud_urls(3)
    api = _cloud_mapping(urls, [{}, {}, {}, {}], pts)
    assert rep.main(["--dry-run"], env=_cloud_env(urls), api=api) == 0
    out = capsys.readouterr().out
    for label in ("qdrant-cloud", "qdrant-cloud-2", "qdrant-cloud-3", "qdrant-cloud-4"):
        assert label in out
    assert "K1" not in out and "iran_laws_v3" in out


def test_multi_cluster_verify_reports_per_cluster(capsys):
    pts = {i: _unit(i) for i in range(4)}
    urls = _cloud_urls(3)
    api = _cloud_mapping(urls, [pts, pts, pts, pts], pts)
    assert rep.main(["--verify-only"], env=_cloud_env(urls), api=api) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert [r["cluster"] for r in lines] == [
        "qdrant-cloud", "qdrant-cloud-2", "qdrant-cloud-3", "qdrant-cloud-4",
    ]
    assert all(r["ok"] for r in lines)


def test_one_failing_cluster_does_not_stop_the_others(capsys):
    pts = {i: _unit(i) for i in range(4)}
    urls = _cloud_urls(1)
    api = _cloud_mapping(urls, [pts, {}], pts)
    assert rep.main(["--verify-only"], env=_cloud_env(urls), api=api) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert {r["cluster"]: r["ok"] for r in lines} == {"qdrant-cloud": True, "qdrant-cloud-2": False}


def test_all_clusters_failing_exits_nonzero(capsys):
    pts = {i: _unit(i) for i in range(4)}
    urls = _cloud_urls(1)
    api = _cloud_mapping(urls, [{}, {}], pts)
    assert rep.main(["--verify-only"], env=_cloud_env(urls), api=api) == 1


def test_spare_cluster_must_be_https():
    env = {"QDRANT_CLOUD_URL": "https://c1.cloud.qdrant.io:6333",
           "QDRANT_CLOUD_URL_2": "http://insecure.example:6333"}
    assert rep.main(["--apply"], env=env) == 2


# ------------------------------------------------------------------ modal_embed

def _fake_runner(dim=me.DIM):
    calls = []

    def run(batch):
        calls.append(len(batch))
        out = []
        for t in batch:
            v = [0.0] * dim
            v[len(t) % dim] = 1.0
            out.append(v)
        return out

    run.calls = calls
    return run


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(me, "_rows_done", 0)
    monkeypatch.setattr(me, "_runner", None)
    monkeypatch.delenv("MODAL_EMBED_MAX_ROWS", raising=False)


def test_embed_batches_and_validates():
    runner = _fake_runner()
    vecs = me.embed_texts([f"t{i}" for i in range(150)], runner=runner)
    assert len(vecs) == 150 and runner.calls == [64, 64, 22]


def test_cost_guard_refuses_over_cap(monkeypatch):
    monkeypatch.setenv("MODAL_EMBED_MAX_ROWS", "10")
    runner = _fake_runner()
    me.embed_texts(["a"] * 10, runner=runner)
    with pytest.raises(me.ModalEmbedError, match="cost guard"):
        me.embed_texts(["b"], runner=runner)  # cumulative within the process


def test_bad_dim_or_norm_rejected():
    with pytest.raises(me.ModalEmbedError):
        me.embed_texts(["a"], runner=_fake_runner(dim=8))
    with pytest.raises(me.ModalEmbedError, match="normalised"):
        me.embed_texts(["a"], runner=lambda b: [[2.0] + [0.0] * (me.DIM - 1) for _ in b])


def test_estimate_and_cap(monkeypatch):
    e = me.estimate(4000, env={})
    assert e["within_cap"] and e["est_usd"] < 0.1 and e["est_seconds"] == 120 + 100
    assert me.estimate(30000, env={})["within_cap"] is False


def test_missing_tokens_fail_clearly(monkeypatch):
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    with pytest.raises(me.ModalEmbedError, match="MODAL_TOKEN_ID"):
        me.embed_texts(["a"])


def test_parity_threshold():
    a = [[1.0, 0.0], [0.0, 1.0]]
    assert me.parity(["x", "y"], a, a)["ok"]
    near = [[math.cos(0.1), math.sin(0.1)], [0.0, 1.0]]  # cosine 0.995 < 0.999
    assert me.parity(["x", "y"], a, near)["ok"] is False


def test_cli_estimate_and_dry_run_embed(tmp_path, capsys):
    f = tmp_path / "rows.jsonl"
    f.write_text("\n".join(json.dumps({"text": f"ماده {i}"}) for i in range(3)), encoding="utf-8")
    assert me.main(["estimate", str(f)]) == 0
    assert me.main(["embed", str(f), "--out", str(tmp_path / "o.jsonl")]) == 0
    assert not (tmp_path / "o.jsonl").exists()
    assert "dry-run" in capsys.readouterr().out


def test_ingest_pipeline_default_is_not_modal(monkeypatch):
    ip = _load("ingest_pipeline_t", "scripts/legal/ingest_pipeline.py")
    monkeypatch.delenv("EMBED_BACKEND", raising=False)
    monkeypatch.setenv("EMBEDDING_URL", "http://roxira_embeddings:80")
    seen = []
    monkeypatch.setattr(ip, "_embed_http", lambda t: seen.append(t) or [[1.0]])
    monkeypatch.setattr(ip, "_embed_modal", lambda t: pytest.fail("modal must be opt-in"))
    assert ip.default_embed(["x"]) == [[1.0]] and seen


def test_ingest_pipeline_modal_backend_dispatch(monkeypatch):
    ip = _load("ingest_pipeline_t2", "scripts/legal/ingest_pipeline.py")
    monkeypatch.setenv("EMBED_BACKEND", "modal")
    monkeypatch.setattr(ip, "_embed_modal", lambda t: [[0.5]] * len(t))
    assert ip.default_embed(["a", "b"]) == [[0.5], [0.5]]
    monkeypatch.undo()
    monkeypatch.setenv("EMBED_BACKEND", "modal")
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    with pytest.raises(ip.Refusal, match="MODAL_TOKEN_ID"):
        ip.default_embed(["a"])
