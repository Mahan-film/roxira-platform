"""T210: the dual-retrieval SQL must not cast node_id digits to int4."""

import re

from src.legal_intelligence import dual_retrieval as dr


def test_node_id_digits_are_not_cast_to_int4():
    sql = dr._RETRIEVAL_SQL
    assert "::int," not in sql and "::int)" not in sql
    assert "::numeric" in sql
    assert "{_NODE_NUM_SQL}" not in sql  # f-string fully expanded


def test_ordering_expression_handles_fourteen_digit_ids():
    # LAW_<12 digits>_ART_<2 digits> concatenates to 14 digits (> 2147483647).
    digits = re.sub(r"\D", "", "LAW_178933064869_ART_52")
    assert int(digits) == 17893306486952
    assert int(digits) > 2**31 - 1
    assert dr._NODE_NUM_SQL.count("::numeric") == 1
