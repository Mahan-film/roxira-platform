def _load_fast_path():
    import importlib.util
    import sys
    from pathlib import Path

    fast_path_file = (
        Path(__file__).resolve().parents[1]
        / "output_apps/generated_modules/smartjudge/fast_path.py"
    )
    spec = importlib.util.spec_from_file_location("fast_path_out_of_scope", fast_path_file)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fast_path_out_of_scope"] = module
    spec.loader.exec_module(module)
    return module


def test_out_of_scope_for_non_legal_topics():
    module = _load_fast_path()

    assert module.classify_fast_path("دستور پخت قورمه سبزی چیست؟") == "out_of_scope"
    assert module.classify_fast_path("نتیجه بازی فوتبال پرسپولیس و استقلال چه شد؟") == "out_of_scope"
    assert module.classify_fast_path("آب و هوا فردا در تهران چگونه است؟") == "out_of_scope"
    assert module.classify_fast_path("یک فیلم خوب برای آخر هفته معرفی کن") == "out_of_scope"
    assert module.classify_fast_path("چطور در پایتون یک حلقه بنویسم؟") == "out_of_scope"


def test_legal_and_identity_questions_are_not_out_of_scope():
    module = _load_fast_path()

    assert module.classify_fast_path("مهلت تجدیدنظرخواهی چقدر است؟") != "out_of_scope"
    assert module.classify_fast_path("تو کی هستی؟") == "identity"
    assert module.classify_fast_path("دستور پخت قورمه سبزی طبق قانون چیست؟") != "out_of_scope"
    assert module.classify_fast_path("نتیجه بازی را به استناد قرارداد بررسی کن") != "out_of_scope"


def test_existing_fast_paths_unchanged():
    module = _load_fast_path()

    assert module.classify_fast_path("سلام تو کی هستی") == "identity"
    assert module.classify_fast_path("سلام صدام میاد؟") == "mic_check"
    assert module.classify_fast_path("سلام") == "greeting"
    assert module.classify_fast_path("ماده ۱۰ قانون مدنی چیست؟") is None
