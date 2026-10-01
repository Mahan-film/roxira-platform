def run_checks(solution):
    values = ["۱۴۰۳/۰۱/۱۰", "۱۴۰۲/۱۲/۲۹", "۱۴۰۳/۰۱/۰۲"]
    assert solution.sort_persian_dates(values) == [
        "۱۴۰۲/۱۲/۲۹", "۱۴۰۳/۰۱/۰۲", "۱۴۰۳/۰۱/۱۰"
    ]
    assert values == ["۱۴۰۳/۰۱/۱۰", "۱۴۰۲/۱۲/۲۹", "۱۴۰۳/۰۱/۰۲"]


def check(solution):
    run_checks(solution)
