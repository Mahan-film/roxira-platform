import pytest
from solution import dedupe_preserve_order


def test_basic():
    assert dedupe_preserve_order([1, 2, 1, 3, 2]) == [1, 2, 3]


def test_empty():
    assert dedupe_preserve_order([]) == []


def test_no_duplicates():
    assert dedupe_preserve_order([1, 2, 3]) == [1, 2, 3]


def test_order_preserved():
    assert dedupe_preserve_order([3, 3, 2, 1, 2, 1]) == [3, 2, 1]


def test_strings():
    assert dedupe_preserve_order(["a", "b", "a", "c", "b"]) == ["a", "b", "c"]


def test_all_same():
    assert dedupe_preserve_order([5, 5, 5, 5]) == [5]


def test_none_raises_type_error():
    with pytest.raises(TypeError, match="iterable"):
        dedupe_preserve_order(None)


def test_int_raises_type_error():
    with pytest.raises(TypeError, match="iterable"):
        dedupe_preserve_order(42)
