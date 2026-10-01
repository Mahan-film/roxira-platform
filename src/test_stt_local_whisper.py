def test_transcribe_local_and_confidence_gate():
    import importlib.util
    import sys
    from pathlib import Path

    module_path = Path(__file__).resolve().parents[1] / "output_apps/ecosystem_core/src/factory/stt_local_whisper.py"
    spec = importlib.util.spec_from_file_location("stt_local_whisper", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["stt_local_whisper"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)

    class Seg:
        def __init__(self, text, avg_logprob):
            self.text = text
            self.avg_logprob = avg_logprob

    class FakeModel:
        def __init__(self):
            self.kwargs = None

        def transcribe(self, audio, **kw):
            self.kwargs = kw
            return [Seg("سلام", -0.1), Seg("تو کی هستی", -0.2)], None

    try:
        model = FakeModel()
        text, min_logprob = module.transcribe_local(b"wav", "prompt", model)

        assert text == "سلام تو کی هستی"
        assert min_logprob == -0.2
        assert model.kwargs["language"] == "fa"
        assert model.kwargs["task"] == "transcribe"
        assert model.kwargs["temperature"] == 0
        assert model.kwargs["vad_filter"] is True
        assert model.kwargs["initial_prompt"] == "prompt"
        assert module.is_confident("", -0.1) is False
        assert module.is_confident("x", -2.0) is False
        assert module.is_confident("x", -0.5) is True
    finally:
        sys.modules.pop("stt_local_whisper", None)
