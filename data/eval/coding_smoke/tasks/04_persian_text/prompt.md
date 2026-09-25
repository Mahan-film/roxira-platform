Implement two functions in `solution.py`:

1. `normalize_persian(text: str) -> str` -- replace every Arabic-style Yeh
   (`ي`, U+064A) with Persian Yeh (`ی`, U+06CC), and every Arabic-style Kaf
   (`ك`, U+0643) with Persian Kaf (`ک`, U+06A9). Leave every other character
   unchanged. If `text` is not a `str` (e.g. `None`), raise `TypeError`.

2. `persian_digits_to_int(text: str) -> int` -- convert a string that may
   contain Persian digits (`۰۱۲۳۴۵۶۷۸۹`) and/or ASCII digits (`0-9`), possibly
   mixed, with an optional leading `-` sign and optional surrounding
   whitespace, into an `int`. Raise `ValueError` if the string (after
   stripping whitespace) is empty, has no digits, or contains any character
   that is not a digit or the leading sign.

Examples:

```
normalize_persian("كتاب علي") == "کتاب علی"
persian_digits_to_int("  ۱۲۳ ") == 123
persian_digits_to_int("-۴۲") == -42
persian_digits_to_int("1۲3") == 123
persian_digits_to_int("12a")  # raises ValueError
persian_digits_to_int("")     # raises ValueError
```

Return ONLY a single Python code block containing the full contents of
`solution.py`. Do not include any explanation before or after the code block.
