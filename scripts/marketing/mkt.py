#!/usr/bin/env python3
"""Factory F6: marketing engine (stdlib only; runs ON the server as root).

  mkt.py plan <brand> --week [--start YYYY-MM-DD]   draft next week's posts (LLM, claim-checked)
  mkt.py propose <brand>                            send drafts to the owner bot (approve/reject)
  mkt.py approve|reject <post-id>                   state change only (called by control_bot)
  mkt.py reply-approve|reply-reject <reply-id>
  mkt.py publish-due [--dry-run]                    publish approved posts/replies that are due
  mkt.py inbox <brand>                              fetch comments, draft replies, ask the owner
  mkt.py status

Nothing is published unless the owner approved it in the bot. Tokens come from the environment
(docs/marketing/SETUP.md). Create /var/lib/roxira-marketing/PAUSE to stop all publishing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import images  # noqa: E402
import mkt_adapters as adapters  # noqa: E402
import mkt_content as content  # noqa: E402
import mkt_llm  # noqa: E402
import mkt_store  # noqa: E402

PAUSE_FILE = os.environ.get("MKT_PAUSE_FILE", "/var/lib/roxira-marketing/PAUSE")
NOTIFY_DIR = os.environ.get("MKT_NOTIFY_DIR", os.path.join(content.REPO, "scripts", "ops", "notify"))
MAX_NEW_REPLIES = 10
COMMENT_WINDOW = 14 * 86400


# --------------------------------------------------------------- bot transport
def bot_send(text: str, buttons=None) -> bool:
    """Owner bot message with inline buttons. Uses notify's settings/transport but NOT its
    scrub(): scrub() would mangle the tracked links the owner must see. Content is ours."""
    sys.path.insert(0, NOTIFY_DIR)
    try:
        import notify
        cfg = notify.settings()
        if not cfg["token"] or not cfg["chat_id"]:
            return False
        payload = {"chat_id": cfg["chat_id"], "text": text[:notify.MAX_MESSAGE],
                   "disable_web_page_preview": True}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": [
                [{"text": label, "callback_data": data} for label, data in buttons]]}
        notify.http_post(f"{cfg['api'].rstrip('/')}/bot{cfg['token']}/sendMessage", payload)
        return True
    except Exception:
        return False


def fmt_time(epoch: int, tz: str = "UTC") -> str:
    try:
        import zoneinfo
        zone = zoneinfo.ZoneInfo(tz)
    except Exception:
        zone = dt.timezone.utc
    return dt.datetime.fromtimestamp(epoch, zone).strftime("%Y-%m-%d %H:%M")


# -------------------------------------------------------------------- commands
def cmd_plan(store, brand, llm, start=None, today=None) -> dict:
    items = content.load_sources(brand)
    first = content.week_start(brand, today or dt.date.today(), start)
    return content.plan_week(store, brand, items, llm, first)


def propose_text(post, brand) -> str:
    import json as _json
    tags = " ".join(_json.loads(post["hashtags"]))
    return (f"📣 پیش‌نویس پست #{post['id']} | {brand['name']} | {post['platform']}\n"
            f"زمان انتشار: {fmt_time(post['scheduled_at'], str(brand.get('timezone', 'UTC')))}\n\n"
            f"{post['caption']}\n\n{tags}\nلینک: {post['link']}\n"
            f"🖼 {'تصویر آماده است' if post['image_path'] else 'بدون تصویر'} — {post['image_prompt'][:200]}\n\n"
            "بدون تأیید شما چیزی منتشر نمی‌شود.")


def cmd_propose(store, brand, send=bot_send, make_image=images.ensure_image) -> list:
    sent = []
    for post in store.list("posts", brand=brand["id"], status="draft"):
        if not post["image_path"]:
            path, url = make_image(post, brand)
            if path:
                store.set_fields("posts", post["id"], image_path=path, image_url=url)
                post = store.get("posts", post["id"])
        if send(propose_text(post, brand),
                [("✅ تأیید", f"mkt:approve:{post['id']}"), ("❌ رد", f"mkt:reject:{post['id']}")]):
            if store.transition("posts", post["id"], "proposed"):
                sent.append(post["id"])
    return sent


def cmd_decide(store, table: str, row_id: int, approve: bool) -> bool:
    if approve:
        return store.transition(table, row_id, "approved", only_from="proposed")
    return store.transition(table, row_id, "rejected", only_from="proposed")


def _publish_one(store, table, row, adapter, http, now, blocked, platform) -> str:
    if not store.transition(table, row["id"], "publishing", only_from="approved"):
        return "skipped"
    try:
        ext = adapter.publish(row, http) if table == "posts" else adapter.reply(row, http)
    except adapters.RateLimited:
        store.transition(table, row["id"], "approved", error="rate limited, retry in 1h",
                         **({"scheduled_at": now + 3600} if table == "posts" else {}))
        blocked.add(platform)
        return "rate-limited"
    except adapters.AdapterError as exc:
        store.transition(table, row["id"], "failed", error=str(exc))
        return f"failed: {exc}"
    store.transition(table, row["id"], "published", external_id=ext)
    return "published"


def cmd_publish_due(store, *, dry_run=False, http=adapters.default_http, now=None, sleep=time.sleep,
                    out=print, pause_file=None) -> dict:
    now = int(now if now is not None else time.time())
    result = {"published": 0, "failed": 0, "waiting": 0}
    if os.path.exists(pause_file or PAUSE_FILE):
        out("paused (PAUSE file present); nothing published")
        return result
    blocked: set = set()
    last_call: dict = {}
    jobs = [("posts", r) for r in store.due("posts", now)] + [("replies", r) for r in store.due("replies", now)]
    for table, row in jobs:
        platform = row["platform"]
        adapter = adapters.get(platform)
        label = f"{table[:-1]} #{row['id']} -> {platform}"
        if platform in blocked:
            result["waiting"] += 1
            continue
        if not adapter.configured():
            out(f"{label}: waiting, missing env {','.join(adapter.missing())}")
            result["waiting"] += 1
            continue
        if store.published_since(platform, now - 86400) >= adapters.DAILY_CAP[platform]:
            out(f"{label}: waiting, daily cap {adapters.DAILY_CAP[platform]} reached")
            result["waiting"] += 1
            continue
        if dry_run:
            try:
                req = adapter.build_publish(row) if table == "posts" else adapter.build_reply(row)
                out(f"DRY-RUN {label}: {req.redacted()}")
            except adapters.AdapterError as exc:
                out(f"DRY-RUN {label}: would fail: {exc}")
            continue
        gap = adapters.MIN_GAP_SECONDS[platform] - (time.monotonic() - last_call.get(platform, -1e9))
        if gap > 0:
            sleep(gap)
        status = _publish_one(store, table, row, adapter, http, now, blocked, platform)
        last_call[platform] = time.monotonic()
        out(f"{label}: {status}")
        result["published" if status == "published" else "failed" if status.startswith("failed") else "waiting"] += 1
    return result


def reply_prompt(brand: dict, platform: str) -> str:
    banned = "; ".join(str(b) for b in brand["banned_claims"]) or "none"
    return (
        f"You draft a public reply to a comment on the {platform} account of '{brand['name']}'.\n"
        f"Tone: {brand['tone']}\nAnswer in the language of the comment. Max 300 characters.\n"
        "Rules: thank the person; NEVER give legal, medical or financial advice and never predict "
        "outcomes; for a concrete question point to the product/guide (its link is provided) instead "
        "of answering; no numbers, prices or law references of your own; no promises; no links other "
        f"than the given one. Never claim: {banned}.\n"
        "If the comment is spam, abusive, or needs a human, answer exactly SKIP. Output the reply text only."
    )


def cmd_inbox(store, brand, llm, *, http=adapters.default_http, send=bot_send, now=None) -> list:
    now = int(now if now is not None else time.time())
    handles = {str(v).lower() for v in (brand.get("handles") or {}).values()}
    product = str(brand["links"].get("site", ""))
    proposed = []
    for platform in brand["platforms"]:
        adapter = adapters.get(platform)
        if not adapter.configured():
            continue
        for post in store.list("posts", brand=brand["id"], platform=platform, status="published"):
            if not post["external_id"] or post["updated"] < now - COMMENT_WINDOW:
                continue
            try:
                comments = adapter.fetch_comments(post["external_id"], http)
            except adapters.AdapterError:
                continue
            for c in comments:
                if len(proposed) >= MAX_NEW_REPLIES:
                    return proposed
                if store.seen_comment(platform, c["id"]) or str(c["author"]).lower() in handles:
                    continue
                text = c["text"].strip()
                if not text:
                    continue
                draft = llm(reply_prompt(brand, platform),
                            f"Comment: {text}\nProduct link: {product}\nPost it is under: {post['caption'][:300]}").strip()
                bad = content.check_claims(draft, text + " " + post["caption"], brand["banned_phrases"])
                if not draft or draft.upper().startswith("SKIP") or bad or len(draft) > 500:
                    # remember it so we do not re-ask the model for every run
                    rid = store.add_reply(brand=brand["id"], platform=platform, post_id=post["id"],
                                          comment_id=c["id"], author=c["author"], incoming=text,
                                          reply_text=draft[:500] or "SKIP")
                    if rid:
                        store.transition("replies", rid, "rejected")
                    continue
                rid = store.add_reply(brand=brand["id"], platform=platform, post_id=post["id"],
                                      comment_id=c["id"], author=c["author"], incoming=text, reply_text=draft)
                if not rid:
                    continue
                msg = (f"💬 کامنت جدید روی {platform} ({brand['name']}):\n«{text[:400]}»\n\n"
                       f"پاسخ پیشنهادی #{rid}:\n{draft}")
                if send(msg, [("✅ ارسال پاسخ", f"mkt:rapprove:{rid}"), ("❌ رد", f"mkt:rreject:{rid}")]):
                    if store.transition("replies", rid, "proposed"):
                        proposed.append(rid)
    return proposed


def cmd_status(store, out=print) -> None:
    for table in mkt_store.TABLES:
        counts = {}
        for row in store.list(table):
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        out(f"{table}: {counts or 'empty'}")


# ------------------------------------------------------------------------ main
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="mkt.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("brand")
    p.add_argument("--week", action="store_true", required=True)
    p.add_argument("--start", help="first day YYYY-MM-DD (default: start of next week)")
    for name in ("propose", "inbox"):
        sub.add_parser(name).add_argument("brand")
    for name in ("approve", "reject", "reply-approve", "reply-reject"):
        sub.add_parser(name).add_argument("id", type=int)
    d = sub.add_parser("publish-due")
    d.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = ap.parse_args(argv)

    store = mkt_store.Store()
    try:
        if args.cmd == "status":
            cmd_status(store)
        elif args.cmd in ("approve", "reject", "reply-approve", "reply-reject"):
            table = "replies" if args.cmd.startswith("reply") else "posts"
            ok = cmd_decide(store, table, args.id, args.cmd.endswith("approve"))
            print(("ok" if ok else "not in 'proposed' state") + f": {args.cmd} {args.id}")
            return 0 if ok else 1
        elif args.cmd == "publish-due":
            cmd_publish_due(store, dry_run=args.dry_run)
        else:
            brand = content.load_brand(args.brand)
            if args.cmd == "plan":
                start = dt.date.fromisoformat(args.start) if args.start else None
                rep = cmd_plan(store, brand, mkt_llm.chat, start)
                print(f"campaign {rep['campaign']}: created {len(rep['created'])} drafts {rep['created']}")
                for platform, item, reasons in rep["skipped"]:
                    print(f"  skipped {platform}/{item}: {'; '.join(reasons)}")
            elif args.cmd == "propose":
                print("proposed:", cmd_propose(store, brand))
            elif args.cmd == "inbox":
                print("reply drafts proposed:", cmd_inbox(store, brand, mkt_llm.chat))
    except (ValueError, OSError, mkt_llm.LLMError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
