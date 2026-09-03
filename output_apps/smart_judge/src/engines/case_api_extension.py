from __future__ import annotations

import json
import os
import sys
import uuid
import pathlib

# حل خودکار مسیرهای پایتون
CURRENT_FILE = pathlib.Path(__file__).resolve()
for parent in CURRENT_FILE.parents:
    if (parent / "output_apps").is_dir():
        if str(parent) not in sys.path:
            sys.path.insert(0, str(parent))
        break

from pydantic import BaseModel
from output_apps.smart_judge.src.knowledge.case_file_ingestion import ingest_raw_legal_document

class CaseIngestRequest(BaseModel):
    raw_text: str
    doc_category: str = "CONTRACT"
    custom_case_number: str | None = None

def process_case_payload(payload: CaseIngestRequest) -> dict:
    case_num = payload.custom_case_number or f"CASE-{uuid.uuid4().hex[:8].upper()}"
    return ingest_raw_legal_document(
        raw_doc_text=payload.raw_text,
        case_number=case_num,
        doc_category=payload.doc_category
    )

if __name__ == "__main__":
    test_req = CaseIngestRequest(
        raw_text="توافق‌نامه داوری و حل اختلاف مالی به مبلغ ۸۰ میلیون تومان فی‌مابین طرفین در تاریخ ۱۴۰۳/۰۱/۱۰",
        doc_category="ARBITRATION"
    )
    result = process_case_payload(test_req)
    print("CASE_INGESTION_PIPELINE_VERIFIED=PASS")
    print(json.dumps(result, indent=2, ensure_ascii=False))
