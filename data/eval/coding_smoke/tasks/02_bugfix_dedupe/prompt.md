The function below is supposed to remove duplicate values from a list while
preserving the order of first appearance, but it has a bug and returns the
wrong result. Fix it in `solution.py`. Keep the same function name and
signature: `dedupe_preserve_order(items)`.

```python
def dedupe_preserve_order(items):
    result = []
    for item in items:
        if item not in items[1:]:
            result.append(item)
    return result
```

Additional requirement not covered by the buggy version above: if `items` is
not iterable (e.g. `None` or an `int`), raise `TypeError` with a message that
includes the word "iterable".

Return ONLY a single Python code block containing the full contents of
`solution.py`. Do not include any explanation before or after the code block.
