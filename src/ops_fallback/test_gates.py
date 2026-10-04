from src.ops_fallback import gates as g


def test_min_length():
    assert g.non_empty_min_length(5)("hello world")[0]
    assert g.non_empty_min_length(5)("  hi ") == (False, ["too_short"])


def test_json_keys():
    gate = g.valid_json_with_keys(["a", "b"])
    assert gate('{"a":1,"b":2}')[0]
    assert gate('{"a":1}') == (False, ["missing_key:b"])
    assert gate("nope") == (False, ["invalid_json"])
    assert gate("[1]") == (False, ["json_not_object"])


def test_persian_ratio():
    assert g.persian_text_ratio()("این یک متن فارسی است")[0]
    assert g.persian_text_ratio()("this is english text")[1] == ["low_persian_ratio"]
    assert g.persian_text_ratio()("123")[1] == ["no_letters"]


def test_article_numbers():
    gate = g.no_unverified_article_numbers([10, "12"])
    assert gate("طبق ماده 10 و ماده ۱۲")[0]
    ok, reasons = gate("طبق ماده 99")
    assert not ok and reasons == ["unverified_article_number"]
    assert "99" not in " ".join(reasons)


def test_banner_and_digits():
    assert g.banner_present("BANNER")("x BANNER y")[0]
    assert g.banner_present("BANNER")("x")[1] == ["banner_missing"]
    assert g.latin_digits_only()("abc 123")[0]
    assert g.latin_digits_only()("عدد ۱۲")[1] == ["non_latin_digits"]


def test_all_of():
    gate = g.all_of(g.non_empty_min_length(50), g.latin_digits_only())
    assert gate(chr(0x6F1)) == (False, ["too_short", "non_latin_digits"])
