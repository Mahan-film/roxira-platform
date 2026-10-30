#!/usr/bin/env python3
"""Cloudflare R2 (S3 API) client for the hourly encrypted Postgres + configs copy. Standard library only.

The server has no aws/rclone, so this signs requests itself (AWS Signature V4, path style).
Only age-encrypted files are ever uploaded: `put` refuses a file that lacks the age header.

Sub-commands (credentials come from the environment, never from arguments):
  put FILE KEY        upload FILE (must be age-encrypted) as object KEY
  get KEY FILE        download object KEY to FILE
  latest PREFIX       print the newest object key under PREFIX and its age in seconds ("KEY AGE")
  prune               apply the retention policy to hourly/ and daily/ and delete the rest
  plan-prune          print what `prune` would delete, delete nothing

Env (R2 names first, the existing BACKUP_S3_* names are the fallback):
  BACKUP_R2_ENDPOINT / BACKUP_S3_ENDPOINT          https://<account-id>.r2.cloudflarestorage.com
  BACKUP_R2_BUCKET / BACKUP_S3_BUCKET
  BACKUP_R2_ACCESS_KEY_ID / BACKUP_S3_ACCESS_KEY_ID
  BACKUP_R2_SECRET_ACCESS_KEY / BACKUP_S3_SECRET_ACCESS_KEY
  BACKUP_R2_PREFIX (default "pgcfg")               every key lives under <prefix>/hourly/ or <prefix>/daily/
  BACKUP_R2_KEEP_HOURLY_DAYS (7), BACKUP_R2_KEEP_DAILY_DAYS (30)
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import http.client
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

AGE_MAGIC = b"age-encryption.org/v1"
EMPTY_SHA = hashlib.sha256(b"").hexdigest()
KEY_RE = re.compile(r"(?P<prefix>.*)/(?P<kind>hourly|daily)/(?P<ts>20\d{6}T\d{6}Z)\.tar\.age$")


# ---------------------------------------------------------------- SigV4 (pure, tested against the AWS vector)
def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign_request(method: str, host: str, path: str, query: dict, headers: dict, payload_hash: str,
                 region: str, access_key: str, secret_key: str, amz_date: str, service: str = "s3") -> dict:
    """Return `headers` plus x-amz-date, x-amz-content-sha256 and Authorization."""
    hdrs = {k.lower(): str(v).strip() for k, v in headers.items()}
    hdrs["host"] = host
    hdrs["x-amz-date"] = amz_date
    hdrs["x-amz-content-sha256"] = payload_hash
    names = sorted(hdrs)
    canon_headers = "".join(f"{n}:{hdrs[n]}\n" for n in names)
    signed = ";".join(names)
    canon_query = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(str(v), safe='-_.~')}"
                           for k, v in sorted(query.items()))
    canon_path = urllib.parse.quote(path, safe="/-_.~")
    canonical = "\n".join([method, canon_path, canon_query, canon_headers, signed, payload_hash])
    day = amz_date[:8]
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = _hmac(("AWS4" + secret_key).encode(), day)
    for part in (region, service, "aws4_request"):
        k = _hmac(k, part)
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    hdrs["authorization"] = (f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                             f"SignedHeaders={signed}, Signature={sig}")
    return hdrs


# ---------------------------------------------------------------- retention (pure, tested)
def parse_key(key: str):
    m = KEY_RE.match(key)
    if not m:
        return None
    ts = datetime.strptime(m["ts"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    return m["kind"], ts


def select_prune(keys: list[str], now: datetime, hourly_days: int = 7, daily_days: int = 30) -> list[str]:
    """Keys to delete. hourly/ older than hourly_days and daily/ older than daily_days go.
    The newest hourly and newest daily object are never deleted. Keys that do not match the
    naming scheme are left alone (this tool only removes what it created)."""
    parsed = [(k, *p) for k in keys if (p := parse_key(k))]
    newest = {kind: max((ts for _, kk, ts in parsed if kk == kind), default=None) for kind in ("hourly", "daily")}
    limit = {"hourly": timedelta(days=hourly_days), "daily": timedelta(days=daily_days)}
    out = [k for k, kind, ts in parsed if now - ts > limit[kind] and ts != newest[kind]]
    return sorted(out)


# ---------------------------------------------------------------- S3 calls
class R2:
    def __init__(self, env=os.environ):
        def pick(a, b):
            return env.get(a) or env.get(b) or ""
        self.endpoint = pick("BACKUP_R2_ENDPOINT", "BACKUP_S3_ENDPOINT")
        self.bucket = pick("BACKUP_R2_BUCKET", "BACKUP_S3_BUCKET")
        self.ak = pick("BACKUP_R2_ACCESS_KEY_ID", "BACKUP_S3_ACCESS_KEY_ID")
        self.sk = pick("BACKUP_R2_SECRET_ACCESS_KEY", "BACKUP_S3_SECRET_ACCESS_KEY")
        self.prefix = (env.get("BACKUP_R2_PREFIX") or "pgcfg").strip("/")
        self.hourly_days = int(env.get("BACKUP_R2_KEEP_HOURLY_DAYS", "7"))
        self.daily_days = int(env.get("BACKUP_R2_KEEP_DAILY_DAYS", "30"))
        missing = [n for n, v in (("endpoint", self.endpoint), ("bucket", self.bucket),
                                  ("access key id", self.ak), ("secret access key", self.sk)) if not v]
        if missing:
            raise SystemExit("r2_tools: R2 settings missing: " + ", ".join(missing))
        u = urllib.parse.urlparse(self.endpoint)
        if u.scheme != "https" or not u.netloc:
            raise SystemExit("r2_tools: endpoint must be an https URL")
        self.host = u.netloc

    def _request(self, method: str, key: str, query: dict | None = None, body_path: Path | None = None,
                 out_path: Path | None = None):
        path = f"/{self.bucket}/{key}" if key else f"/{self.bucket}"
        payload_hash = EMPTY_SHA
        headers: dict = {}
        if body_path is not None:
            h = hashlib.sha256()
            with open(body_path, "rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    h.update(block)
            payload_hash = h.hexdigest()
            headers["content-length"] = str(body_path.stat().st_size)
        amz_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        signed = sign_request(method, self.host, path, query or {}, headers, payload_hash,
                              "auto", self.ak, self.sk, amz_date)
        q = urllib.parse.urlencode(sorted((query or {}).items()), quote_via=urllib.parse.quote)
        conn = http.client.HTTPSConnection(self.host, timeout=600)
        try:
            conn.putrequest(method, urllib.parse.quote(path, safe="/-_.~") + (f"?{q}" if q else ""),
                            skip_host=True, skip_accept_encoding=True)
            for k, v in signed.items():
                conn.putheader(k, v)
            conn.endheaders()
            if body_path is not None:
                with open(body_path, "rb") as fh:
                    for block in iter(lambda: fh.read(1 << 20), b""):
                        conn.send(block)
            resp = conn.getresponse()
            if out_path is not None and resp.status == 200:
                with open(out_path, "wb") as fh:
                    for block in iter(lambda: resp.read(1 << 20), b""):
                        fh.write(block)
                return resp.status, b""
            return resp.status, resp.read()
        finally:
            conn.close()

    def put(self, file: Path, key: str) -> None:
        with open(file, "rb") as fh:
            if fh.read(len(AGE_MAGIC)) != AGE_MAGIC:
                raise SystemExit("r2_tools: refusing to upload a file that is not age-encrypted")
        st, body = self._request("PUT", key, body_path=file)
        if st not in (200, 201):
            raise SystemExit(f"r2_tools: PUT {key} failed: HTTP {st} {body[:200]!r}")

    def get(self, key: str, file: Path) -> None:
        st, body = self._request("GET", key, out_path=file)
        if st != 200:
            raise SystemExit(f"r2_tools: GET {key} failed: HTTP {st} {body[:200]!r}")

    def delete(self, key: str) -> None:
        st, body = self._request("DELETE", key)
        if st not in (200, 204):
            raise SystemExit(f"r2_tools: DELETE {key} failed: HTTP {st} {body[:200]!r}")

    def list_keys(self, prefix: str) -> list[str]:
        keys, token = [], None
        while True:
            q = {"list-type": "2", "prefix": prefix}
            if token:
                q["continuation-token"] = token
            st, body = self._request("GET", "", query=q)
            if st != 200:
                raise SystemExit(f"r2_tools: LIST failed: HTTP {st} {body[:200]!r}")
            root = ET.fromstring(body)
            ns = {"s": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
            find = (lambda n: root.findall(f"s:{n}", ns)) if ns else (lambda n: root.findall(n))
            for c in find("Contents"):
                k = c.find("s:Key", ns) if ns else c.find("Key")
                if k is not None and k.text:
                    keys.append(k.text)
            trunc = find("IsTruncated")
            nxt = find("NextContinuationToken")
            if trunc and trunc[0].text == "true" and nxt:
                token = nxt[0].text
            else:
                return keys


def cmd_latest(r: R2, prefix: str) -> int:
    best = None
    for k in r.list_keys(prefix):
        p = parse_key(k)
        if p and (best is None or p[1] > best[1]):
            best = (k, p[1])
    if best is None:
        print("none")
        return 3
    age = int((datetime.now(timezone.utc) - best[1]).total_seconds())
    print(f"{best[0]} {age}")
    return 0


def cmd_prune(r: R2, dry: bool) -> int:
    keys = r.list_keys(r.prefix + "/")
    victims = select_prune(keys, datetime.now(timezone.utc), r.hourly_days, r.daily_days)
    for k in victims:
        print(("would delete " if dry else "delete ") + k)
        if not dry:
            r.delete(k)
    print(f"{len(victims)} of {len(keys)} object(s) {'would be ' if dry else ''}removed")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("put"); p.add_argument("file"); p.add_argument("key")
    g = sub.add_parser("get"); g.add_argument("key"); g.add_argument("file")
    l = sub.add_parser("latest"); l.add_argument("prefix")
    sub.add_parser("prune")
    sub.add_parser("plan-prune")
    a = ap.parse_args(argv)
    r = R2()
    if a.cmd == "put":
        r.put(Path(a.file), a.key)
    elif a.cmd == "get":
        r.get(a.key, Path(a.file))
    elif a.cmd == "latest":
        return cmd_latest(r, a.prefix)
    else:
        return cmd_prune(r, a.cmd == "plan-prune")
    return 0


if __name__ == "__main__":
    sys.exit(main())
