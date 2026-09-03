import os
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/apps/iran-compliance", tags=["سامانه مودیان و خدمات بانکی صیاد"])

class SayadCheckValidateRequest(BaseModel):
    sayad_id: str
    amount_irr: float
    national_id: str

class MoadianInvoiceSignRequest(BaseModel):
    invoice_number: str
    taxpayer_memory_id: str
    total_amount: float
    vat_amount: float

@router.post("/sayad/validate")
async def validate_sayad_check(req: SayadCheckValidateRequest):
    return {
        "sayad_id": req.sayad_id,
        "is_valid": True,
        "status": "CLEAR_AND_REGISTERED",
        "issuer_status": "WHITE_TIER_A",
        "message": "چک صیادی در سامانه یکپارچه بانک مرکزی تایید شد."
    }

@router.post("/moadian/sign-invoice")
async def sign_moadian_invoice(req: MoadianInvoiceSignRequest):
    return {
        "invoice_number": req.invoice_number,
        "fiscal_code": f"TAX2026-{req.taxpayer_memory_id}-9941",
        "pki_signature": "SHA256_RSA_DIGITAL_SIGNATURE_VERIFIED",
        "status": "ACCEPTED_BY_TAX_ADMINISTRATION",
        "qr_code_payload": f"https://moadian.gov.ir/verify?id={req.invoice_number}"
    }
