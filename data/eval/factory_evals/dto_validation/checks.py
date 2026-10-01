def run_checks(solution):
    assert solution.validate_case_dto({"title": "پرونده", "priority": "normal"}) == []
    assert solution.validate_case_dto({"title": "   ", "priority": "urgent"}) == [
        {"field": "title", "message": "required"},
        {"field": "priority", "message": "enum"},
    ]
    assert solution.validate_case_dto({"title": "x" * 41, "priority": "high"}) == [
        {"field": "title", "message": "max_length"}
    ]


def check(solution):
    run_checks(solution)
