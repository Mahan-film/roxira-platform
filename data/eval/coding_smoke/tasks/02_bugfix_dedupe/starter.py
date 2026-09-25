def dedupe_preserve_order(items):
    result = []
    for item in items:
        if item not in items[1:]:
            result.append(item)
    return result
