"""Security regression tests for the SmartJudge VIP/JWT gate (issue #371).

Covers the fixes in output_apps/generated_modules/smartjudge/smartjudge_module.py:

- no hardcoded JWT fallback key remains in the source;
- a missing ``JWT_SECRET`` yields a random, non-empty per-process secret;
- ``JWT_TTL_SECONDS`` defaults to 7 days and clamps to 300..2592000;
- ``_decode_jwt`` rejects tokens without ``exp``, expired tokens, and tokens
  whose header ``alg`` is not HS256;
- the VIP phone allowlist comes from ``VIP_PHONE_ALLOWLIST`` (empty if unset).

The module pulls in FastAPI/psycopg and is loaded inside a fixture so this file
has no import-time side effects (see src/test_ci_quarantine_guard.py). Nothing
here touches the DB or the network.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import pathlib
import time

import pytest

MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "output_apps/generated_modules/smartjudge/smartjudge_module.py"
)


@pytest.fixture(scope="module")
def sj():
    from output_apps.generated_modules.smartjudge import smartjudge_module

    return smartjudge_module


def test_no_hardcoded_default_secret_in_source():
    text = MODULE_PATH.read_text(encoding="utf-8")
    # The removed fallback key ended in this suffix; build the needle so the
    # test itself never carries the literal.
    old_key_suffix = "_20" + '26"'
    assert old_key_suffix not in text


def test_missing_env_generates_random_nonempty_secret(sj, monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)

    first = sj._resolve_jwt_secret()
    second = sj._resolve_jwt_secret()

    assert isinstance(first, bytes)
    assert first
    assert first != second  # random per process/call, never a shared default


def test_explicit_env_secret_is_used_verbatim(sj):
    assert sj._resolve_jwt_secret("  env-provided-key  ") == b"env-provided-key"


def test_ttl_default_and_clamp(sj):
    assert sj._resolve_jwt_ttl_seconds("") == 60 * 60 * 24 * 7
    assert sj._resolve_jwt_ttl_seconds("not-a-number") == 60 * 60 * 24 * 7
    assert sj._resolve_jwt_ttl_seconds("10") == 300
    assert sj._resolve_jwt_ttl_seconds("99999999") == 2592000
    assert sj._resolve_jwt_ttl_seconds("3600") == 3600


def _token_with_header(sj, header: dict, payload: dict) -> str:
    segments = [
        sj._b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        sj._b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = hmac.new(sj.JWT_SECRET, signing_input, hashlib.sha256).digest()
    segments.append(sj._b64url_encode(signature))
    return ".".join(segments)


def test_decode_accepts_valid_unexpired_token(sj):
    token = sj._sign_jwt({"sub": "09120000000", "exp": time.time() + 60})

    claims = sj._decode_jwt(token)

    assert claims is not None
    assert claims["sub"] == "09120000000"


def test_decode_rejects_expired_token(sj):
    token = sj._sign_jwt({"sub": "09120000000", "exp": time.time() - 5})

    assert sj._decode_jwt(token) is None


def test_decode_rejects_token_without_exp(sj):
    token = sj._sign_jwt({"sub": "09120000000"})

    assert sj._decode_jwt(token) is None


def test_decode_rejects_wrong_alg(sj):
    token = _token_with_header(
        sj,
        {"alg": "none", "typ": "JWT"},
        {"sub": "09120000000", "exp": time.time() + 60},
    )

    assert sj._decode_jwt(token) is None


def test_vip_allowlist_parsing(sj):
    assert sj._parse_vip_phone_allowlist("") == set()
    assert sj._parse_vip_phone_allowlist(" 0912 , +98912 ,, 0913 ") == {
        "0912",
        "+98912",
        "0913",
    }


def test_vip_allowlist_empty_when_env_unset(sj, monkeypatch):
    monkeypatch.delenv("VIP_PHONE_ALLOWLIST", raising=False)

    assert sj._parse_vip_phone_allowlist() == set()
