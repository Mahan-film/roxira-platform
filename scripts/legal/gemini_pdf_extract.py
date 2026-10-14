"""Extract public legal PDFs (e.g. CBI circulars) to JSONL with the Gemini API reading the PDF itself.

Usage (on the server, key read from the env file, never printed):
  python3 scripts/legal/gemini_pdf_extract.py --prompt docs/gemini_handoff/01_cbi_circulars_extract.md \
      --out data/legal/staged/cbi_circulars_gemini_2026-10-14.jsonl --workers 3 PDF...

Public documents only (no customer data): the Gemini free tier may log prompts.
Each PDF is sent inline (application/pdf). Models are tried in order; on 429/5xx/timeout the next one is used.
Only complete JSON lines are kept; a PDF whose output is empty or broken is reported, never guessed.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MODELS = ["gemini-flash-latest", "gemini-3.7-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"]
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def load_key(env_file: str) -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key and Path(env_file).is_file():
        for line in Path(env_file).read_text(encoding="utf-8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("GEMINI_API_KEY not set")
    return key


def prompt_text(path: str) -> str:
    text = Path(path).read_text(encoding="utf-8")
    return text.split("\n---\n", 1)[1] if "\n---\n" in text else text


def call(model: str, key: str, prompt: str, pdf: bytes, timeout: int = 300) -> str:
    body = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(pdf).decode()}},
            {"text": prompt},
        ]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 65536},
    }
    req = urllib.request.Request(API.format(model=model), data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key,
                                          "User-Agent": "roxira-legal/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read())
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def parse_lines(text: str) -> tuple[list[dict], int]:
    rows, bad = [], 0
    for line in re.sub(r"```(?:json|jsonl)?", "", text).splitlines():
        s = line.strip()
        if not s.startswith("{"):
            continue
        try:
            rows.append(json.loads(s))
        except json.JSONDecodeError:
            bad += 1
    return rows, bad


def extract(pdf_path: Path, key: str, prompt: str) -> tuple[str, list[dict], str]:
    pdf = pdf_path.read_bytes()
    note = f"Process ONLY this one file. Its source_file is {pdf_path.name}.\n\n"
    last = ""
    for model in MODELS:
        for attempt in range(2):
            try:
                rows, bad = parse_lines(call(model, key, note + prompt, pdf))
                if rows and not bad:
                    for r in rows:
                        r.setdefault("source_file", pdf_path.name)
                        r["extracted_by"] = f"gemini-api:{model}"
                    return pdf_path.name, rows, f"ok {model} rows={len(rows)}"
                last = f"{model}: rows={len(rows)} broken={bad}"
            except urllib.error.HTTPError as e:
                last = f"{model}: HTTP {e.code}"
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(10 * (attempt + 1))
                    continue
                break
            except Exception as e:  # timeout / network
                last = f"{model}: {type(e).__name__}"
                time.sleep(5)
        # next model
    return pdf_path.name, [], f"FAILED ({last})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--env-file", default="/opt/roxira_platform/.env")
    a = ap.parse_args()
    key, prompt = load_key(a.env_file), prompt_text(a.prompt)
    out = Path(a.out)
    done = set()
    if out.is_file():
        done = {json.loads(l).get("source_file") for l in out.read_text(encoding="utf-8").splitlines() if l.strip()}
    todo = [Path(p) for p in a.pdfs if Path(p).name not in done]
    print(f"{len(todo)} to do, {len(done)} already in {out}", flush=True)
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex, out.open("a", encoding="utf-8") as fh:
        for name, rows, status in ex.map(lambda p: extract(p, key, prompt), todo):
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
            fh.flush()
            print(f"{name}: {status}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
