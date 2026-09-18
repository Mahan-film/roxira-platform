from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/v1/user_1789747637")

class InvoiceValidationRequest(BaseModel):
    invoice_id: str
    private_key: str
    timestamp: datetime

class InvoiceValidationResponse(BaseModel):
    invoice_id: str
    status: str
    message: str
    validated_at: datetime

@router.get("/health")
async def health_check():
    return {"status": "healthy"}

@router.post("/process", response_model=InvoiceValidationResponse)
async def process_invoice(request: InvoiceValidationRequest):
    if not request.private_key.startswith("SECRET_"):
        raise HTTPException(status_code=400, detail="Invalid private key")
    
    validation_status = "VALID" if len(request.invoice_id) == 10 else "INVALID"
    response = InvoiceValidationResponse(
        invoice_id=request.invoice_id,
        status=validation_status,
        message=f"Invoice {request.invoice_id} processed successfully",
        validated_at=datetime.now()
    )
    return response