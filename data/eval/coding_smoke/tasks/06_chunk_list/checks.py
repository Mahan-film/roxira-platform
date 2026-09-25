import pytest
from solution import chunk_list


def test_even_division():
    assert chunk_list([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]


def test_remainder_chunk():
    assert chunk_list([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]


def test_empty_items():
    assert chunk_list([], 3) == []


def test_size_larger_than_list():
    assert chunk_list([1, 2], 10) == [[1, 2]]


def test_size_one():
    assert chunk_list([1, 2, 3], 1) == [[1], [2], [3]]


def test_no_mutation():
    src = [1, 2, 3, 4]
    chunk_list(src, 2)
    assert src == [1, 2, 3, 4]


def test_zero_size_raises():
    with pytest.raises(ValueError):
        chunk_list([1, 2], 0)


def test_negative_size_raises():
    with pytest.raises(ValueError):
        chunk_list([1, 2], -1)


def test_non_int_size_raises():
    with pytest.raises(ValueError):
        chunk_list([1, 2], 1.5)


def test_order_preserved():
    assert chunk_list(["a", "b", "c", "d", "e"], 3) == [["a", "b", "c"], ["d", "e"]]
