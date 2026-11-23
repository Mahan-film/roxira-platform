"""Tests for scripts/ci/pick_runner.sh (#949 T228 / #1024 R20-8 runner selector)."""
import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/pick_runner.sh"
HOSTED = '"ubuntu-latest"'
BOX = '["self-hosted","hp"]'
NOW = 1_800_000_000


def pick(**env: str) -> dict:
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "REPO": "o/r", "NOW": str(NOW)}
    base.update(env)
    out = subprocess.run(
        ["bash", str(SCRIPT)], env=base, capture_output=True, text=True, check=True
    ).stdout
    result = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    assert set(result) == {"light", "docker", "image_registry", "where"}
    return result


def test_default_is_hosted_so_nothing_changes_until_the_variable_is_set():
    r = pick(EVENT="push")
    assert r["light"] == HOSTED and r["docker"] == HOSTED


@pytest.mark.parametrize("mode", ["box", "auto", "hosted"])
def test_fork_pull_request_never_reaches_the_box(mode):
    r = pick(EVENT="pull_request", HEAD_REPO="someone/fork", MODE=mode,
             HEARTBEAT=f"{NOW} 1 1", INPUT="box")
    assert r["light"] == HOSTED and r["docker"] == HOSTED
    assert "never reaches the box" in r["where"]


@pytest.mark.parametrize("event", ["pull_request_target", "issue_comment", "issues", "", "workflow_run"])
def test_other_events_stay_hosted(event):
    r = pick(EVENT=event, HEAD_REPO="o/r", MODE="box")
    assert r["light"] == HOSTED and r["docker"] == HOSTED


def test_pull_request_without_head_repo_stays_hosted():
    r = pick(EVENT="pull_request", MODE="box")
    assert r["light"] == HOSTED


@pytest.mark.parametrize("event", ["push", "schedule", "workflow_dispatch", "merge_group"])
def test_box_mode_uses_box_labels_for_trusted_events(event):
    r = pick(EVENT=event, MODE="box")
    assert r["light"] == BOX and r["docker"] == BOX


def test_same_repo_pull_request_uses_box():
    r = pick(EVENT="pull_request", HEAD_REPO="o/r", MODE="box")
    assert r["light"] == BOX


def test_dispatch_input_overrides_the_mode():
    assert pick(EVENT="workflow_dispatch", MODE="box", INPUT="hosted")["light"] == HOSTED
    assert pick(EVENT="workflow_dispatch", MODE="hosted", INPUT="box")["light"] == BOX
    # "default" means: use the repo variable
    assert pick(EVENT="workflow_dispatch", MODE="box", INPUT="default")["light"] == BOX


def test_custom_slot_labels():
    r = pick(EVENT="push", MODE="box",
             BOX_LIGHT='["self-hosted","jit","slot-light"]',
             BOX_DOCKER='["self-hosted","jit","slot-docker"]')
    assert r["light"] == '["self-hosted","jit","slot-light"]'
    assert r["docker"] == '["self-hosted","jit","slot-docker"]'


@pytest.mark.parametrize("labels", [
    '["hp"]',                          # no self-hosted
    '"self-hosted"',                   # not an array
    '["self-hosted","a b"]',           # space
    '["self-hosted"],"x"',             # trailing junk
    '${{ github.token }}',
])
def test_bad_box_labels_fall_back_to_hosted(labels):
    r = pick(EVENT="push", MODE="box", BOX_LIGHT=labels)
    assert r["light"] == HOSTED


def test_bad_hosted_value_is_replaced():
    r = pick(EVENT="push", HOSTED='["self-hosted"]')
    assert r["light"] == HOSTED
    assert pick(EVENT="push", HOSTED='"ubuntu-slim"')["light"] == '"ubuntu-slim"'


def test_auto_fresh_heartbeat_per_slot():
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 1 0")
    assert r["light"] == BOX and r["docker"] == HOSTED
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 0 2")
    assert r["light"] == HOSTED and r["docker"] == BOX


@pytest.mark.parametrize("heartbeat", [
    "", "garbage", f"{NOW - 301} 1 1", f"{NOW + 120} 1 1", f"{NOW} x 1", f"{NOW} 1",
])
def test_auto_stale_or_bad_heartbeat_is_hosted(heartbeat):
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=heartbeat)
    assert r["light"] == HOSTED and r["docker"] == HOSTED


def test_auto_max_age_is_configurable():
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 500} 1 1", MAX_AGE="600")
    assert r["light"] == BOX


def test_unknown_mode_is_hosted():
    r = pick(EVENT="push", MODE="everything")
    assert r["light"] == HOSTED
    assert r["image_registry"] == "mirror.gcr.io/library"


def test_image_registry_matches_docker_runner_slot():
    hosted = pick(EVENT="push", MODE="hosted")
    assert hosted["image_registry"] == "mirror.gcr.io/library"

    box = pick(EVENT="push", MODE="box")
    assert box["image_registry"] == "public.ecr.aws/docker/library"

    # Auto split-slot: light on box, docker on hosted -> hosted registry
    split_hosted_docker = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 1 0")
    assert split_hosted_docker["docker"] == HOSTED
    assert split_hosted_docker["image_registry"] == "mirror.gcr.io/library"

    # Auto split-slot: light on hosted, docker on box -> box registry
    split_box_docker = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 0 1")
    assert split_box_docker["docker"] == BOX
    assert split_box_docker["image_registry"] == "public.ecr.aws/docker/library"


