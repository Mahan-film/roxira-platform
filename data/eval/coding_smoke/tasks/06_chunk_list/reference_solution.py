def chunk_list(items, size):
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise ValueError("size must be a positive int")
    items = list(items)
    return [items[i : i + size] for i in range(0, len(items), size)]
