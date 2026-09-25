import inspect

import pytest
from solution import total_price


def test_food_category():
    assert total_price([{"category": "food", "price": 100.0}], 0.1) == 105.0


def test_luxury_category():
    assert total_price([{"category": "luxury", "price": 100.0}], 0.1) == 120.0


def test_other_category():
    assert total_price([{"category": "other", "price": 100.0}], 0.1) == 110.0


def test_missing_category_treated_as_other():
    assert total_price([{"price": 50.0}], 0.2) == 60.0


def test_mixed_items():
    items = [
        {"category": "food", "price": 100.0},
        {"category": "luxury", "price": 50.0},
        {"category": "other", "price": 20.0},
    ]
    assert total_price(items, 0.1) == round(105.0 + 60.0 + 22.0, 2)


def test_empty_items():
    assert total_price([], 0.1) == 0.0


def test_negative_tax_raises():
    with pytest.raises(ValueError):
        total_price([{"category": "food", "price": 10.0}], -0.1)


def test_rounding_to_two_decimals():
    result = total_price([{"category": "other", "price": 10.0}], 0.0333)
    assert result == round(10.0 * 1.0333, 2)


def test_no_repeated_tax_expression():
    """Light duplication check: the refactor should not repeat the same
    arithmetic literal (`* (1 +`) three separate times in the source."""
    source = inspect.getsource(total_price.__globals__[total_price.__name__])
    assert source.count("* (1 +") <= 1 or source.count("1 + tax_rate") <= 1, (
        "the multi-branch tax expression still looks duplicated"
    )
