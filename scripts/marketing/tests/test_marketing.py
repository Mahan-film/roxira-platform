"""Offline tests for scripts/marketing (no network, no LLM, no real tokens)."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[2] / "ops" / "notify"))

import control_bot  # noqa: E402
import images  # noqa: E402
import mkt  # noqa: E402
import mkt_adapters as ad  # noqa: E402
import mkt_content as mc  # noqa: E402
import mkt_store  # noqa: E402
import mkt_yaml  # noqa: E402

REPO = HERE.parents[3]
ITEM = {
    "id": "appeal-deadline", "title": "مهلت تجدیدنظرخواهی", "url": "https://x.test/guides/appeal-deadline",
    "description": "مهلت ۲۰ روز است",
    "text": "مهلت تجدیدنظرخواهی ۲۰ روز و برای مقیم خارج ۲ ماه است (ماده ۳۳۶).",
}


def brand(**over):
    b = {"id": "t", "name": "Test", "audience": "a", "tone": "t", "languages": ["fa"],
         "platforms": ["telegram", "x"], "cadence": {"telegram": 2, "x": 1}, "post_hours": [10],
         "timezone": "UTC", "week_start": "saturday", "banned_claims": [], "banned_phrases": ["تضمین"],
         "hashtags": ["قاضی_هوشمند"], "links": {"site": "https://x.test"}, "source": {}}
    b.update(over)
    return b


def fake_llm(system, user):
    return json.dumps({"caption": "مهلت تجدیدنظر ۲۰ روز است؛ راهنما را بخوانید.",
                       "hashtags": ["#حقوق"], "image_prompt": "a calendar on a desk"})


@pytest.fixture
def store():
    return mkt_store.Store(":memory:")


# ------------------------------------------------------------------ profiles
def test_real_brand_profiles_load():
    mc.CONFIG_DIR = str(REPO / "config" / "marketing")
    for name in ("ghazihoushmand", "globalproduct"):
        b = mc.load_brand(name)
        assert b["platforms"] and b["banned_claims"]
    assert mc.load_brand("ghazihoushmand")["cadence"]["telegram"] == 3


def test_brand_name_is_validated():
    with pytest.raises(ValueError):
        mc.load_brand("../etc/passwd")


def test_yaml_subset():
    data = mkt_yaml.parse("a: 1\nb: [x, 'y z']\nc:\n  - one\n  - two\nd:\n  e: true  # c\n")
    assert data == {"a": 1, "b": ["x", "y z"], "c": ["one", "two"], "d": {"e": True}}


def test_sources_from_real_guides():
    b = mc.load_brand("ghazihoushmand")
    items = mc.load_sources(b, str(REPO))
    assert len(items) >= 10
    assert items[0]["url"].startswith("https://ghazihoushmand.ir/guides/")


# --------------------------------------------------------------- claim check
def test_claim_check_accepts_source_numbers_in_persian_digits():
    assert mc.check_claims("مهلت ۲۰ روز است", ITEM["text"]) == []
    assert mc.check_claims("deadline is 20 days", ITEM["text"]) == []


def test_claim_check_rejects_unknown_numbers_and_articles():
    problems = mc.check_claims("طبق ماده ۴۴۲ مهلت ۳۰ روز است", ITEM["text"])
    assert any("article reference 442" in p for p in problems)
    assert any("number 30" in p for p in problems)


def test_claim_check_ignores_urls_and_flags_banned_phrase():
    assert mc.check_claims("see https://x.test/a?utm_content=987", "no numbers") == []
    assert mc.check_claims("نتیجه را تضمین می‌کنیم", "x", ["تضمین"])


# ------------------------------------------------------------------ calendar
def test_calendar_with_fake_llm(store):
    b = brand()
    start = dt.date(2026, 10, 17)  # a Saturday
    item2 = {**ITEM, "id": "second-guide"}
    rep = mc.plan_week(store, b, [ITEM, item2], fake_llm, start)
    posts = store.list("posts")
    assert len(rep["created"]) == 3 and len(posts) == 3
    tg = [p for p in posts if p["platform"] == "telegram"]
    assert len(tg) == 2 and tg[0]["scheduled_at"] < tg[1]["scheduled_at"]
    assert all(p["status"] == "draft" for p in posts)
    assert "utm_source=telegram" in tg[0]["link"] and "utm_campaign=t-2026w42" in tg[0]["link"]
    assert json.loads(tg[0]["hashtags"])[0] == "#قاضی_هوشمند"
    assert tg[0]["image_prompt"]
    # idempotent: planning the same week again adds nothing
    assert mc.plan_week(store, b, [ITEM, item2], fake_llm, start)["created"] == []


def test_calendar_rejects_hallucinated_numbers(store):
    calls = []

    def bad_llm(system, user):
        calls.append(user)
        return json.dumps({"caption": "طبق ماده ۹۹۹ باید عمل کرد", "hashtags": [], "image_prompt": "x"})

    rep = mc.plan_week(store, brand(platforms=["x"], cadence={"x": 1}), [ITEM], bad_llm, dt.date(2026, 10, 17))
    assert rep["created"] == [] and store.list("posts") == []
    assert rep["skipped"] and "not in the source" in rep["skipped"][0][2][0]
    assert any("previous attempt was rejected" in c for c in calls)  # feedback loop used


def test_week_start_is_next_configured_weekday():
    assert mc.week_start({"week_start": "saturday"}, dt.date(2026, 10, 16)) == dt.date(2026, 10, 17)
    assert mc.week_start({"week_start": "monday"}, dt.date(2026, 10, 19)) == dt.date(2026, 10, 26)


# ------------------------------------------------------- approval state machine
def _draft(store):
    return store.add_post(brand="t", platform="telegram", campaign="c", source_id="s", caption="c",
                          link="https://x.test/a", scheduled_at=100)


def test_nothing_publishes_without_approval(store):
    pid = _draft(store)
    calls = []
    mkt.cmd_publish_due(store, http=lambda *a, **k: calls.append(a) or (200, {}), now=10**9, out=lambda *_: None)
    assert calls == []
    assert store.transition("posts", pid, "approved", only_from="proposed") is False  # draft -> approved: no
    assert store.get("posts", pid)["status"] == "draft"


def test_state_machine_happy_and_reject_paths(store, monkeypatch):
    monkeypatch.setenv("TELEGRAM_CHANNEL_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHANNEL_ID", "@chan")
    pid = _draft(store)
    assert store.transition("posts", pid, "proposed")
    assert mkt.cmd_decide(store, "posts", pid, True)
    assert not mkt.cmd_decide(store, "posts", pid, True)  # already approved
    sent = []
    http = lambda m, u, h, j, f: sent.append((m, u, j)) or (200, {"ok": True, "result": {"message_id": 7}})  # noqa: E731
    res = mkt.cmd_publish_due(store, http=http, now=10**9, sleep=lambda s: None, out=lambda *_: None,
                              pause_file="/nonexistent")
    row = store.get("posts", pid)
    assert res["published"] == 1 and row["status"] == "published" and row["external_id"] == "7"
    assert len(sent) == 1 and "sendMessage" in sent[0][1]
    # published is terminal
    assert not store.transition("posts", pid, "approved")

    rid = _draft_other(store)
    store.transition("posts", rid, "proposed")
    assert mkt.cmd_decide(store, "posts", rid, False)
    assert store.get("posts", rid)["status"] == "rejected"
    assert not store.transition("posts", rid, "approved")


def _draft_other(store):
    return store.add_post(brand="t", platform="telegram", campaign="c", source_id="other", caption="c",
                          scheduled_at=100)


def test_rate_limit_requeues_and_blocks_platform(store, monkeypatch):
    monkeypatch.setenv("TELEGRAM_CHANNEL_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHANNEL_ID", "@chan")
    ids = [_draft(store), _draft_other(store)]
    for i in ids:
        store.transition("posts", i, "proposed")
        store.transition("posts", i, "approved")
    calls = []
    http = lambda *a: calls.append(a) or (429, {})  # noqa: E731
    mkt.cmd_publish_due(store, http=http, now=1000, sleep=lambda s: None, out=lambda *_: None,
                        pause_file="/nonexistent")
    assert len(calls) == 1  # second post not attempted after 429
    row = store.get("posts", ids[0])
    assert row["status"] == "approved" and row["scheduled_at"] == 1000 + 3600


def test_pause_file_stops_publishing(store, tmp_path):
    pid = _draft(store)
    store.transition("posts", pid, "proposed")
    store.transition("posts", pid, "approved")
    pause = tmp_path / "PAUSE"
    pause.write_text("")
    res = mkt.cmd_publish_due(store, http=lambda *a: pytest.fail("no call"), now=10**9,
                              out=lambda *_: None, pause_file=str(pause))
    assert res["published"] == 0


def test_propose_sends_buttons_and_marks_proposed(store, tmp_path):
    pid = _draft(store)
    msgs = []
    out = mkt.cmd_propose(store, brand(), send=lambda t, b: msgs.append((t, b)) or True,
                          make_image=lambda p, b: ("", ""))
    assert out == [pid] and store.get("posts", pid)["status"] == "proposed"
    assert msgs[0][1] == [("✅ تأیید", f"mkt:approve:{pid}"), ("❌ رد", f"mkt:reject:{pid}")]
    # send failure leaves the draft untouched
    pid2 = _draft_other(store)
    assert mkt.cmd_propose(store, brand(), send=lambda t, b: False, make_image=lambda p, b: ("", "")) == []
    assert store.get("posts", pid2)["status"] == "draft"


# -------------------------------------------------------------------- adapters
POST = {"caption": "متن", "hashtags": json.dumps(["#a"]), "link": "https://x.test/g?utm_source=x",
        "image_url": "https://x.test/m.png", "source_title": "T"}


def test_dry_run_payloads_redact_tokens(monkeypatch):
    for k, v in {"IG_ACCESS_TOKEN": "SECRETIG", "IG_USER_ID": "17", "FB_PAGE_TOKEN": "SECRETFB",
                 "FB_PAGE_ID": "9", "LINKEDIN_ACCESS_TOKEN": "SECRETLI",
                 "LINKEDIN_AUTHOR_URN": "urn:li:organization:5", "X_ACCESS_TOKEN": "SECRETX",
                 "TELEGRAM_CHANNEL_BOT_TOKEN": "SECRETTG", "TELEGRAM_CHANNEL_ID": "@c"}.items():
        monkeypatch.setenv(k, v)
    payloads = {name: ad.get(name).build_publish(POST).redacted() for name in ad.ADAPTERS}
    assert "SECRET" not in json.dumps(payloads)
    assert payloads["instagram"]["url"].endswith("/17/media")
    assert payloads["instagram"]["form"]["image_url"] == POST["image_url"]
    assert payloads["facebook"]["url"].endswith("/9/photos")
    li = payloads["linkedin"]["json"]
    assert li["author"] == "urn:li:organization:5" and li["content"]["article"]["source"] == POST["link"]
    assert payloads["x"]["json"]["text"].startswith("متن")
    assert payloads["telegram"]["url"] == "https://api.telegram.org/bot***/sendPhoto"
    assert all(ad.get(n).configured() for n in ad.ADAPTERS)


def test_instagram_needs_image_and_x_text_fits_280():
    with pytest.raises(ad.AdapterError):
        ad.get("instagram").build_publish({**POST, "image_url": ""})
    long_post = {**POST, "caption": "الف" * 500}
    text = ad.compose(long_post, 280)
    assert len(text) - len(long_post["link"]) + 23 <= 280


def test_instagram_two_step_publish(monkeypatch):
    monkeypatch.setenv("IG_ACCESS_TOKEN", "t")
    monkeypatch.setenv("IG_USER_ID", "17")
    seen = []

    def http(method, url, headers, json_body, form):
        seen.append((method, url))
        if url.endswith("/17/media"):
            return 200, {"id": "C1"}
        if "status_code" in url:
            return 200, {"status_code": "FINISHED"}
        return 200, {"id": "M1"}

    assert ad.get("instagram").publish(POST, http) == "M1"
    assert [u.rsplit("/", 1)[-1].split("?")[0] for _, u in seen] == ["media", "C1", "media_publish"]


def test_missing_tokens_reported(monkeypatch):
    monkeypatch.delenv("X_ACCESS_TOKEN", raising=False)
    assert ad.get("x").configured() is False and ad.get("x").missing() == ["X_ACCESS_TOKEN"]


def test_dry_run_cli_path_changes_nothing(store, monkeypatch):
    monkeypatch.setenv("TELEGRAM_CHANNEL_BOT_TOKEN", "SECRET")
    monkeypatch.setenv("TELEGRAM_CHANNEL_ID", "@c")
    pid = _draft(store)
    store.transition("posts", pid, "proposed")
    store.transition("posts", pid, "approved")
    lines = []
    mkt.cmd_publish_due(store, dry_run=True, http=lambda *a: pytest.fail("no call"), now=10**9,
                        out=lines.append, pause_file="/nonexistent")
    assert store.get("posts", pid)["status"] == "approved"
    assert lines and "DRY-RUN" in lines[0] and "SECRET" not in lines[0]


# ----------------------------------------------------------------------- inbox
def test_inbox_drafts_reply_and_asks_owner(store, monkeypatch):
    monkeypatch.setenv("IG_ACCESS_TOKEN", "t")
    monkeypatch.setenv("IG_USER_ID", "17")
    pid = store.add_post(brand="t", platform="instagram", campaign="c", source_id="s", caption="c",
                         scheduled_at=1)
    store.transition("posts", pid, "proposed")
    store.transition("posts", pid, "approved")
    store.transition("posts", pid, "publishing")
    store.transition("posts", pid, "published", external_id="M1")

    def http(method, url, headers, json_body, form):
        return 200, {"data": [{"id": "k1", "text": "ممنون", "username": "ali"},
                              {"id": "k2", "text": "mine", "username": "ghazihoushmand"}]}

    msgs = []
    b = brand(platforms=["instagram"], handles={"instagram": "ghazihoushmand"})
    out = mkt.cmd_inbox(store, b, lambda s, u: "ممنون از شما!", http=http,
                        send=lambda t, bt: msgs.append(bt) or True, now=int(__import__("time").time()))
    assert len(out) == 1 and msgs[0][0][1] == f"mkt:rapprove:{out[0]}"
    assert store.get("replies", out[0])["status"] == "proposed"
    # same comment is never drafted twice
    assert mkt.cmd_inbox(store, b, lambda s, u: "x", http=http, send=lambda t, bt: True,
                         now=int(__import__("time").time())) == []


# --------------------------------------------------------------------- images
def test_image_fallback_chain(tmp_path, monkeypatch):
    monkeypatch.delenv("MKT_IMAGE_GROUP", raising=False)
    post = {"id": 5, "image_prompt": "p", "source_title": "T", "caption": "c", "lang": "en"}
    b = {"id": "t", "name": "Test", "media_base_url": "https://x.test/media"}
    # no group, no card -> skipped
    assert images.ensure_image(post, b, card=lambda *a: None, media_dir=str(tmp_path)) == ("", "")
    # key-pool generation wins when a group is configured
    monkeypatch.setenv("MKT_IMAGE_GROUP", "img")
    path, url = images.ensure_image(post, b, generate=lambda p: b"\x89PNG", media_dir=str(tmp_path))
    assert pathlib.Path(path).read_bytes() == b"\x89PNG" and url == "https://x.test/media/t-5.png"
    # generation failure falls back to the card hook
    post2 = {**post, "id": 6}

    def boom(prompt):
        raise RuntimeError("down")

    made = []
    images.ensure_image(post2, b, generate=boom, card=lambda *a: made.append(a) or True, media_dir=str(tmp_path))
    assert made


# --------------------------------------------------------- control_bot routing
class FakeHTTP:
    def __init__(self):
        self.calls = []

    def __call__(self, url, payload, timeout=10):
        self.calls.append((url.rsplit("/", 1)[-1], payload))
        return {"ok": True}


def _bot(tmp_path, runner):
    return control_bot.Bot(token="t", chat_id="555", api="https://api.telegram.org", http=FakeHTTP(),
                           paths={"freeze": tmp_path / "f", "autodeploy_last": tmp_path / "a",
                                  "offset": tmp_path / "o", "repo": "/opt/roxira_platform"},
                           runner=runner, log=lambda m: None)


def _cb(data):
    return {"callback_query": {"id": "cb1", "data": data, "message": {"chat": {"id": 555}}}}


@pytest.mark.parametrize(("data", "argv_tail"), [
    ("mkt:approve:12", ["approve", "12"]),
    ("mkt:reject:3", ["reject", "3"]),
    ("mkt:rapprove:7", ["reply-approve", "7"]),
    ("mkt:rreject:7", ["reply-reject", "7"]),
])
def test_bot_routes_mkt_callbacks_with_fixed_argv(tmp_path, data, argv_tail):
    seen = []
    bot = _bot(tmp_path, lambda cmd, timeout=15: seen.append(cmd) or (0, ""))
    bot.handle_update(_cb(data))
    assert seen == [[sys.executable, "/opt/roxira_platform/scripts/marketing/mkt.py", *argv_tail]]


@pytest.mark.parametrize("data", ["mkt:approve:1;rm -rf /", "mkt:approve:", "mkt:approve:-1",
                                  "mkt:publish:1", "mkt:approve:1234567890", "mkt:approve:1 2", "mkt:approve:1\n"])
def test_bot_rejects_malformed_mkt_callbacks(tmp_path, data):
    seen = []
    bot = _bot(tmp_path, lambda cmd, timeout=15: seen.append(cmd) or (0, ""))
    bot.handle_update(_cb(data))
    assert seen == []


def test_bot_ignores_mkt_callback_from_other_chat(tmp_path):
    seen = []
    bot = _bot(tmp_path, lambda cmd, timeout=15: seen.append(cmd) or (0, ""))
    update = _cb("mkt:approve:1")
    update["callback_query"]["message"]["chat"]["id"] = 999
    bot.handle_update(update)
    assert seen == []
