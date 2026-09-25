import pytest
from solution import word_counts


def test_basic():
    assert word_counts("cat dog cat") == {"cat": 2, "dog": 1}


def test_case_insensitive():
    assert word_counts("Cat cat CAT") == {"cat": 3}


def test_punctuation_stripped():
    assert word_counts("cat. cat, dog! dog?") == {"cat": 2, "dog": 2}


def test_multiple_whitespace_and_newlines():
    assert word_counts("cat\n\ndog   cat\tdog") == {"cat": 2, "dog": 2}


def test_empty_string():
    assert word_counts("") == {}


def test_whitespace_only():
    assert word_counts("   \n\t  ") == {}


def test_none_raises_type_error():
    with pytest.raises(TypeError):
        word_counts(None)


def test_single_word():
    assert word_counts("hello") == {"hello": 1}


def test_semicolons_and_colons():
    assert word_counts("a: b; a; b:") == {"a": 2, "b": 2}
