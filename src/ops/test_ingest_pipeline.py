"""Offline tests for scripts/legal/ingest_pipeline.py (fake HTTP and embed, no network)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ip = None


@pytest.fixture(autouse=True, scope="module")
def _load_pipeline():
    """Load the script inside a fixture (no import-time code in this file)."""
    global ip
    path = ROOT / "scripts/legal/ingest_pipeline.py"
    spec = importlib.util.spec_from_file_location("ingest_pipeline", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["ingest_pipeline"] = module
    spec.loader.exec_module(module)
    ip = module
    yield


ALLOW = {"قانون کار": True, "قانون مدنی": True}


def row(art="1", label=None, law="قانون کار", **over):
    base = {
        "law_name": law,
        "article_no": art,
        "article_label": label or f"ماده {art}",
        "text": "متن آزمایشی",
        "source_tier": "official",
        "is_active": True,
        "status": "VALID",
        "approval_date": "1369/08/29",
    }
    base.update(over)
    return base


class FakeQdrant:
    def __init__(self, existing=()):
        self.collections = {name: [] for name in existing}
        self.calls = []

    def __call__(self, method, url, body=None):
        self.calls.append((method, url))
        path = url.split("/collections/", 1)[1]
        name = path.split("/", 1)[0].split("?", 1)[0]
        if method == "GET":
            return (200, {}) if name in self.collections else (404, {})
        if path.endswith("?wait=true") and "/points" in path:
            self.collections[name].extend(body["points"])
            return 200, {}
        self.collections[name] = []
        return 200, {}


def fake_embed(texts):
    return [[0.1, 0.2, 0.3] for _ in texts]


def run_apply(rows, http, collection="local_test", **kw):
    return ip.apply_rows(
        rows,
        "http://127.0.0.1:6333",
        collection,
        allowlist=ALLOW,
        http=http,
        embed=fake_embed,
        **kw,
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://5.75.200.67:6333",
        "http://roxira_qdrant_prod:6333",
        "http://localhost.evil.com:6333",
        "http://127.0.0.1.evil.com:6333",
        "https://qdrant.example.com",
        "http://user:pw@127.0.0.1:6333",
    ],
)
def test_non_local_url_refused(url):
    http = FakeQdrant()
    with pytest.raises(ip.Refusal):
        ip.apply_rows([row()], url, "x", allowlist=ALLOW, http=http, embed=fake_embed)
    assert http.calls == []


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:6333", "http://localhost:6333/", "http://[::1]:6333"]
)
def test_local_urls_allowed(url):
    assert ip.assert_local(url) == url.rstrip("/")


def test_eval_refuses_non_local():
    with pytest.raises(ip.Refusal):
        ip.run_eval("c", "http://5.75.200.67:6333", http=FakeQdrant(), runner=lambda c: {})


def test_valid_rows_apply_and_report(monkeypatch):
    http = FakeQdrant()
    out = run_apply([row("1"), row("2")], http)
    assert out["points_written"] == 2 and out["created"] is True
    assert len(http.collections["local_test"]) == 2
    payload = http.collections["local_test"][0]["payload"]
    assert payload["law_name"] == "قانون کار" and payload["source_tier"] == "official"


def gate_counts(rows):
    return ip.validate_rows(rows, ALLOW)["gate_counts"]


@pytest.mark.parametrize(
    ("bad_rows", "gate"),
    [
        ([row(source_tier=None)], "missing_source_tier"),
        ([row(source_tier="mirror")], "invalid_source_tier"),
        ([row(is_active=False)], "repealed"),
        ([row(status="REPEALED")], "repealed"),
        ([row("1"), row("1")], "duplicates"),
        ([row(law="قانون ناشناخته")], "not_in_allowlist"),
        ([row(text="")], "missing_fields"),
        ([row(art="12abc")], "bad_article_no"),
        ([row("1"), row("2", law="قانون کار", status="BILL")], "bill_with_enacted_law"),
        ([row("5", law="قانون مدنی", status="BILL")], "bill_with_enacted_law"),
    ],
)
def test_each_gate_blocks_apply(bad_rows, gate):
    assert gate_counts(bad_rows)[gate] >= 1
    http = FakeQdrant()
    with pytest.raises(ip.Refusal, match="blocked by gates"):
        run_apply(bad_rows, http)
    assert http.collections == {}


def test_missing_approval_date_is_warning_only():
    report = ip.validate_rows([row(approval_date=None)], ALLOW)
    assert report["ok"] and report["warnings"]["missing_approval_date"] == 1


def test_mokarrar_article_no_is_valid():
    assert ip.validate_rows([row("13-mokarrar")], ALLOW)["ok"]


def test_protected_and_existing_collection_refused():
    http = FakeQdrant(existing=["iran_laws_v2", "taken"])
    with pytest.raises(ip.Refusal, match="protected"):
        run_apply([row()], http, collection="iran_laws_v2")
    with pytest.raises(ip.Refusal, match="already exists"):
        run_apply([row()], http, collection="taken")
    assert http.collections["taken"] == []
    out = run_apply([row()], http, collection="taken", allow_existing=True)
    assert out["points_written"] == 1 and out["created"] is False


def test_point_ids_deterministic_and_distinct():
    a, b = row("1"), row("2")
    assert ip.point_id(a) == ip.point_id(dict(a))
    assert ip.point_id(a) != ip.point_id(b)
    # normalisation: ZWNJ / Arabic letters do not change the id
    assert ip.point_id(row(law="قانون کار")) == ip.point_id(row(law="قانون كار"))
    # text change does not change the id (idempotent upsert overwrites)
    assert ip.point_id(a) == ip.point_id(row("1", text="متن دیگر"))


def test_plan_idempotent_and_batched():
    rows = [row(str(i)) for i in range(1, 8)]
    p1 = ip.build_plan(rows, 3)
    p2 = ip.build_plan(list(rows), 3)
    assert p1 == p2
    assert [b["rows"] for b in p1["batches"]] == [3, 3, 1]
    assert p1["unique_point_ids"] == 7
    with pytest.raises(ip.Refusal):
        ip.build_plan(rows, 0)


def test_rerun_apply_is_idempotent_with_allow_existing():
    http = FakeQdrant()
    rows = [row("1"), row("2")]
    run_apply(rows, http, batch=1)
    first_ids = [p["id"] for p in http.collections["local_test"]]
    run_apply(rows, http, batch=1, allow_existing=True)
    ids = [p["id"] for p in http.collections["local_test"]]
    assert ids == first_ids * 2 and len(set(ids)) == 2  # same ids re-sent (upsert overwrites)


def test_cli_validate_plan_and_no_text_leak(tmp_path, capsys):
    f = tmp_path / "rows.jsonl"
    f.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in [row("1"), row("1")]), encoding="utf-8"
    )
    allow = tmp_path / "allow.json"
    allow.write_text(
        json.dumps({"laws": [{"name": "قانون کار", "enacted": True}]}), encoding="utf-8"
    )
    code = ip.main(["validate", str(f), "--allowlist", str(allow)])
    out = capsys.readouterr().out
    assert code == 3 and "متن آزمایشی" not in out
    assert json.loads(out)["gate_counts"]["duplicates"] == 2
    assert ip.main(["plan", str(f), "--batch", "1", "--allowlist", str(allow)]) == 0
    assert (
        ip.main(
            [
                "apply",
                str(f),
                "--qdrant",
                "http://5.75.200.67:6333",
                "--collection",
                "x",
                "--allowlist",
                str(allow),
            ],
            http=FakeQdrant(),
            embed=fake_embed,
        )
        == 2
    )


def test_shipped_allowlist_loads():
    allow = ip.load_allowlist()
    assert ip.norm_name("قانون کار") in allow and len(allow) >= 25


def test_eval_runs_via_injected_runner(monkeypatch):
    for k in ("QDRANT_HOST", "QDRANT_PORT", "LIGHTRAG_QDRANT_COLLECTION"):
        monkeypatch.setenv(k, "")
    http = FakeQdrant(existing=["local_test"])
    out = ip.run_eval(
        "local_test", "http://127.0.0.1:6333", http=http, runner=lambda c: {"collection": c}
    )
    assert out == {"collection": "local_test"}
    with pytest.raises(ip.Refusal, match="not found"):
        ip.run_eval("missing", "http://127.0.0.1:6333", http=http, runner=lambda c: {})


PROPOSED_NAME = "قانون جرایم رایانه‌ای"


@pytest.fixture
def allow_file(tmp_path):
    f = tmp_path / "allow.json"
    f.write_text(
        json.dumps(
            {
                "laws": [
                    {"name": "قانون کار", "status": "present", "enacted": True},
                    {"name": PROPOSED_NAME, "status": "proposed", "enacted": True},
                ]
            }
        ),
        encoding="utf-8",
    )
    return f


@pytest.fixture
def no_proposed_env(monkeypatch):
    monkeypatch.delenv("LEGAL_ALLOW_PROPOSED", raising=False)


def test_proposed_excluded_from_allowlist_by_default(allow_file, no_proposed_env):
    allow = ip.load_allowlist(allow_file)
    assert ip.norm_name("قانون کار") in allow
    assert ip.norm_name(PROPOSED_NAME) not in allow


def test_proposed_included_with_flag_or_env(allow_file, monkeypatch):
    monkeypatch.delenv("LEGAL_ALLOW_PROPOSED", raising=False)
    assert ip.norm_name(PROPOSED_NAME) in ip.load_allowlist(allow_file, allow_proposed=True)
    monkeypatch.setenv("LEGAL_ALLOW_PROPOSED", "1")
    assert ip.norm_name(PROPOSED_NAME) in ip.load_allowlist(allow_file)
    assert ip.norm_name(PROPOSED_NAME) in ip.load_allowlist(allow_file, allow_proposed=None)
    monkeypatch.setenv("LEGAL_ALLOW_PROPOSED", "0")
    assert ip.norm_name(PROPOSED_NAME) not in ip.load_allowlist(allow_file)


def test_proposed_rows_blocked_by_gate_unless_allowed(allow_file, no_proposed_env):
    rows = [row("1", law=PROPOSED_NAME)]
    blocked = ip.validate_rows(rows, ip.load_allowlist(allow_file))
    assert blocked["gate_counts"]["not_in_allowlist"] == 1 and not blocked["ok"]
    ok = ip.validate_rows(rows, ip.load_allowlist(allow_file, allow_proposed=True))
    assert ok["ok"]


def test_cli_allow_proposed_flag(tmp_path, allow_file, no_proposed_env, capsys):
    f = tmp_path / "rows.jsonl"
    f.write_text(json.dumps(row("1", law=PROPOSED_NAME), ensure_ascii=False), encoding="utf-8")
    assert ip.main(["validate", str(f), "--allowlist", str(allow_file)]) == 3
    assert json.loads(capsys.readouterr().out)["gate_counts"]["not_in_allowlist"] == 1
    assert ip.main(["validate", str(f), "--allowlist", str(allow_file), "--allow-proposed"]) == 0
    assert ip.main(["plan", str(f), "--batch", "1", "--allowlist", str(allow_file)]) == 0
    assert ip.main(["plan", str(f), "--batch", "1", "--allowlist", str(allow_file), "--allow-proposed"]) == 0


def test_shipped_allowlist_proposed_entries_gated(no_proposed_env):
    default = ip.load_allowlist()
    full = ip.load_allowlist(allow_proposed=True)
    proposed = [
        ip.norm_name(i["name"])
        for i in json.loads(ip.DEFAULT_ALLOWLIST.read_text(encoding="utf-8"))["laws"]
        if i.get("status") == "proposed"
    ]
    assert proposed, "expected proposed entries in config/legal_allowlist.json"
    assert not any(name in default for name in proposed)
    assert all(name in full for name in proposed)
