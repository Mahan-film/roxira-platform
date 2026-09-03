import os, json
from typing import TypedDict, Annotated, Optional
from langgraph.graph import StateGraph, END
from pydantic import BaseModel

# ۱. تعریف وضعیت حالت ایجنت (Deterministic State)
class FinancialDocumentState(TypedDict):
    raw_document_path: str
    parsed_invoice: dict
    tax_compliance_status: str
    is_human_approved: bool
    final_journal_entry_id: Optional[str]
    error_message: Optional[str]

# ۲. نودهای پردازشی پایپ‌لاین
def node_parse_document(state: FinancialDocumentState) -> FinancialDocumentState:
    # شبیه‌سازی استخراج محتوا توسط Docling
    state["parsed_invoice"] = {
        "invoice_no": "INV-2026-904",
        "vendor": "پارس سرور ابری",
        "subtotal": 125000000.0,
        "tax": 11250000.0,
        "total": 136250000.0
    }
    return state

def node_validate_compliance(state: FinancialDocumentState) -> FinancialDocumentState:
    inv = state["parsed_invoice"]
    # بررسی تطابق مالیات بر ارزش افزوده ۹٪
    expected_tax = inv["subtotal"] * 0.09
    if abs(inv["tax"] - expected_tax) < 100:
        state["tax_compliance_status"] = "COMPLIANT_IFRS"
    else:
        state["tax_compliance_status"] = "TAX_MISMATCH"
    return state

def node_post_to_ledger(state: FinancialDocumentState) -> FinancialDocumentState:
    if state["is_human_approved"] and state["tax_compliance_status"] == "COMPLIANT_IFRS":
        state["final_journal_entry_id"] = "JE-POSTED-SUCCESS-2026"
    else:
        state["error_message"] = "سند در انتظار تایید ناظر مالی یا اصلاح مالیاتی است."
    return state

# ۳. ساخت گراف تصمیم‌گیری LangGraph
workflow = StateGraph(FinancialDocumentState)
workflow.add_node("parser", node_parse_document)
workflow.add_node("compliance", node_validate_compliance)
workflow.add_node("ledger", node_post_to_ledger)

workflow.set_entry_point("parser")
workflow.add_edge("parser", "compliance")
workflow.add_edge("compliance", "ledger")
workflow.add_edge("ledger", END)

finance_state_app = workflow.compile()

if __name__ == "__main__":
    initial_state = {
        "raw_document_path": "/app/uploads/sample_invoice.pdf",
        "parsed_invoice": {},
        "tax_compliance_status": "PENDING",
        "is_human_approved": True,
        "final_journal_entry_id": None,
        "error_message": None
    }
    result = finance_state_app.invoke(initial_state)
    print("🚀 خروجی اجرای موتور تصمیم‌گیری LangGraph:")
    print(json.dumps(result, ensure_ascii=False, indent=2))
