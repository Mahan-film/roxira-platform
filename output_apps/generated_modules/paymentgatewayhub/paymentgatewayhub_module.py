from datetime import datetime
from typing import List
from enum import Enum
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import String, Integer, Float, DateTime, Enum as SQLEnum, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.ext.asyncio import AsyncAttrs

router = APIRouter(prefix="/api/v1/apps/paymentgatewayhub", tags=["Payment Gateway Hub"])

class Base(AsyncAttrs, DeclarativeBase):
    pass

class GatewayType(str, Enum):
    SHETAB_IPG = "SHETAB_IPG"
    STRIPE = "STRIPE"

class PaymentTransaction(Base):
    __tablename__ = "fin_transactions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tracking_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float)
    gateway: Mapped[GatewayType] = mapped_column(SQLEnum(GatewayType))
    is_settled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class GatewayInfo(BaseModel):
    id: str
    name: str
    type: GatewayType
    is_active: bool

@router.get("/gateways", response_model=List[GatewayInfo])
async def get_active_gateways():
    return [
        GatewayInfo(id="gw-01", name="درگاه شاپرک/سداد", type=GatewayType.SHETAB_IPG, is_active=True),
        GatewayInfo(id="gw-02", name="Stripe Global Routing", type=GatewayType.STRIPE, is_active=True)
    ]
