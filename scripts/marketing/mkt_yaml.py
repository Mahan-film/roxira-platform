"""Tiny YAML-subset reader for brand profiles (stdlib only).

Supports: `key: scalar`, nested maps by 2+-space indentation, `- item` lists of scalars,
inline lists `[a, b]`, quoted strings, ints, true/false, and `#` comments. Anything else
(anchors, multi-line scalars, lists of maps) is rejected on purpose: brand files stay simple.
If PyYAML happens to be installed it is used instead.
"""

from __future__ import annotations

import re


def _scalar(text: str):
    text = text.strip()
    if not text:
        return ""
    if text[0] in "\"'" and len(text) >= 2 and text[-1] == text[0]:
        return text[1:-1]
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        return [_scalar(p) for p in _split_inline(inner)] if inner else []
    low = text.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return text


def _split_inline(inner: str) -> list:
    parts, cur, quote = [], "", ""
    for ch in inner:
        if quote:
            cur += ch
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == ",":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def _strip_comment(line: str) -> str:
    quote = ""
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
    return line


def parse(text: str) -> dict:
    try:  # pragma: no cover - depends on the host
        import yaml  # type: ignore

        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except ImportError:
        pass
    lines = []
    for raw in text.splitlines():
        stripped = _strip_comment(raw).rstrip()
        if stripped.strip():
            lines.append((len(stripped) - len(stripped.lstrip(" ")), stripped.strip()))
    result, _ = _block(lines, 0, 0)
    return result


def _block(lines: list, pos: int, indent: int):
    out: dict = {}
    while pos < len(lines):
        ind, content = lines[pos]
        if ind < indent:
            break
        if ind > indent:
            raise ValueError(f"bad indentation near: {content!r}")
        if content.startswith("- "):
            raise ValueError(f"unexpected list item: {content!r}")
        key, sep, rest = content.partition(":")
        if not sep:
            raise ValueError(f"expected 'key: value', got {content!r}")
        key, rest = key.strip().strip("\"'"), rest.strip()
        pos += 1
        if rest:
            out[key] = _scalar(rest)
            continue
        if pos < len(lines) and lines[pos][0] > indent or (
            pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("- ")
        ):
            child_indent = lines[pos][0]
            if lines[pos][1].startswith("- "):
                items = []
                while pos < len(lines) and lines[pos][0] == child_indent and lines[pos][1].startswith("- "):
                    items.append(_scalar(lines[pos][1][2:]))
                    pos += 1
                out[key] = items
            else:
                out[key], pos = _block(lines, pos, child_indent)
        else:
            out[key] = ""
    return out, pos
