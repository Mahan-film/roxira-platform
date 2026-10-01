PERSIAN = "۰۱۲۳۴۵۶۷۸۹"
ARABIC = "٠١٢٣٤٥٦٧٨٩"


def normalize_digits(text):
    return str(text).translate(str.maketrans(PERSIAN + ARABIC, "0123456789" * 2))


def format_persian_number(value):
    text = normalize_digits(value)
    sign = "-" if text.startswith("-") else ""
    whole, dot, fraction = text.removeprefix("-").partition(".")
    grouped = f"{int(whole):,}"
    result = sign + grouped + (dot + fraction if dot else "")
    return result.translate(str.maketrans("0123456789", PERSIAN))
