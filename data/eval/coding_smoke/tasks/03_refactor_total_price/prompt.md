Refactor the function below into `solution.py`. Requirements:

- Behavior must be unchanged (same inputs produce the same outputs and the
  same exceptions).
- Remove the duplicated tax-computation logic (the `(1 + tax_rate * ...)`
  expression is effectively repeated for each branch).
- Keep the same function name and signature:
  `total_price(items: list[dict], tax_rate: float) -> float`.

Current implementation (works correctly, but has duplicated logic that a
hidden test suite will penalize if left as-is):

```python
def total_price(items, tax_rate):
    if tax_rate < 0:
        raise ValueError("tax_rate must be >= 0")
    total = 0.0
    for item in items:
        if item.get("category") == "food":
            total += item["price"] * (1 + tax_rate * 0.5)
        elif item.get("category") == "luxury":
            total += item["price"] * (1 + tax_rate * 2)
        else:
            total += item["price"] * (1 + tax_rate)
    return round(total, 2)
```

Return ONLY a single Python code block containing the full contents of
`solution.py` implementing the refactored (but behavior-identical) function.
Do not include any explanation before or after the code block.
