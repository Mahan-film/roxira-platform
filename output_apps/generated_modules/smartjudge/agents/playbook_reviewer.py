from typing import Dict, Any, List

CLAUSE_PLAYBOOK_RULES = {
    "FORCE_MAJEURE": "بررسی شرایط حوادث قهری، مهلت اخطار و انحلال قرارداد طبق ماده ۲۲۷ و ۲۲۹ ق.م",
    "DISPUTE_RESOLUTION": "تعیین داوری سازمانی یا صلاحیت محاکم عمومی حقوقی",
    "LIMITATION_OF_LIABILITY": "بررسی سقف مسئولیت و انطباق با قواعد تسبیب و ضمان قهری",
    "PENALTY_CLAUSE": "ممیزی خسارت تاخیر تادیه و وجه التزام طبق ماده ۲۳۰ ق.م و رای وحدت رویه ۸۰۵"
}

def audit_contract_clauses(contract_text: str) -> Dict[str, Any]:
    findings: List[Dict[str, str]] = []
    for clause_type, rule in CLAUSE_PLAYBOOK_RULES.items():
        if clause_type.lower() in contract_text.lower() or "شرط" in contract_text:
            findings.append({"clause": clause_type, "standard": rule, "status": "AUDITED"})
    return {"clauses_audited": len(findings), "details": findings}
