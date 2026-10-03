"""Regression test for issue #372: never fabricate a success probability."""

from output_apps.generated_modules.smartjudge.smartjudge_module import (
    derive_success_probability,
)


def test_long_message_returns_no_probability():
    long_message = "شرح کامل پرونده و ادله اثبات دعوی در دادگاه حقوقی تهران"
    assert len(long_message.split()) >= 6
    assert derive_success_probability(long_message) is None
