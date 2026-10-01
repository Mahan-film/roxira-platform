def clean_label(value):
    controls = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200c"
    return str(value).translate({ord(char): None for char in controls})
