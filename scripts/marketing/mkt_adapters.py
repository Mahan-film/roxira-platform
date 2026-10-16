"""Publishing / inbox adapters behind one interface (stdlib only).

Each adapter:
  .configured()          -> bool (all env tokens present)
  .build_publish(post)   -> Request  (what would be sent; tokens redacted by .redacted())
  .publish(post, http)   -> external id (raises RateLimited / AdapterError)
  .build_reply(reply)    -> Request
  .fetch_comments(external_id, http) -> [{id, text, author}]   (empty if the API does not allow it)

Tokens come from environment variables only (names in docs/marketing/SETUP.md).
`http(method, url, headers, json_body, form) -> (status, dict)` is injectable for tests.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

GRAPH = "https://graph.facebook.com/v21.0"
# conservative daily caps, below the platforms' documented limits (see SETUP.md)
DAILY_CAP = {"instagram": 20, "facebook": 20, "linkedin": 20, "x": 12, "telegram": 20}
MIN_GAP_SECONDS = {"instagram": 5, "facebook": 5, "linkedin": 5, "x": 10, "telegram": 4}


class AdapterError(RuntimeError):
    pass


class RateLimited(AdapterError):
    pass


@dataclass
class Request:
    method: str
    url: str
    headers: dict = field(default_factory=dict)
    json_body: dict | None = None
    form: dict | None = None
    secret_keys: tuple = ("access_token", "Authorization")
    # follow-up call needed after this one (Instagram media_publish)
    note: str = ""

    def redacted(self) -> dict:
        def hide(d):
            return {k: ("***" if k in self.secret_keys else v) for k, v in (d or {}).items()} or None
        url = self.url
        if "/bot" in url:  # Telegram puts the token in the path
            head, _, tail = url.partition("/bot")
            url = head + "/bot***/" + tail.split("/", 1)[-1]
        return {"method": self.method, "url": url, "headers": hide(self.headers),
                "json": hide(self.json_body), "form": hide(self.form), "note": self.note}


def default_http(method, url, headers=None, json_body=None, form=None, timeout=30):
    data, hdrs = None, dict(headers or {})
    if json_body is not None:
        data = json.dumps(json_body).encode()
        hdrs["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https APIs)
            body = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(body)
        except ValueError:
            return exc.code, {"error": body[:200]}
    except (urllib.error.URLError, OSError) as exc:
        raise AdapterError(f"network error: {type(exc).__name__}") from None


def _env(name: str) -> str:
    return os.environ.get(name, "")


def compose(post, limit: int | None = None, with_link: bool = True) -> str:
    """caption + hashtags + tracked link, trimmed so the whole text fits `limit`."""
    tags = " ".join(json.loads(post["hashtags"]) if isinstance(post["hashtags"], str) else post["hashtags"])
    tail = "\n\n".join(p for p in (tags, post["link"] if with_link else "") if p)
    caption = post["caption"].strip()
    if limit is not None:
        # X counts any URL as 23 chars; for others the real length is used
        tail_len = len(tail) + 2 - (len(post["link"]) - 23 if with_link and post["link"] else 0)
        room = max(0, limit - tail_len)
        if len(caption) > room:
            caption = caption[: max(0, room - 1)].rstrip() + "…"
    return caption + ("\n\n" + tail if tail else "")


class Adapter:
    name = ""
    env: tuple = ()

    def configured(self) -> bool:
        return all(_env(n) for n in self.env)

    def missing(self) -> list:
        return [n for n in self.env if not _env(n)]

    def _check(self, status, data):
        if status == 429:
            raise RateLimited(self.name)
        if status >= 400:
            msg = ""
            if isinstance(data, dict):
                err = data.get("error")
                msg = str(err.get("message") if isinstance(err, dict) else err or data.get("message", ""))
            raise AdapterError(f"{self.name} HTTP {status}: {msg[:150]}")

    def build_publish(self, post) -> Request:
        raise NotImplementedError

    def publish(self, post, http=default_http) -> str:
        req = self.build_publish(post)
        status, data = http(req.method, req.url, req.headers, req.json_body, req.form)
        self._check(status, data)
        return str(data.get("id") or data.get("data", {}).get("id") or data.get("result", {}).get("message_id") or "")

    def build_reply(self, reply) -> Request:
        raise AdapterError(f"{self.name}: replying is not supported")

    def reply(self, reply, http=default_http) -> str:
        req = self.build_reply(reply)
        status, data = http(req.method, req.url, req.headers, req.json_body, req.form)
        self._check(status, data)
        return str(data.get("id") or data.get("data", {}).get("id") or "")

    def fetch_comments(self, external_id: str, http=default_http) -> list:
        return []


class Instagram(Adapter):
    name = "instagram"
    env = ("IG_ACCESS_TOKEN", "IG_USER_ID")

    def build_publish(self, post) -> Request:
        if not post["image_url"]:
            raise AdapterError("instagram needs a public image URL (image_url is empty)")
        return Request("POST", f"{GRAPH}/{_env('IG_USER_ID') or '{IG_USER_ID}'}/media",
                       form={"image_url": post["image_url"], "caption": compose(post, 2200),
                             "access_token": _env("IG_ACCESS_TOKEN") or "{IG_ACCESS_TOKEN}"},
                       note="step 1/2 create container; step 2 POST /media_publish {creation_id}")

    def publish(self, post, http=default_http) -> str:
        req = self.build_publish(post)
        status, data = http(req.method, req.url, req.headers, req.json_body, req.form)
        self._check(status, data)
        creation = data.get("id")
        if not creation:
            raise AdapterError("instagram: no container id")
        token = _env("IG_ACCESS_TOKEN")
        for _ in range(6):  # container must be FINISHED before publishing
            status, st = http("GET", f"{GRAPH}/{creation}?" + urllib.parse.urlencode(
                {"fields": "status_code", "access_token": token}), {}, None, None)
            self._check(status, st)
            if st.get("status_code") == "FINISHED":
                break
            if st.get("status_code") == "ERROR":
                raise AdapterError("instagram container error")
            time.sleep(5)
        status, data = http("POST", f"{GRAPH}/{_env('IG_USER_ID')}/media_publish", {}, None,
                            {"creation_id": creation, "access_token": token})
        self._check(status, data)
        return str(data.get("id", ""))

    def build_reply(self, reply) -> Request:
        return Request("POST", f"{GRAPH}/{reply['comment_id']}/replies",
                       form={"message": reply["reply_text"],
                             "access_token": _env("IG_ACCESS_TOKEN") or "{IG_ACCESS_TOKEN}"})

    def fetch_comments(self, external_id, http=default_http) -> list:
        status, data = http("GET", f"{GRAPH}/{external_id}/comments?" + urllib.parse.urlencode(
            {"fields": "id,text,username", "limit": 50, "access_token": _env("IG_ACCESS_TOKEN")}), {}, None, None)
        self._check(status, data)
        return [{"id": c["id"], "text": c.get("text", ""), "author": c.get("username", "")}
                for c in data.get("data", []) if c.get("id")]


class Facebook(Adapter):
    name = "facebook"
    env = ("FB_PAGE_TOKEN", "FB_PAGE_ID")

    def build_publish(self, post) -> Request:
        page, token = _env("FB_PAGE_ID") or "{FB_PAGE_ID}", _env("FB_PAGE_TOKEN") or "{FB_PAGE_TOKEN}"
        if post["image_url"]:
            return Request("POST", f"{GRAPH}/{page}/photos",
                           form={"url": post["image_url"], "caption": compose(post, 2000), "access_token": token})
        form = {"message": compose(post, 2000, with_link=False), "access_token": token}
        if post["link"]:
            form["link"] = post["link"]
        return Request("POST", f"{GRAPH}/{page}/feed", form=form)

    def build_reply(self, reply) -> Request:
        return Request("POST", f"{GRAPH}/{reply['comment_id']}/comments",
                       form={"message": reply["reply_text"],
                             "access_token": _env("FB_PAGE_TOKEN") or "{FB_PAGE_TOKEN}"})

    def fetch_comments(self, external_id, http=default_http) -> list:
        status, data = http("GET", f"{GRAPH}/{external_id}/comments?" + urllib.parse.urlencode(
            {"fields": "id,message,from", "limit": 50, "access_token": _env("FB_PAGE_TOKEN")}), {}, None, None)
        self._check(status, data)
        return [{"id": c["id"], "text": c.get("message", ""), "author": (c.get("from") or {}).get("name", "")}
                for c in data.get("data", []) if c.get("id")]


def _little_text(text: str) -> str:
    """Escape LinkedIn 'little text' reserved characters (hashtags keep their '#')."""
    out = []
    for ch in text:
        out.append("\\" + ch if ch in "\\|{}@[]()<>*_~" else ch)
    return "".join(out)


class LinkedIn(Adapter):
    name = "linkedin"
    env = ("LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN")

    def _headers(self) -> dict:
        return {"Authorization": "Bearer " + (_env("LINKEDIN_ACCESS_TOKEN") or "{LINKEDIN_ACCESS_TOKEN}"),
                "LinkedIn-Version": _env("LINKEDIN_API_VERSION") or "202510",
                "X-Restli-Protocol-Version": "2.0.0"}

    def build_publish(self, post) -> Request:
        body = {
            "author": _env("LINKEDIN_AUTHOR_URN") or "{LINKEDIN_AUTHOR_URN}",
            "commentary": _little_text(compose(post, 2900, with_link=False)),
            "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        if post["link"]:
            body["content"] = {"article": {"source": post["link"], "title": (post["source_title"] or "")[:200]}}
        return Request("POST", "https://api.linkedin.com/rest/posts", headers=self._headers(), json_body=body)

    def publish(self, post, http=default_http) -> str:
        req = self.build_publish(post)
        status, data = http(req.method, req.url, req.headers, req.json_body, req.form)
        self._check(status, data)  # LinkedIn answers 201 with the id in a header; body is empty
        return str(data.get("id", "created"))


class X(Adapter):
    name = "x"
    env = ("X_ACCESS_TOKEN",)  # OAuth 2.0 user-context token with tweet.write

    def build_publish(self, post) -> Request:
        return Request("POST", "https://api.x.com/2/tweets",
                       headers={"Authorization": "Bearer " + (_env("X_ACCESS_TOKEN") or "{X_ACCESS_TOKEN}")},
                       json_body={"text": compose(post, 280)})

    def build_reply(self, reply) -> Request:
        return Request("POST", "https://api.x.com/2/tweets",
                       headers={"Authorization": "Bearer " + (_env("X_ACCESS_TOKEN") or "{X_ACCESS_TOKEN}")},
                       json_body={"text": reply["reply_text"][:280],
                                  "reply": {"in_reply_to_tweet_id": reply["comment_id"]}})

    def fetch_comments(self, external_id, http=default_http) -> list:
        # recent search needs a paid API tier; a 403 simply means "not available"
        status, data = http("GET", "https://api.x.com/2/tweets/search/recent?" + urllib.parse.urlencode(
            {"query": f"conversation_id:{external_id} -is:retweet", "max_results": 20,
             "tweet.fields": "author_id"}),
            {"Authorization": "Bearer " + _env("X_ACCESS_TOKEN")}, None, None)
        if status in (401, 402, 403):
            return []
        self._check(status, data)
        return [{"id": t["id"], "text": t.get("text", ""), "author": t.get("author_id", "")}
                for t in data.get("data", [])]


class Telegram(Adapter):
    name = "telegram"
    env = ("TELEGRAM_CHANNEL_BOT_TOKEN", "TELEGRAM_CHANNEL_ID")  # not the owner control bot's token

    def build_publish(self, post) -> Request:
        api = (_env("TELEGRAM_API") or "https://api.telegram.org").rstrip("/")
        token = _env("TELEGRAM_CHANNEL_BOT_TOKEN") or "{TELEGRAM_CHANNEL_BOT_TOKEN}"
        chat = _env("TELEGRAM_CHANNEL_ID") or "{TELEGRAM_CHANNEL_ID}"
        if post["image_url"]:
            return Request("POST", f"{api}/bot{token}/sendPhoto",
                           json_body={"chat_id": chat, "photo": post["image_url"], "caption": compose(post, 1000)})
        return Request("POST", f"{api}/bot{token}/sendMessage",
                       json_body={"chat_id": chat, "text": compose(post, 4000),
                                  "disable_web_page_preview": False})

    def publish(self, post, http=default_http) -> str:
        req = self.build_publish(post)
        status, data = http(req.method, req.url, req.headers, req.json_body, req.form)
        self._check(status, data)
        if data and data.get("ok") is False:
            raise AdapterError("telegram: ok=false")
        return str((data.get("result") or {}).get("message_id", ""))


ADAPTERS = {c.name: c for c in (Instagram, Facebook, LinkedIn, X, Telegram)}


def get(platform: str) -> Adapter:
    if platform not in ADAPTERS:
        raise AdapterError(f"unknown platform {platform}")
    return ADAPTERS[platform]()
