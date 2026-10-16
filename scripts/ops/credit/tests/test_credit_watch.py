import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import credit_watch as cw  # noqa: E402


def test_key_status_takes_the_lower_of_limit_and_credits():
    def fetch(url, key):
        return {"data": {"limit_remaining": 4.0}} if url.endswith("/key") else {"data": {"total_credits": 10, "total_usage": 9.5}}
    st = cw.key_status("k", fetch=fetch)
    assert st["remaining"] == 0.5 and st["error"] == ""


def test_alerts_once_per_window_and_only_when_low():
    report = {"A": {"remaining": 0.2, "error": ""}, "B": {"remaining": 5.0, "error": ""}}
    sent = cw.alerts(report, {}, now=100000)
    assert [n for n, _ in sent] == ["A"]
    assert cw.alerts(report, {"A": 100000 - 60}, now=100000) == []
