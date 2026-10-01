def test_whisper_payload_retry_and_corrections(monkeypatch):
    import importlib.util
    import io
    import json
    import sys
    import urllib.error
    from pathlib import Path

    path = Path(__file__).parents[1] / "output_apps/ecosystem_core/src/factory/stt_engine.py"
    spec = importlib.util.spec_from_file_location("stt_engine", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["stt_engine"] = mod
    spec.loader.exec_module(mod)
    bodies = []
    monkeypatch.setattr(
        mod.urllib.request, "urlopen",
        lambda request, **_: (bodies.append(json.loads(request.data)) or io.BytesIO(b'{"text":"ok"}')),
    )
    assert mod._call_stt_model("openai/whisper-large-v3-turbo", "QQ==", {}) == "ok"
    assert bodies[0]["language"] == "fa"
    assert bodies[0]["prompt"] == mod.STT_PROMPT
    def urlopen(request, **_):
        bodies.append(json.loads(request.data))
        if len(bodies) == 1:
            raise urllib.error.HTTPError(request.full_url, 400, "bad", {}, None)
        return io.BytesIO(b'{"text":"retried"}')
    monkeypatch.setattr(mod.urllib.request, "urlopen", urlopen)
    bodies.clear()
    assert mod._call_stt_model("openai/whisper-large-v3-turbo", "QQ==", {}) == "retried"
    assert not ({"language", "prompt", "temperature"} & bodies[1].keys())
    assert "هست" in mod.apply_rule_based_phonetics("این هست")
    assert "هاست" not in mod.apply_rule_based_phonetics("این هست")
    assert mod.apply_rule_based_phonetics("سلام از فتیر دویستی") == "سلام تو کی هستی"
