def run_checks(solution):
    assert solution.clean_label("\u200fسلام\u200cدنیا\u202c") == "سلام\u200cدنیا"
    assert solution.clean_label("\u200cسلام\u200c ۱\u200c") == "سلام ۱"
    assert solution.clean_label("A\u2067B\u2069") == "AB"


def check(solution):
    run_checks(solution)
