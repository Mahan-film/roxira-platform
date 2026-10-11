"""Offline tests for scripts/legal/build_collection.py (fake Qdrant, no network)."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
bc = None


@pytest.fixture(autouse=True, scope="module")
def _load():
    global bc
    path = ROOT / "scripts/legal/build_collection.py"
    spec = importlib.util.spec_from_file_location("build_collection", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_collection"] = module
    spec.loader.exec_module(module)
    bc = module
    yield


def pts(n, law="قانون کار", url="https://a.test/x"):
    return [
        {"id": f"{law}-{i}", "vector": [0.1, 0.2, 0.3], "payload": {"law_name": law, "source_url": url}}
        for i in range(n)
    ]


class FakeQdrant:
    def __init__(self, source_points, existing=("src",), size=3):
        self.src = source_points
        self.collections = {n: [] for n in existing}
        self.size = size
        self.writes = []

    def __call__(self, method, url, body=None):
        path = url.split("/collections/", 1)[1]
        name = path.split("/", 1)[0].split("?", 1)[0]
        if method == "GET":
            if name not in self.collections:
                return 404, {}
            return 200, {"result": {"config": {"params": {"vectors": {"size": self.size, "distance": "Cosine"}}}}}
        if path.endswith("/points/scroll"):
            assert name == "src"
            off = body.get("offset") or 0
            lim = body["limit"]
            chunk = self.src[off : off + lim]
            nxt = off + lim if off + lim < len(self.src) else None
            return 200, {"result": {"points": chunk, "next_page_offset": nxt}}
        self.writes.append((method, name))
        if "/points" in path:
            self.collections[name].extend(body["points"])
        else:
            self.collections[name] = []
        return 200, {}


def run(fake, **kw):
    return bc.build("src", "dst", "http://127.0.0.1:6333", http=fake, batch=2, **kw)


def test_copies_all_points_without_touching_source():
    fake = FakeQdrant(pts(5))
    res = run(fake)
    assert res["points_kept"] == 5 and res["points_dropped"] == 0 and res["created"]
    assert len(fake.collections["dst"]) == 5
    assert all(w[1] == "dst" for w in fake.writes)  # nothing written to src
    assert fake.collections["src"] == []


def test_drop_law_and_source_url_filters():
    data = pts(2, "قانون روابط موجر و مستاجر ۱۳۷۶") + pts(2, "قانون صدور چک", "https://way2law.ir/c") + pts(3)
    fake = FakeQdrant(data)
    res = run(
        fake,
        drop_laws=["قانون روابط موجر و مستأجر ۱۳۷۶"],  # hamza spelling differs: normalised match
        drop_source_url_contains=["way2law.ir"],
    )
    assert res["points_kept"] == 3 and res["points_dropped"] == 4
    assert len(fake.collections["dst"]) == 3


def test_dry_run_writes_nothing():
    fake = FakeQdrant(pts(4))
    res = run(fake, dry_run=True)
    assert res["points_kept"] == 4 and not res["created"]
    assert fake.writes == []


def test_refuses_existing_target_same_name_and_non_local():
    with pytest.raises(bc.Refusal):
        run(FakeQdrant(pts(1), existing=("src", "dst")))
    with pytest.raises(bc.Refusal):
        bc.build("src", "src", "http://127.0.0.1:6333", http=FakeQdrant(pts(1)))
    with pytest.raises(bc.Refusal):
        bc.build("src", "dst", "http://5.75.200.67:6333", http=FakeQdrant(pts(1)))
    with pytest.raises(bc.Refusal):
        bc.build("nope", "dst", "http://127.0.0.1:6333", http=FakeQdrant(pts(1)))


def test_refuses_wrong_vector_shape():
    bad = pts(1)
    bad[0]["vector"] = [0.1]
    with pytest.raises(bc.Refusal):
        run(FakeQdrant(bad))
