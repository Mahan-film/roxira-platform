import pytest
from solution import normalize_persian, persian_digits_to_int


def test_normalize_yeh_and_kaf():
    assert normalize_persian("كتاب علي") == "کتاب علی"


def test_normalize_leaves_other_chars():
    assert normalize_persian("hello 123") == "hello 123"


def test_normalize_idempotent_on_already_persian():
    assert normalize_persian("کتاب علی") == "کتاب علی"


def test_normalize_none_raises_type_error():
    with pytest.raises(TypeError):
        normalize_persian(None)


def test_digits_persian_only():
    assert persian_digits_to_int("۱۲۳") == 123


def test_digits_with_whitespace():
    assert persian_digits_to_int("  ۱۲۳ ") == 123


def test_digits_negative():
    assert persian_digits_to_int("-۴۲") == -42


def test_digits_mixed_persian_ascii():
    assert persian_digits_to_int("1۲3") == 123


def test_digits_ascii_only():
    assert persian_digits_to_int("42") == 42


def test_digits_invalid_char_raises():
    with pytest.raises(ValueError):
        persian_digits_to_int("12a")


def test_digits_empty_raises():
    with pytest.raises(ValueError):
        persian_digits_to_int("")


def test_digits_whitespace_only_raises():
    with pytest.raises(ValueError):
        persian_digits_to_int("   ")
