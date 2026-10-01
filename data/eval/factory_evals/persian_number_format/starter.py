PERSIAN = "۰۱۲۳۴۵۶۷۸۹"


def normalize_digits(text):
    return str(text).translate(str.maketrans(PERSIAN, "0123456789"))


def format_persian_number(value):
    return normalize_digits(value)
