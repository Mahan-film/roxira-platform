def run_checks(solution):
    assert solution.normalize_digits("۱۲٣٤٥٦") == "123456"
    assert solution.format_persian_number("۱۲۳۴۵۶۷.۸۹") == "۱,۲۳۴,۵۶۷.۸۹"
    assert solution.format_persian_number("-١٢٠٠٠") == "-۱۲,۰۰۰"


def check(solution):
    run_checks(solution)
