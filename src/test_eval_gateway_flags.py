import importlib.util
import sys
from pathlib import Path


def test_call_model_uses_configured_chat_url(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "evalsmoke", Path(__file__).parents[1] / "scripts" / "eval_coding_smoke.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["evalsmoke"] = mod
    spec.loader.exec_module(mod)

    seen = {}

    class FakeResponse:
        read = lambda self: b'{"choices":[{"message":{"content":"x"}}],"usage":{}}'
        __enter__ = lambda self: self
        __exit__ = lambda self, *_: False

    def fake_urlopen(request, timeout):
        seen["request"] = request
        return FakeResponse()

    monkeypatch.setattr(mod.urllib.request, "urlopen", fake_urlopen)
    url = "http://127.0.0.1:1/v1/chat/completions"
    mod.CHAT_URL = url
    mod.call_model("p", "k", "m")

    assert seen["request"].full_url == url
    assert seen["request"].get_header("Authorization") == "Bearer k"
