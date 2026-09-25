_PUNCTUATION = ".,!?;:"


def word_counts(text):
    if not isinstance(text, str):
        raise TypeError("text must be a str")
    counts = {}
    for raw_word in text.split():
        word = raw_word.strip(_PUNCTUATION).lower()
        if not word:
            continue
        counts[word] = counts.get(word, 0) + 1
    return counts