def test_image_registry_override_and_validation():
    override = pick(EVENT="push", MODE="hosted", IMAGE_REGISTRY="ghcr.io/mahan-film/mirror")
    assert override["image_registry"] == "ghcr.io/mahan-film/mirror"

    bad = pick(EVENT="push", MODE="hosted", IMAGE_REGISTRY="ghcr.io/bad space")
    assert bad["image_registry"] == "mirror.gcr.io/library"


# --- event time as the heartbeat reference ---
# vars are read at run creation; the picker job may start much later.



def _event(tmp_path, payload) -> str:
    f = tmp_path / "event.json"
    f.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    return str(f)


def _iso(epoch: int) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(epoch, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_queued_push_run_measures_heartbeat_at_push_time(tmp_path):
    # Run 45118378279: heartbeat written 43 s before the push, picker started 37 min later.
    pushed = NOW - 2213 + 43
    ev = _event(tmp_path, {"repository": {"pushed_at": pushed},
                           "head_commit": {"timestamp": _iso(pushed)}})
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 2213} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == BOX and r["docker"] == BOX
    assert "repository.pushed_at" in r["where"]


def test_push_falls_back_to_head_commit_timestamp(tmp_path):
    ev = _event(tmp_path, {"repository": {}, "head_commit": {"timestamp": _iso(NOW - 1800)}})
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 1830} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == BOX
    assert "head_commit.timestamp" in r["where"]


def test_merge_group_and_pull_request_use_their_event_time(tmp_path):
    ev = _event(tmp_path, {"merge_group": {"head_commit": {"timestamp": _iso(NOW - 1200)}}})
    assert pick(EVENT="merge_group", MODE="auto", HEARTBEAT=f"{NOW - 1250} 1 1",
                GITHUB_EVENT_PATH=ev)["light"] == BOX
    ev = _event(tmp_path, {"pull_request": {"updated_at": _iso(NOW - 900)}})
    assert pick(EVENT="pull_request", HEAD_REPO="o/r", MODE="auto", HEARTBEAT=f"{NOW - 950} 1 1",
                GITHUB_EVENT_PATH=ev)["light"] == BOX


def test_stale_at_event_time_is_still_hosted(tmp_path):
    ev = _event(tmp_path, {"repository": {"pushed_at": NOW - 600}})
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 1000} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == HOSTED and r["docker"] == HOSTED
    assert "400s old" in r["where"]


def test_wait_longer_than_max_wait_uses_the_clock(tmp_path):
    # The box may have died while the run waited: after MAX_WAIT the event time is not trusted.
    ev = _event(tmp_path, {"repository": {"pushed_at": NOW - 6000}})
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 6010} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == HOSTED
    assert "at clock" in r["where"]
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 6010} 1 1", GITHUB_EVENT_PATH=ev,
             MAX_WAIT="7200")
    assert r["light"] == BOX


def test_event_time_in_the_future_uses_the_clock(tmp_path):
    ev = _event(tmp_path, {"repository": {"pushed_at": NOW + 3600}})
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == BOX and "at clock" in r["where"]


@pytest.mark.parametrize("payload", ["not json", "{}", '{"repository": {"pushed_at": "soon"}}',
                                     '{"repository": {"pushed_at": true}}'])
def test_unusable_payload_uses_the_clock(tmp_path, payload):
    ev = _event(tmp_path, payload)
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 30} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == BOX and "at clock" in r["where"]
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 2000} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == HOSTED


@pytest.mark.parametrize("event", ["schedule", "workflow_dispatch"])
def test_schedule_and_dispatch_keep_the_clock(tmp_path, event):
    ev = _event(tmp_path, {"repository": {"pushed_at": NOW - 1800}})
    r = pick(EVENT=event, MODE="auto", HEARTBEAT=f"{NOW - 1810} 1 1", GITHUB_EVENT_PATH=ev)
    assert r["light"] == HOSTED and "at clock" in r["where"]


def test_push_without_python_reads_pushed_at(tmp_path):
    # ubuntu-slim may lack python3: the grep fallback covers push (the main runs).
    bindir = tmp_path / "bin"
    bindir.mkdir()
    for tool in ("bash", "grep", "head", "date", "cat", "printf"):
        src = subprocess.run(["bash", "-c", f"command -v {tool}"],
                             capture_output=True, text=True).stdout.strip()
        if src.startswith("/"):
            (bindir / tool).symlink_to(src)
    ev = _event(tmp_path, json.dumps({"repository": {"pushed_at": NOW - 1800}}, indent=2))
    r = pick(EVENT="push", MODE="auto", HEARTBEAT=f"{NOW - 1810} 1 1", GITHUB_EVENT_PATH=ev,
             PATH=str(bindir))
    assert r["light"] == BOX and "repository.pushed_at" in r["where"]
