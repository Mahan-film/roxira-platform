def validate_case_dto(data):
    errors = []
    if not data.get("title"):
        errors.append({"field": "title", "message": "required"})
    return errors
