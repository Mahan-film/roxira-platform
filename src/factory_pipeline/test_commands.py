from __future__ import annotations

from src.factory_pipeline.commands import (
    ApprovalCommand,
    is_report_command,
    is_status_command,
    parse_approval_comment,
)


def test_bare_approve():
    assert parse_approval_comment("/approve") == ApprovalCommand(option=None)


def test_approve_with_option():
    assert parse_approval_comment("/approve Option B") == ApprovalCommand(option="Option B")


def test_approve_case_insensitive():
    assert parse_approval_comment("/APPROVE") == ApprovalCommand(option=None)
    assert parse_approval_comment("/Approve option a") == ApprovalCommand(option="option a")


def test_approve_with_leading_whitespace():
    assert parse_approval_comment("   /approve") == ApprovalCommand(option=None)


def test_approve_within_longer_comment_body():
    body = "Looks good, let's go.\n/approve NestJS + Postgres\nThanks!"
    assert parse_approval_comment(body) == ApprovalCommand(option="NestJS + Postgres")


def test_no_approve_command_returns_none():
    assert parse_approval_comment("just a regular comment") is None
    assert parse_approval_comment("") is None
    assert parse_approval_comment(None) is None  # type: ignore[arg-type]


def test_approveish_word_is_not_a_command():
    assert parse_approval_comment("I approve of this plan") is None


def test_status_command():
    assert is_status_command("/status") is True
    assert is_status_command("  /STATUS  ") is True


def test_status_command_with_trailing_text_is_not_a_command():
    assert is_status_command("/status please") is False


def test_status_command_absent():
    assert is_status_command("what's the status?") is False
    assert is_status_command("") is False
    assert is_status_command(None) is False  # type: ignore[arg-type]


def test_report_command():
    assert is_report_command("/report") is True
    assert is_report_command("  /REPORT  ") is True


def test_report_command_with_trailing_text_is_not_a_command():
    assert is_report_command("/report please") is False


def test_report_command_absent():
    assert is_report_command("send the report") is False
    assert is_report_command("") is False
    assert is_report_command(None) is False  # type: ignore[arg-type]


def test_status_and_report_commands_stay_independent():
    assert is_status_command("/report") is False
    assert is_report_command("/status") is False
