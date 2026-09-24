"""SQLAlchemy model generated from the OpenAPI contract."""

from __future__ import annotations

from sqlalchemy import Integer, String, Float, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class JournalEntry(Base):
    """`journal_entries` table."""

    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_number: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str | None] = mapped_column(String)
