CONTROLS = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"


def _is_script_letter(char):
    return "\u0600" <= char <= "\u06ff" and char.isalpha()


def clean_label(value):
    text = str(value).translate({ord(char): None for char in CONTROLS})
    return "".join(
        char for index, char in enumerate(text)
        if char != "\u200c" or (
            index > 0 and index + 1 < len(text)
            and _is_script_letter(text[index - 1]) and _is_script_letter(text[index + 1])
        )
    )
