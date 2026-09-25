import pytest
from solution import clamp_scores


def test_basic_clamp():
    assert clamp_scores([1, 5, 10], 2, 8) == [2, 5, 8]


def test_empty_list():
    assert clamp_scores([], 0, 1) == []


def test_no_mutation():
    src = [1, 2, 3]
    clamp_scores(src, 0, 2)
    assert src == [1, 2, 3]


def test_lo_greater_than_hi_raises():
    with pytest.raises(ValueError):
        clamp_scores([1], 5, 1)


def test_non_numeric_raises_type_error():
    with pytest.raises(TypeError):
        clamp_scores([1, "x"], 0, 1)


def test_none_raises_type_error():
    with pytest.raises(TypeError):
        clamp_scores([None], 0, 1)


def test_floats():
    assert clamp_scores([-1.5, 0.5, 2.5], 0.0, 2.0) == [0.0, 0.5, 2.0]


def test_all_within_range_unchanged():
    assert clamp_scores([1, 2, 3], 0, 10) == [1, 2, 3]
