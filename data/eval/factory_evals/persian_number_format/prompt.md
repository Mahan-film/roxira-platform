# Persian number formatting

Implement `normalize_digits(text)` and `format_persian_number(value)` in `starter.py`.

`normalize_digits` converts Persian and Arabic-Indic digits to ASCII digits and leaves every other character unchanged. `format_persian_number` accepts an integer or a digit string with an optional leading `-` and fractional part. It normalizes its digits, inserts ASCII commas every three digits in the integer part, and returns the result using Persian digits (commas, sign, and decimal point remain ASCII). Do not use locale-dependent APIs.
