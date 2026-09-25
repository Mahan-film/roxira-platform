def clamp_scores(scores, lo, hi):
    if lo > hi:
        raise ValueError("lo must be <= hi")
    result = []
    for value in scores:
        if not isinstance(value, (int, float)):
            raise TypeError(f"non-numeric value in scores: {value!r}")
        result.append(min(max(value, lo), hi))
    return result
