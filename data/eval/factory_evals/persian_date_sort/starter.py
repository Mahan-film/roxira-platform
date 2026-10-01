def sort_persian_dates(values):
    return sorted(values, key=lambda value: value.split("/")[::-1])
