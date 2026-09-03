from __future__ import annotations

import sys
import pathlib

ROOT_DIR = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from src.mcp_server.tenant_tools import mcp_record_isolated_sale, mcp_create_tenant
from src.compliance.tax_engine import EnterpriseTaxComplianceEngine
from output_apps.smart_judge.src.engines.legal_drafter import SmartJudgeEngine

app = FastAPI(title="Roxira Unified Enterprise & Legal OS", version="2.0.0")

class SaleRequest(BaseModel):
    sku: str
    item_name: str
    quantity: float
    unit_price: float
    currency: str
    debit_account: str
    credit_account: str
    description: str

class LegalDraftRequest(BaseModel):
    doc_type: str
    case_facts: str
    client_info: dict

@app.get("/")
def serve_dashboard():
    static_file = pathlib.Path(__file__).parent / "static" / "index.html"
    return FileResponse(static_file)

@app.post("/api/v1/sales")
def create_sale(payload: SaleRequest, x_tenant_id: str = Header(..., description="Store Identifier")):
    try:
        log = mcp_record_isolated_sale(
            tenant_id=x_tenant_id,
            sku=payload.sku,
            item_name=payload.item_name,
            qty=payload.quantity,
            unit_price=payload.unit_price,
            currency=payload.currency,
            debit_acc=payload.debit_account,
            credit_acc=payload.credit_account,
            desc=payload.description
        )
        return {"success": True, "result": log}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/smart-judge/draft")
def draft_legal_doc(payload: LegalDraftRequest):
    try:
        engine = SmartJudgeEngine()
        return engine.generate_legal_document(payload.doc_type, payload.case_facts, payload.client_info)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.api.main:app", host="127.0.0.1", port=8000, reload=True)
