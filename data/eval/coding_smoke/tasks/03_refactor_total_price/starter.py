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
