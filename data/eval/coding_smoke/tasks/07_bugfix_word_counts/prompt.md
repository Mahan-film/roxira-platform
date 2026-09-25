The function below is supposed to count word frequencies in a piece of text,
case-insensitively, but it has bugs. Fix it in `solution.py`. Keep the same
function name and signature: `word_counts(text)`.

```python
def word_counts(text):
    counts = {}
    for word in text.split(" "):
        counts[word] = counts.get(word, 0) + 1
    return counts
```

Problems to fix:
- It only splits on a single literal space, so tabs/newlines/multiple spaces
  break it (e.g. it produces empty-string keys).
- It is case-sensitive (`"Cat"` and `"cat"` should count as the same word).
- It does not strip basic punctuation (`.`, `,`, `!`, `?`, `;`, `:`) attached
  to a word (e.g. `"cat."` and `"cat"` should count as the same word).
- Empty or whitespace-only `text` should return `{}` instead of `{"": 1}` (or
  similar).
- `text` that is not a `str` (e.g. `None`) should raise `TypeError`.

Return ONLY a single Python code block containing the full contents of
`solution.py`. Do not include any explanation before or after the code block.
