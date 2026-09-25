_YEH_MAP = str.maketrans({"ي": "ی", "ك": "ک"})
_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_DIGIT_MAP = str.maketrans(_PERSIAN_DIGITS, "0123456789")


def normalize_persian(text):
    if not isinstance(text, str):
        raise TypeError("text must be a str")
    return text.translate(_YEH_MAP)


def persian_digits_to_int(text):
    if not isinstance(text, str):
        raise TypeError("text must be a str")
    stripped = text.strip()
    if not stripped:
        raise ValueError("text has no digits")

    sign = 1
    body = stripped
    if body[0] == "-":
        sign = -1
        body = body[1:]
    elif body[0] == "+":
        body = body[1:]

    if not body:
        raise ValueError("text has no digits")

    ascii_body = body.translate(_DIGIT_MAP)
    if not ascii_body.isdigit():
        raise ValueError(f"not a valid Persian/ASCII digit string: {text!r}")

    return sign * int(ascii_body)
