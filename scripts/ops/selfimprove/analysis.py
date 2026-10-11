"""Turn anonymised turns into problem clusters and improvement proposals. Stdlib only, no LLM."""
import topics

MIN_CLUSTER = 2


def analyse(turns: list) -> dict:
    qs = [t["q"] for t in turns]
    clusters = topics.cluster(qs) if qs else []
    out = []
    for c in clusters:
        m = [turns[i] for i in c["members"]]
        no_src = sum(1 for t in m if t["sources"] == 0)
        nf = sum(1 for t in m if t["not_found"])
        out.append({"label": c["label"], "terms": c["terms"], "size": c["size"], "no_source": no_src,
                    "not_found": nf, "example": m[0]["q"][:120]})
    missing = sorted((c for c in out if c["no_source"] or c["not_found"]),
                     key=lambda c: (-(c["no_source"] + c["not_found"]), -c["size"], c["label"]))
    repeated = [c for c in out if c["size"] >= MIN_CLUSTER][:10]
    prompt_issues = []
    sourced_nf = sum(1 for t in turns if t["not_found"] and t["sources"] > 0)
    if sourced_nf:
        prompt_issues.append(f"{sourced_nf} answers say 'not found in sources' although sources were attached "
                             "(relevance filter too strict or prompt too cautious)")
    short = sum(1 for t in turns if t["answer_len"] < 80)
    if short:
        prompt_issues.append(f"{short} very short answers (<80 chars)")
    return {"total": len(turns), "no_source": sum(1 for t in turns if t["sources"] == 0),
            "not_found": sum(1 for t in turns if t["not_found"]), "clusters": out,
            "missing": missing[:8], "repeated": repeated, "prompt_issues": prompt_issues}
