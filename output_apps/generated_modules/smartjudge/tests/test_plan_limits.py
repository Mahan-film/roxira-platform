"""/plans reads limits from the same constants the server enforces. Offline."""

from output_apps.generated_modules.smartjudge import case_files, chat_auth, draft_assistant, plan_limits


def test_limits_mirror_enforcing_constants():
    lim = plan_limits.get_plan_limits()
    assert lim["chat_messages_per_hour"]["guest"] == chat_auth.chat_anon_hourly_limit()
    assert lim["voice_requests_per_hour"]["guest"] == chat_auth.voice_anon_hourly_limit()
    assert lim["voice_requests_per_hour"]["free"] == chat_auth.voice_auth_hourly_limit()
    assert lim["file_uploads_per_day"]["free"] == case_files.DAILY_LIMIT_FREE
    assert lim["file_uploads_per_day"]["vip"] == case_files.DAILY_LIMIT_VIP
    assert lim["max_files_per_chat"] == case_files.MAX_FILES_PER_CHAT


def test_ruling_and_indictment_are_vip_only():
    lim = plan_limits.get_plan_limits()
    assert set(lim["vip_only_draft_types"]) == {"ruling", "indictment"}
    for tier in ("guest", "free"):
        assert not {"ruling", "indictment"} & set(lim["draft_types"][tier])
    assert set(lim["draft_types"]["vip"]) == set(draft_assistant.DRAFT_TYPES)


def test_env_override_flows_through(monkeypatch):
    monkeypatch.setattr(case_files, "DAILY_LIMIT_FREE", 7)
    monkeypatch.setenv("CHAT_ANON_HOURLY_LIMIT", "3")
    lim = plan_limits.get_plan_limits()
    assert lim["file_uploads_per_day"]["free"] == 7
    assert lim["chat_messages_per_hour"]["guest"] == 3
