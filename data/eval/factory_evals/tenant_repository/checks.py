def run_checks(solution):
    store = {"c1": {"tenant_id": "alpha", "title": "قرارداد"}}
    result = solution.get_case(store, "alpha", "c1")
    assert result == store["c1"] and result is not store["c1"]
    try:
        solution.get_case(store, "beta", "c1")
    except PermissionError as error:
        assert str(error) == "cross-tenant read"
    else:
        raise AssertionError("cross-tenant read was allowed")
    try:
        solution.get_case(store, "alpha", "missing")
    except KeyError as error:
        assert error.args == ("missing",)
    else:
        raise AssertionError("missing case was accepted")


def check(solution):
    run_checks(solution)
