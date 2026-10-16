import datetime as dt

from output_apps.ecosystem_core.src.billing.zibal_service import merge_entitlement

NOW = dt.datetime(2026, 10, 16, tzinfo=dt.timezone.utc)
D30 = NOW + dt.timedelta(days=30)


def test_one_off_never_downgrades_an_active_subscription():
    plan, exp, write = merge_entitlement("SJ_PRO_MONTHLY", NOW + dt.timedelta(days=10), "SINGLE_DRAFT", D30, NOW)
    assert (plan, write) == ("SJ_PRO_MONTHLY", False)


def test_same_level_renewal_stacks_remaining_time():
    plan, exp, write = merge_entitlement("SJ_BASIC_MONTHLY", NOW + dt.timedelta(days=10), "SJ_BASIC_MONTHLY", D30, NOW)
    assert write and exp == NOW + dt.timedelta(days=40)


def test_upgrade_replaces_and_expired_rows_are_replaced():
    assert merge_entitlement("SJ_BASIC_MONTHLY", NOW + dt.timedelta(days=5), "SJ_PREMIUM_MONTHLY", D30, NOW)[0] == "SJ_PREMIUM_MONTHLY"
    assert merge_entitlement("SJ_PRO_MONTHLY", NOW - dt.timedelta(days=1), "SINGLE_DRAFT", D30, NOW) == ("SINGLE_DRAFT", D30, True)


def test_legacy_vip_counts_as_pro():
    assert merge_entitlement("VIP_MONTHLY_PRO", NOW + dt.timedelta(days=3), "SJ_BASIC_MONTHLY", D30, NOW)[2] is False
