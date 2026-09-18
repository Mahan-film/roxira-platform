"""Router registry generated from the OpenAPI contract."""

from __future__ import annotations

from . import accounts
from . import invoices
from . import journal_entries
from . import journal_items

ROUTERS = [accounts.router, invoices.router, journal_entries.router, journal_items.router]
