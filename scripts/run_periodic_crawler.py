#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
رونر دوره‌ای تزریق قوانین و آرای وحدت رویه (Task 5 — Automated Ingestion Runner).

روزانه ساعت ۰۳:۳۰ از طریق cron اجرا می‌شود:
    30 3 * * * cd /opt/roxira_platform && python3 scripts/run_periodic_crawler.py >> /var/log/legal_crawler.log 2>&1

منبع داده (drop-in):
    data/legal_corpus/laws/*.txt        ← قوانین (چانک‌بندی ماده‌محور با parse_and_chunk_law)
    data/legal_corpus/precedents/*.txt  ← آرای وحدت رویه جدید (هر رأی جدا با خط «===»)

فرمت هر فایل (دستورهای اختیاری در ابتدای فایل):
    # CATEGORY: CIVIL          ← دسته گراف (پیش‌فرض: laws→LAW ، precedents→PRECEDENT)
    # TITLE: قانون نمونه       ← عنوان قانون (پیش‌فرض: نام فایل)

رفتار:
  • فقط فایل‌های «جدید یا تغییر‌یافته» پردازش می‌شوند (ردیابی sha256 در
    data/legal_corpus/.ingest_state.json) — آرای تازه منتشرشده در اجرای بعدی جذب می‌شوند.
  • تزریق «فقط» با توابع تأییدشده انجام می‌شود: parse_and_chunk_law و
    ingest_to_postgres_and_qdrant از scripts/legal_data_ingestor.py (گراف PostgreSQL +
    آماده‌سازی کالکشن Qdrant؛ بدون وکتور ساختگی — payload آماده bge-m3).
  • اجرای دو حالته: اگر پایتون میزبان psycopg داشت → حالت native؛ در غیر این صورت
    درایور داخل کانتینر roxira_app_prod اجرا می‌شود (docker exec -i) که psycopg 3.3.5
    و مسیر یکسان data/ را دارد — cron بدون هیچ نصبی روی میزبان کار می‌کند.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys

BASE_DIR = pathlib.Path("/opt/roxira_platform")
CORPUS_DIR = BASE_DIR / "data" / "legal_corpus"
STATE_FILE = CORPUS_DIR / ".ingest_state.json"
INGESTOR_PATH = BASE_DIR / "scripts" / "legal_data_ingestor.py"
CONTAINER_NAME = os.getenv("CRAWLER_CONTAINER", "roxira_app_prod")
RESULT_MARKER = "###RESULT_JSON###"

KIND_DEFAULT_CATEGORY = {"laws": "LAW", "precedents": "PRECEDENT"}
KIND_COLLECTION = {"laws": "iran_laws_bge_m3", "precedents": "judicial_precedents"}


def _log(msg: str) -> None:
    print(f"[{datetime.datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _discover_new_files(state: dict) -> list:
    """فایل‌های جدید/تغییریافته هر دو مسیر laws و precedents را برمی‌گرداند."""
    new_files = []
    if not CORPUS_DIR.exists():
        return new_files
    for kind in KIND_DEFAULT_CATEGORY:
        folder = CORPUS_DIR / kind
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.txt")):
            digest = _sha256(path.read_bytes())
            rel = f"{kind}/{path.name}"
            rec = state.get(rel)
            if rec and rec.get("sha256") == digest:
                continue  # بدون تغییر — قبلاً تزریق شده
            new_files.append({"rel": rel, "kind": kind, "sha256": digest})
    return new_files


def _host_has_psycopg() -> bool:
    """بررسی وجود درایور psycopg روی میزبان (حالت native)."""
    try:
        subprocess.run([sys.executable, "-c", "import psycopg"],
                       check=True, capture_output=True, timeout=30)
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# درایور تزریق — در هر دو حالت به‌صورت subprocess اجرا می‌شود؛ منبع ingestor
# با base64 جاسازی می‌شود تا حالت container (بدون mount بودن scripts/) هم کار کند.
# ─────────────────────────────────────────────────────────────────────────────
DRIVER_TEMPLATE = r'''
import base64, hashlib, json, os, pathlib, re, sys

os.environ.setdefault("POSTGRES_HOST", "127.0.0.1")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("QDRANT_HOST", "127.0.0.1")
os.environ.setdefault("QDRANT_PORT", "6333")

CORPUS = pathlib.Path("/opt/roxira_platform/data/legal_corpus")
INGESTOR_SRC = base64.b64decode("__INGESTOR_B64__").decode("utf-8")
FILES = json.loads(base64.b64decode("__FILES_B64__").decode("utf-8"))

_ns = {"__name__": "legal_data_ingestor"}
exec(compile(INGESTOR_SRC, "legal_data_ingestor.py", "exec"), _ns)
parse_and_chunk_law = _ns["parse_and_chunk_law"]
ingest_to_postgres_and_qdrant = _ns["ingest_to_postgres_and_qdrant"]


def split_directives(raw):
    meta, lines, i = {}, raw.splitlines(), 0
    while i < len(lines):
        s = lines[i].strip()
        if s.startswith("# CATEGORY:"):
            meta["category"] = s.split(":", 1)[1].strip(); i += 1
        elif s.startswith("# TITLE:"):
            meta["title"] = s.split(":", 1)[1].strip(); i += 1
        elif s == "":
            i += 1
        else:
            break
    return meta, "\n".join(lines[i:])


def chunk_precedents(body, category):
    """هر رأی (جدا شده با خط ===) یک چانک مستقل با node_id پایدار هش‌محور."""
    rulings = [r.strip() for r in re.split(r"(?m)^===+\s*$", body) if r.strip()]
    chunks = []
    for r in rulings:
        h = hashlib.sha256(r.encode("utf-8")).hexdigest()[:12]
        first_line = r.splitlines()[0][:120]
        chunks.append({
            "node_id": category + "-PRECEDENT-" + h,
            "article_number": "",
            "title": first_line,
            "category": category,
            "text": r,
        })
    return chunks


results = []
for f in FILES:
    path = CORPUS / f["rel"]
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
        meta, body = split_directives(raw)
        category = meta.get("category") or f["default_category"]
        title = meta.get("title") or path.stem
        if f["kind"] == "laws":
            chunks = parse_and_chunk_law(body, title, category)
        else:
            chunks = chunk_precedents(body, category)
        if not chunks:
            results.append({"rel": f["rel"], "ok": False, "error": "NO_CHUNKS_PARSED"})
            continue
        collection = "iran_laws_bge_m3" if f["kind"] == "laws" else "judicial_precedents"
        res = ingest_to_postgres_and_qdrant(chunks, law_title=title, is_sample=False,
                                            collection_name=collection)
        pg = res.get("postgres", {})
        results.append({
            "rel": f["rel"], "kind": f["kind"], "category": category, "title": title,
            "ok": bool(pg.get("ok")), "chunks": pg.get("inserted", 0),
            "verified": pg.get("verified", 0), "node_ids": pg.get("node_ids", []),
            "qdrant_ok": bool(res.get("qdrant", {}).get("ok")),
            "qdrant_points": res.get("qdrant", {}).get("points_count"),
            "collection": collection,
        })
    except Exception as exc:
        results.append({"rel": f["rel"], "ok": False, "error": str(exc)[:300]})

print("__RESULT_MARKER__" + json.dumps(results, ensure_ascii=False))
'''


def _build_driver(files: list) -> str:
    """ساخت درایور نهایی با جاسازی منبع ingestor و فهرست فایل‌ها (base64)."""
    ingestor_b64 = base64.b64encode(INGESTOR_PATH.read_bytes()).decode("ascii")
    files_payload = [{"rel": f["rel"], "kind": f["kind"],
                      "default_category": KIND_DEFAULT_CATEGORY[f["kind"]]} for f in files]
    files_b64 = base64.b64encode(json.dumps(files_payload).encode("utf-8")).decode("ascii")
    driver = DRIVER_TEMPLATE.replace("__INGESTOR_B64__", ingestor_b64)
    driver = driver.replace("__FILES_B64__", files_b64)
    return driver.replace("__RESULT_MARKER__", RESULT_MARKER)


def _run_driver(driver: str, mode: str) -> list:
    """اجرای درایور: native روی میزبان یا داخل کانتینر تولیدی؛ خروجی JSON استخراج می‌شود."""
    if mode == "native":
        proc = subprocess.run([sys.executable, "-"], input=driver.encode("utf-8"),
                              capture_output=True, timeout=1800)
    else:
        proc = subprocess.run(["docker", "exec", "-i", CONTAINER_NAME, "python", "-"],
                              input=driver.encode("utf-8"), capture_output=True, timeout=1800)
    out = proc.stdout.decode("utf-8", errors="replace")
    result_lines = [ln for ln in out.splitlines() if RESULT_MARKER in ln]
    if not result_lines:
        tail = "\n".join(out.splitlines()[-12:])
        stderr_tail = proc.stderr.decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"driver produced no result (exit={proc.returncode})\nstderr: {stderr_tail}\nstdout-tail: {tail}")
    return json.loads(result_lines[-1].split(RESULT_MARKER, 1)[1])


def main() -> int:
    _log("=== Roxira Periodic Legal Crawler — شروع چرخه تزریق ===")
    state = _load_state()
    files = _discover_new_files(state)
    if not files:
        _log("فایل جدید یا تغییر‌یافته‌ای برای تزریق وجود ندارد — خروج بدون عملیات.")
        return 0
    _log(f"{len(files)} فایل جدید/تغییریافته شناسایی شد: {[f['rel'] for f in files]}")

    mode = "native" if _host_has_psycopg() else "container"
    if mode == "container":
        probe = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME],
                               capture_output=True, timeout=60)
        if probe.returncode != 0 or b"true" not in probe.stdout.lower():
            _log(f"خطا: حالت container نیازمند اجرای کانتینر {CONTAINER_NAME} است.")
            return 1
    _log("حالت اجرا: " + mode + " | توابع تأییدشده: parse_and_chunk_law + ingest_to_postgres_and_qdrant")

    try:
        results = _run_driver(_build_driver(files), mode)
    except Exception as exc:
        _log(f"خطا در اجرای درایور تزریق: {exc}")
        return 1

    ok_count = 0
    for r in results:
        if r.get("ok"):
            ok_count += 1
            state[r["rel"]] = {
                "sha256": next(f["sha256"] for f in files if f["rel"] == r["rel"]),
                "chunks": r.get("chunks", 0),
                "collection": r.get("collection"),
                "mode": mode,
                "ingested_at": datetime.datetime.now().isoformat(timespec="seconds"),
            }
            _log(f"✅ {r['rel']}: {r.get('chunks', 0)} چانک تزریق و {r.get('verified', 0)} مورد تأیید شد "
                 f"(category={r.get('category')} | collection={r.get('collection')} | qdrant_ok={r.get('qdrant_ok')})")
        else:
            _log(f"⚠️ {r['rel']}: تزریق ناموفق — {r.get('error', 'نامشخص')}")

    _save_state(state)
    _log(f"=== چرخه تمام شد: {ok_count}/{len(results)} فایل تزریق شد؛ state به‌روزرسانی شد ===")
    return 0 if ok_count == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

