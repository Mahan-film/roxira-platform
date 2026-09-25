Implement `chunk_list(items: list, size: int) -> list[list]` in `solution.py`.

Rules:
- Split `items` into consecutive chunks of length `size` (the last chunk may
  be shorter than `size` if `items` doesn't divide evenly).
- `size` must be a positive `int`; otherwise raise `ValueError`.
- An empty `items` returns `[]`.
- Must not mutate `items`.
- Order of elements must be preserved.

Examples:

```
chunk_list([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
chunk_list([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]
chunk_list([], 3) == []
chunk_list([1], 0)  # raises ValueError
```

Return ONLY a single Python code block containing the full contents of
`solution.py`. Do not include any explanation before or after the code block.
