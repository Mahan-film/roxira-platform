# DTO-style validation

Implement `validate_case_dto(data)` in `starter.py`. Return a list of error dictionaries in field order (`title`, then `priority`). A missing or blank `title` produces `{"field": "title", "message": "required"}`. A nonblank title longer than 40 characters produces `{"field": "title", "message": "max_length"}`. `priority` is required to be one of `low`, `normal`, or `high`; otherwise return `{"field": "priority", "message": "enum"}`. Do not raise for invalid input.
