"""Render the daily improvement report (Persian + English). Pure functions, stdlib only."""


def render(day: str, golden: dict, analysis: dict, logs: dict, suggestions: dict, spent: float, cap: float) -> str:
    L = [f"# Smart Judge self-improvement report {day} / گزارش بهبود مستمر قاضی هوشمند", ""]
    L += ["_Proposals only: nothing was changed automatically. All legal facts are TO-VERIFY by a lawyer. "
          "هیچ تغییری خودکار اعمال نشده؛ همه موارد حقوقی نیاز به تأیید وکیل دارند._", ""]
    L += ["## 1. Golden eval / ارزیابی طلایی"]
    if golden.get("run"):
        L.append(f"- Passed {golden['passed']}/{golden['run']} (live /chat, cheap model)")
        for f in golden.get("failed", [])[:10]:
            L.append(f"  - FAIL {f['id']}: missing={f['missing']} forbidden={f['forbidden']}")
        if golden.get("skipped_budget"):
            L.append(f"- {golden['skipped_budget']} cases skipped (budget cap)")
    else:
        L.append("- not run / اجرا نشد: " + golden.get("reason", "n/a"))
    L += ["", "## 2. Last 24 h / ۲۴ ساعت گذشته",
          f"- user questions: {analysis['total']}; zero sources: {analysis['no_source']}; "
          f"\"not found in sources\" answers: {analysis['not_found']}",
          f"- chats timed: {logs.get('chats', 0)}; total p95: {logs.get('total_ms_p95')} ms; "
          f"slow >20 s: {logs.get('slow_over_20s', 0)}; LLM unavailable: {logs.get('llm_unavailable', 0)}",
          f"- client errors: {logs.get('client_errors') or 'none'}", ""]
    L += ["## 3. Top missing-law topics / موضوعات بدون منبع"]
    if not analysis["missing"]:
        L.append("- none")
    for c in analysis["missing"]:
        L.append(f"- [{c['label']}] n={c['size']} no-source={c['no_source']} not-found={c['not_found']}")
        s = suggestions.get(c["label"])
        if s:
            L.append(f"  - candidate laws/articles to ingest (TO-VERIFY): {s}")
    L += ["", "## 4. Candidate retrieval_boost.py keyword rules / قواعد پیشنهادی"]
    for c in analysis["missing"][:5]:
        L.append(f"- keywords {c['terms']} -> law: TBD (TO-VERIFY)")
    L += ["", "## 5. Candidate new golden cases (TO-VERIFY) / موارد پیشنهادی"]
    for c in analysis["missing"][:5]:
        L.append(f"- question (anonymised): {c['example']} | must_mention: TO-VERIFY")
    L += ["", "## 6. Repeated topics / موضوعات پرتکرار"]
    for c in analysis["repeated"][:8]:
        L.append(f"- [{c['label']}] x{c['size']}")
    if not analysis["repeated"]:
        L.append("- none")
    L += ["", "## 7. Prompt issues / مشکلات پرامپت"]
    L += [f"- {p}" for p in analysis["prompt_issues"]] or ["- none"]
    L += ["", f"LLM spend today: {spent:.4f} / {cap:.2f} USD", ""]
    return "\n".join(L)


def actionable_items(analysis: dict, golden: dict) -> list:
    """(title, body) pairs for optional GitHub issues. Topic labels and counts only, no question text."""
    items = []
    for c in analysis["missing"][:3]:
        items.append((f"self-improve: missing sources for topic [{c['label']}]",
                      f"{c['size']} questions, {c['no_source']} with zero sources, {c['not_found']} 'not found'. "
                      f"Terms: {', '.join(c['terms'])}. Candidate: ingest relevant law or add a retrieval_boost rule (TO-VERIFY)."))
    for f in golden.get("failed", [])[:3]:
        items.append((f"self-improve: golden case failing [{f['id']}]",
                      f"missing={f['missing']} forbidden={f['forbidden']}"))
    return items
