from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/v1/user_1789766663")

class ProcessRequest(BaseModel):
    name: str
    age: int
    timestamp: datetime

class ProcessResponse(BaseModel):
    status: str
    message: str
    processed_timestamp: datetime

@router.get("/health")
def health_check():
    return {"status": "healthy"}

@router.post("/process", response_model=ProcessResponse)
def process_data(request: ProcessRequest):
    if request.age < 18:
        raise HTTPException(status_code=400, detail="Age must be 18 or older")
    
    processed_timestamp = datetime.now()
    message = f"Hello {request.name}, your age is {request.age}"
    
    return ProcessResponse(
        status="success",
        message=message,
        processed_timestamp=processed_timestamp
    )