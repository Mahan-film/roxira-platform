# RTL control cleanup

Implement `clean_label(value)` in `starter.py`. Remove bidi control characters (LRM, RLM, LRE/RLE/PDF/LRO/RLO, and the isolate controls). A zero-width non-joiner (`\u200c`) must be kept only when it is directly between two Persian/Arabic-script letters; remove it everywhere else. Preserve all other characters.
