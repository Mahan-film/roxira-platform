def dedupe_preserve_order(items):
    if not hasattr(items, "__iter__"):
        raise TypeError("items must be iterable")
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
