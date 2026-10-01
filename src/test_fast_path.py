def test_classify_fast_path():
    import importlib.util
    import sys
    from pathlib import Path

    fast_path_file = (
        Path(__file__).resolve().parents[1]
        / "output_apps/generated_modules/smartjudge/fast_path.py"
    )
    spec = importlib.util.spec_from_file_location("fast_path", fast_path_file)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fast_path"] = module
    spec.loader.exec_module(module)

    assert module.classify_fast_path("سلام تو کی هستی") == "identity"
    assert module.classify_fast_path("اسمت چیه؟") == "identity"
    assert module.classify_fast_path("سلام صدام میاد؟") == "mic_check"
    assert module.classify_fast_path("سلام") == "greeting"
    assert module.classify_fast_path("ماده ۱۰ قانون مدنی چیست؟") is None
