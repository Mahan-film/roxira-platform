Implement `load_config(raw: str) -> dict` in `solution.py`.

The default config is:

```python
DEFAULT_CONFIG = {"debug": False, "retries": 3, "timeout": 30}
```

Rules:
- Parse `raw` as JSON.
- If parsing fails (invalid JSON), or the top-level parsed value is not a
  JSON object, return a copy of `DEFAULT_CONFIG` -- never raise.
- If parsing succeeds and the top-level value is an object, merge it over
  `DEFAULT_CONFIG`: only keys already present in `DEFAULT_CONFIG` may be
  overridden; any other key in the parsed object is ignored.
- Per-key validation (a key that fails validation falls back to the
  default's value for *that key only*, the rest of the merge still applies):
  - `retries` must be an `int` and `>= 0`.
  - `timeout` must be an `int` or `float` and `> 0`.
  - `debug` must be a `bool`.

Return ONLY a single Python code block containing the full contents of
`solution.py` (it must define `DEFAULT_CONFIG` and `load_config`). Do not
include any explanation before or after the code block.
