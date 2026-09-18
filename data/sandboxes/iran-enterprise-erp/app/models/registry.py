"""Every generated model, so Alembic and the app see the metadata."""

from __future__ import annotations

from .accounts import Account
from .journal_entries import JournalEntry
from .journal_items import JournalItem
from .invoices import Invoice

__all__ = ['Account, JournalEntry, JournalItem, Invoice']
