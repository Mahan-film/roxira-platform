# Deep Research prompts (owner pastes these into a Deep Research tool)

Return each answer as a file or message; the hub will read it. Ask for sources with URLs and dates.

## Prompt 1: Persian OCR for scanned Iranian legislation (official gazette PDFs)

I run a Persian legal-AI assistant. I need to extract accurate text, including article numbers («ماده N», «مکرر», «تبصره»), from scanned PDFs of the Iranian Official Gazette (روزنامه رسمی) and old law scans, on a 16 GB Apple Silicon MacBook (no NVIDIA GPU), at zero or very low cost.

Compare, with evidence (benchmarks, independent evaluations, GitHub issues, real user reports, licences, dates): Tesseract 5 with the `fas` model (and best/fast variants, preprocessing such as deskew, binarisation, 300 dpi), Surya OCR, Docling (with its OCR engines), PaddleOCR, EasyOCR, Kraken or other open Persian OCR, and any Persian-specific OCR project released in 2025-2026. Questions: (1) character and word error rate on printed Persian legal text; (2) how well each keeps article numbers, ZWNJ, Arabic-vs-Persian letters (ي ك vs ی ک) and Persian vs Latin digits; (3) speed on Apple Silicon; (4) licence limits for commercial use; (5) a recommended pipeline (pdftotext first, OCR only when no text layer; post-correction; validation by checking article numbering is sequential). Give a ranked recommendation, a 20-page evaluation protocol I can run locally, and caveats.

## Prompt 2: Where to get Iranian legislation text legally and reliably

List all reliable sources of full Persian text of Iranian laws and regulations that are reachable from inside Iran and from abroad: Majlis research centre (rc.majlis.ir), Islamic Parliament portal, qavanin.ir, dotic.ir (Deputy of Laws of the President), rrk.ir (Official Gazette), ekhtebar.ir, Wikisource, any open datasets on GitHub/HuggingFace/Kaggle of Persian legal text (with licence). For each: URL patterns for law pages and downloads, whether a bulk or API download exists, robots.txt and terms of use, text quality (consolidated vs original, amendments included, repealed status shown), update frequency. Also: is there a machine-readable list of repealed laws, and the status of the 1403 law on invalid laws (قانون قوانین باطله) as it concerns commerce-code articles 51 and 53-71 (1347 amendment). Do not give legal advice; give sources and say which claims need a lawyer.

## Prompt 3 (optional): evaluation set for Persian legal Q&A

Design a 50-question evaluation set for an Iranian legal assistant covering: court competence (peace court, public, revolutionary, family, administrative justice, guild disciplinary bodies including computer/IT guild violations), civil and commercial law, criminal procedure, cybercrime, consumer protection, labour, traffic. For each question give the type, what a correct answer must contain, which statute and article it must cite, and traps (repealed articles, outdated courts, common mistakes). Flag every item that a lawyer must verify. Do not invent article numbers: mark unknown ones as TO-VERIFY.
