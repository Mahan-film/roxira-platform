"""Cheap topic clustering (TF-IDF + greedy cosine). Stdlib only, no LLM."""
import collections
import math
import re

_STOP = set("""
و در به از که را این آن با برای یا هم تا بر اگر چه چی چند چرا چیست چگونه چطور آیا است هست بود باشد
می شود شد شده کرد کنم کنید کند میشه میشود باید نیست نمی ام ایم اید اند ای من ما شما او ایشان
یک دو بعد قبل بین هر همه خیلی بسیار فقط هم نیز بدون روی زیر پس ولی اما اینکه آنکه چیه
سلام ممنون لطفا لطفاً خواهش وکیل قانون حقوق name phone id num email url the a of to is
""".split())
_TOKEN = re.compile(r"[^\W\d_]{2,}", re.UNICODE)
_FIX = str.maketrans({"ي": "ی", "ك": "ک", "ة": "ه", "ؤ": "و", "أ": "ا", "إ": "ا"})
_MARKS = re.compile("[ً-ٰٟ‌‍]")


def tokens(text: str) -> list:
    t = _MARKS.sub(lambda m: " " if m.group(0) == "‌" else "", str(text).translate(_FIX)).lower()
    return [w for w in _TOKEN.findall(t) if w not in _STOP]


def _vectors(docs):
    toks = [tokens(d) for d in docs]
    df = collections.Counter(w for t in toks for w in set(t))
    n = max(1, len(docs))
    vecs = []
    for t in toks:
        tf = collections.Counter(t)
        v = {w: (1 + math.log(c)) * (math.log((1 + n) / (1 + df[w])) + 1) for w, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs.append({w: x / norm for w, x in v.items()})
    return vecs


def _cos(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(w, 0.0) for w, x in a.items())


def cluster(docs, threshold: float = 0.30, top_terms: int = 3):
    """Greedy clustering. Returns clusters sorted by size: dicts with members (indexes), terms, label."""
    vecs = _vectors(docs)
    cents, members = [], []
    for i, v in enumerate(vecs):
        best, best_s = -1, 0.0
        for j, c in enumerate(cents):
            s = _cos(v, c)
            if s > best_s:
                best, best_s = j, s
        if best >= 0 and best_s >= threshold:
            members[best].append(i)
            for w, x in v.items():
                cents[best][w] = cents[best].get(w, 0.0) + x
        else:
            cents.append(dict(v))
            members.append([i])
    out = []
    for c, m in zip(cents, members):
        terms = [w for w, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:top_terms]]
        out.append({"members": m, "size": len(m), "terms": terms, "label": " ".join(terms) or "(empty)"})
    out.sort(key=lambda x: (-x["size"], x["label"]))
    return out
