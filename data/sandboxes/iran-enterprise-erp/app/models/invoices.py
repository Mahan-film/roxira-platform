"""SQLAlchemy model generated from the OpenAPI contract."""

from __future__ import annotations

from sqlalchemy import Integer, String, Float, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Invoice(Base):
    """`invoices` table."""

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String, nullable=False)
    party_name: Mapped[str | None] = mapped_column(String)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False)
    tax_amount: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str | None] = mapped_column(String)
