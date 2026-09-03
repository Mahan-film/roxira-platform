from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/warehouse", tags=["Warehouse & ERP"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class Warehouse(Base):
    __tablename__ = "erp_warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    location_code: Mapped[str] = mapped_column(String(50), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class StockItem(Base):
    __tablename__ = "erp_stock_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    barcode: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    batch_number: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

class StockItemCreate(BaseModel):
    sku: str
    barcode: str
    name: str
    quantity: float
    batch_number: Optional[str] = None

class StockItemRead(StockItemCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

@router.get("/items", response_model=List[StockItemRead])
async def list_items():
    return [
        StockItemRead(id=1, sku="SKU-ROX-01", barcode="626000123456", name="سرور ابری روکسیرا نود A", quantity=15.0, batch_number="B-2026-09")
    ]

@router.post("/items", response_model=StockItemRead, status_code=status.HTTP_201_CREATED)
async def register_item(payload: StockItemCreate):
    return StockItemRead(id=2, **payload.model_dump())
