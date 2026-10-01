"""Tests for durable Factory ledger issue comments."""

import subprocess
import sys

import pytest

from src.factory_pipeline.ledger_comments import (
    build_summary,
    decode_comments,
    encode_event,
)
from src.factory_pipeline.run_ledger import summarize


def _event(**overrides: object) -> dict[str, object]:
    event: dict[str, object] = {
        "stage": "research",
        "status": "ok",
        "ts": "2026-10-01T12:00:00Z",
    }
    event.update(overrides)
    return event


def test_round_trip_and_summary() -> None:
    event = _event()
    comment = encode_event(event)

    assert comment == (
        '<!-- roxira-ledger {"stage":"research","status":"ok",'
        '"ts":"2026-10-01T12:00:00Z"} -->'
    )
    assert decode_comments([comment]) == [event]
    assert build_summary([comment]) == summarize([event])


def test_decode_comments_ignores_malformed_json() -> None:
    event = _event()
    bodies = ["<!-- roxira-ledger {not-json} -->", encode_event(event)]

    assert decode_comments(bodies) == [event]


def test_decode_comments_deduplicates_and_sorts_by_timestamp() -> None:
    earlier = _event(ts="2026-10-01T11:00:00Z")
    later = _event(stage="design", ts="2026-10-01T13:00:00Z")

    assert decode_comments([encode_event(later), encode_event(earlier), encode_event(later)]) == [
        earlier,
        later,
    ]


def test_encode_event_refuses_html_comment_terminator() -> None:
    with pytest.raises(ValueError, match="comment terminator"):
        encode_event(_event(note="unsafe --> payload"))


def test_encode_event_refuses_secret() -> None:
    with pytest.raises(ValueError, match="secret"):
        encode_event(_event(api_key="sk-abcdefghijklmnop"))


def test_post_dry_run_round_trips_event() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "src.factory_pipeline.ledger_comments",
            "post",
            "--issue",
            "302",
            "--run-id",
            "12345",
            "--stage",
            "research",
            "--status",
            "ok",
            "--cost-usd",
            "0.5",
            "--dry-run",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    [event] = decode_comments([result.stdout])
    assert event["run_id"] == "12345"
    assert event["stage"] == "research"
    assert event["status"] == "ok"
    assert event["cost_usd"] == 0.5


def test_post_rejects_bad_stage() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "src.factory_pipeline.ledger_comments",
            "post",
            "--issue",
            "302",
            "--run-id",
            "12345",
            "--stage",
            "not-a-stage",
            "--status",
            "ok",
            "--dry-run",
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "invalid choice" in result.stderr


def test_encode_event_refuses_secret_in_nested_field() -> None:
    with pytest.raises(ValueError, match="secret"):
        encode_event(_event(metadata={"token": "ghp_abcdefghijklmnop"}))
