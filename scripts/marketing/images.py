"""Image hook: image prompt -> PNG under MKT_MEDIA_DIR (stdlib; Pillow optional).

1. If MKT_IMAGE_GROUP is set, ask the key pool (/images/generations).
2. Otherwise / on failure, render a simple branded text card with Pillow if it is installed
   (skipped for right-to-left languages unless Pillow has raqm text shaping, because plain
   Pillow would draw Persian letters unjoined).
3. Else return None; the post simply has no image (Instagram posts then cannot be published).

Files are served later by our nginx (document only, see docs/marketing/SETUP.md):
public URL = <brand media_base_url>/<file name>.
"""

from __future__ import annotations

import os
import textwrap

import mkt_llm

MEDIA_DIR = os.environ.get("MKT_MEDIA_DIR", "/var/lib/roxira-marketing/media")
RTL_LANGS = ("fa", "ar", "he", "ur")
SIZE = 1080


def _write(path: str, data: bytes) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def text_card(path: str, title: str, brand_name: str, lang: str = "en", color: str = "#1f3a5f"):
    """Render a branded card with Pillow; returns path or None when it cannot be done right."""
    try:
        from PIL import Image, ImageDraw, ImageFont, features
    except ImportError:
        return None
    if lang in RTL_LANGS and not features.check("raqm"):
        return None
    img = Image.new("RGB", (SIZE, SIZE), color)
    draw = ImageDraw.Draw(img)
    font = big = ImageFont.load_default()
    for candidate in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                      "/usr/share/fonts/truetype/vazirmatn/Vazirmatn-Bold.ttf"):
        try:
            big = ImageFont.truetype(candidate, 64)
            font = ImageFont.truetype(candidate, 40)
            break
        except OSError:
            continue
    y = 220
    for line in textwrap.wrap(title, width=22)[:8]:
        draw.text((90, y), line, fill="white", font=big, direction="rtl" if lang in RTL_LANGS else None)
        y += 90
    draw.text((90, SIZE - 140), brand_name, fill="#cfd8e3", font=font)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    return path


def ensure_image(post, brand: dict, *, generate=None, card=text_card, media_dir: str | None = None):
    """Return (image_path, image_url) for a post row; ('', '') when no image could be made.

    `generate(prompt) -> bytes` defaults to the key pool; injectable for tests.
    """
    media_dir = media_dir or MEDIA_DIR
    name = f"{brand['id']}-{post['id']}.png"
    path = os.path.join(media_dir, name)
    made = os.path.isfile(path)
    if not made and mkt_llm.image_group() and post["image_prompt"]:
        try:
            _write(path, (generate or mkt_llm.image_png)(post["image_prompt"]))
            made = True
        except Exception:  # LLMError, network, decode: fall through to the text card
            made = False
    if not made:
        made = bool(card(path, post["source_title"] or post["caption"][:80], brand["name"],
                         post["lang"] or "en"))
    if not made:
        return "", ""
    base = str(brand.get("media_base_url", "")).rstrip("/")
    return path, (f"{base}/{name}" if base else "")
