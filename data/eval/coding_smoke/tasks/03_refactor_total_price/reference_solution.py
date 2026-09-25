_CATEGORY_MULTIPLIERS = {"food": 0.5, "luxury": 2.0}


def total_price(items, tax_rate):
    if tax_rate < 0:
        raise ValueError("tax_rate must be >= 0")
    total = 0.0
    for item in items:
        multiplier = _CATEGORY_MULTIPLIERS.get(item.get("category"), 1.0)
        total += item["price"] * (1 + tax_rate * multiplier)
    return round(total, 2)
