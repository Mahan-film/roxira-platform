"""SQLite state for the marketing engine + the approval state machine (stdlib only).

Post lifecycle:   draft -> proposed -> approved -> publishing -> published | failed
                                    \\-> rejected
Reply lifecycle:  same names (table `replies`).
Nothing reaches `publishing` unless it was `approved` first; `approved` is only reachable
from `proposed` (i.e. after the owner saw it in the bot).
"""

from __future__ import annotations

import json
import os
import sqlite3
import time

DB_PATH = os.environ.get("MKT_DB", "/var/lib/roxira-marketing/marketing.db")

# status -> statuses it may move to
TRANSITIONS = {
    "draft": {"proposed", "rejected"},
    "proposed": {"approved", "rejected"},
    "approved": {"publishing", "rejected"},
    "publishing": {"published", "failed", "approved"},
    "failed": {"approved"},  # explicit retry only
    "published": set(),
    "rejected": set(),
}
TABLES = ("posts", "replies")

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  platform TEXT NOT NULL,
  campaign TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL DEFAULT '[]',
  link TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE (brand, platform, campaign, source_id)
);
CREATE INDEX IF NOT EXISTS posts_due ON posts (status, scheduled_at);
CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  platform TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  comment_id TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  incoming TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE (platform, comment_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: str | None = None):
        self.path = path or DB_PATH
        if self.path != ":memory:":
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _table(table: str) -> str:
        if table not in TABLES:
            raise ValueError("unknown table")
        return table

    def log(self, kind: str, detail: str) -> None:
        self.db.execute("INSERT INTO events (ts, kind, detail) VALUES (?,?,?)",
                        (int(time.time()), kind, detail[:500]))
        self.db.commit()

    # ------------------------------------------------------------------ posts
    def add_post(self, **f) -> int | None:
        """Insert a draft; returns the id, or None if (brand, platform, campaign, source) exists."""
        now = int(time.time())
        cur = self.db.execute(
            "INSERT OR IGNORE INTO posts (brand, platform, campaign, source_id, source_title, lang,"
            " caption, hashtags, link, image_prompt, scheduled_at, status, created, updated)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?)",
            (f["brand"], f["platform"], f["campaign"], f["source_id"], f.get("source_title", ""),
             f.get("lang", ""), f["caption"], json.dumps(f.get("hashtags", []), ensure_ascii=False),
             f.get("link", ""), f.get("image_prompt", ""), int(f["scheduled_at"]), now, now),
        )
        self.db.commit()
        return cur.lastrowid if cur.rowcount else None

    def add_reply(self, **f) -> int | None:
        now = int(time.time())
        cur = self.db.execute(
            "INSERT OR IGNORE INTO replies (brand, platform, post_id, comment_id, author, incoming,"
            " reply_text, status, created, updated) VALUES (?,?,?,?,?,?,?, 'draft', ?, ?)",
            (f["brand"], f["platform"], f["post_id"], f["comment_id"], f.get("author", ""),
             f["incoming"], f["reply_text"], now, now),
        )
        self.db.commit()
        return cur.lastrowid if cur.rowcount else None

    def get(self, table: str, row_id: int):
        return self.db.execute(f"SELECT * FROM {self._table(table)} WHERE id=?", (int(row_id),)).fetchone()

    def list(self, table: str, **where) -> list:
        clause = " AND ".join(f"{k}=?" for k in where) or "1=1"
        return self.db.execute(
            f"SELECT * FROM {self._table(table)} WHERE {clause} ORDER BY id", tuple(where.values())
        ).fetchall()

    def seen_comment(self, platform: str, comment_id: str) -> bool:
        return self.db.execute(
            "SELECT 1 FROM replies WHERE platform=? AND comment_id=?", (platform, comment_id)
        ).fetchone() is not None

    def has_source(self, brand: str, platform: str, source_id: str) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM posts WHERE brand=? AND platform=? AND source_id=? AND status!='rejected'",
            (brand, platform, source_id),
        ).fetchone()[0]

    # ----------------------------------------------------------- state machine
    def transition(self, table: str, row_id: int, new: str, *, error: str = "",
                   external_id: str = "", only_from: str = "", **extra) -> bool:
        """Atomically move a row to `new`; False if the move is not allowed from its status."""
        table = self._table(table)
        allowed_from = [s for s, to in TRANSITIONS.items() if new in to and (not only_from or s == only_from)]
        if not allowed_from:
            return False
        sets = ["status=?", "updated=?"]
        args: list = [new, int(time.time())]
        if error or new in ("failed", "approved"):
            sets.append("error=?")
            args.append(error[:500])
        if external_id:
            sets.append("external_id=?")
            args.append(external_id)
        for key, value in extra.items():
            if key not in ("scheduled_at", "image_path", "image_url"):
                raise ValueError("column not updatable")
            sets.append(f"{key}=?")
            args.append(value)
        marks = ",".join("?" for _ in allowed_from)
        cur = self.db.execute(
            f"UPDATE {table} SET {', '.join(sets)} WHERE id=? AND status IN ({marks})",
            (*args, int(row_id), *allowed_from),
        )
        self.db.commit()
        return cur.rowcount == 1

    def set_fields(self, table: str, row_id: int, **extra) -> None:
        for key in extra:
            if key not in ("image_path", "image_url", "scheduled_at", "caption", "reply_text"):
                raise ValueError("column not updatable")
        sets = ", ".join(f"{k}=?" for k in extra)
        self.db.execute(f"UPDATE {self._table(table)} SET {sets}, updated=? WHERE id=?",
                        (*extra.values(), int(time.time()), int(row_id)))
        self.db.commit()

    def due(self, table: str, now: int | None = None) -> list:
        col = "scheduled_at" if table == "posts" else "created"
        return self.db.execute(
            f"SELECT * FROM {self._table(table)} WHERE status='approved' AND {col}<=? ORDER BY {col}, id",
            (int(now if now is not None else time.time()),),
        ).fetchall()

    def published_since(self, platform: str, since: int) -> int:
        a = self.db.execute("SELECT COUNT(*) FROM posts WHERE platform=? AND status='published' AND updated>=?",
                            (platform, since)).fetchone()[0]
        b = self.db.execute("SELECT COUNT(*) FROM replies WHERE platform=? AND status='published' AND updated>=?",
                            (platform, since)).fetchone()[0]
        return a + b
