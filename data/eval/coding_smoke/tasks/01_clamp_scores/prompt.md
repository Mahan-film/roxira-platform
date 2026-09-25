Implement a function `clamp_scores(scores: list[float], lo: float, hi: float) -> list[float]`
in `solution.py`.

Rules:
- Each value in `scores` must be clamped into the inclusive range `[lo, hi]`.
- If `lo > hi`, raise `ValueError("lo must be <= hi")`.
- Any non-numeric value in `scores` (e.g. a string, `None`) must raise `TypeError`.
- Return a **new** list; do not mutate the input list.
- An empty `scores` list returns `[]`.

Return ONLY a single Python code block containing the full contents of `solution.py`.
Do not include any explanation before or after the code block.
