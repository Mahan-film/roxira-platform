"""SQLAlchemy model generated from the OpenAPI contract."""

from __future__ import annotations

from sqlalchemy import Integer, String, Float, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class JournalItem(Base):
    """`journal_items` table."""

    __tablename__ = "journal_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(Integer, nullable=False)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    debit: Mapped[float | None] = mapped_column(Float)
    credit: Mapped[float | None] = mapped_column(Float)
