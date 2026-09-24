"""SQLAlchemy model generated from the OpenAPI contract."""

from __future__ import annotations

from sqlalchemy import Integer, String, Float, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Account(Base):
    """`accounts` table."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    balance: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[str | None] = mapped_column(String)
