PERSIAN = "۰۱۲۳۴۵۶۷۸۹"


def sort_persian_dates(values):
    digits = str.maketrans(PERSIAN, "0123456789")
    return sorted(
        values,
        key=lambda value: tuple(int(part) for part in value.translate(digits).split("/")),
    )
