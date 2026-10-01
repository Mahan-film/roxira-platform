def validate_case_dto(data):
    errors = []
    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        errors.append({"field": "title", "message": "required"})
    elif len(title) > 40:
        errors.append({"field": "title", "message": "max_length"})
    if data.get("priority") not in {"low", "normal", "high"}:
        errors.append({"field": "priority", "message": "enum"})
    return errors
