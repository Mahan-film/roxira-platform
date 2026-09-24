"""FastAPI router generated from the OpenAPI contract."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.journal_items import JournalItem
from app.models.base import apply_payload, as_dict, from_payload

router = APIRouter(prefix="/api/v1/journal_items", tags=["journal_items"])

MODEL = JournalItem

@router.get("")
async def list_journal_items(session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    """List journal_items"""
    result = await session.execute(select(MODEL).order_by(MODEL.id))
    return [as_dict(row) for row in result.scalars().all()]

@router.post("", status_code=201)
async def create_journal_item(payload: dict[str, Any] | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Create journal_item"""
    item = from_payload(MODEL, payload)
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return as_dict(item)

@router.get("/{item_id}")
async def get_journal_item(item_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Read one journal_item"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="journal_items not found")
    return as_dict(item)

@router.put("/{item_id}")
async def update_journal_item(item_id: int, payload: dict[str, Any] | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Update journal_item"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="journal_items not found")
    apply_payload(item, payload)
    await session.commit()
    await session.refresh(item)
    return as_dict(item)

@router.delete("/{item_id}")
async def delete_journal_item(item_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Delete journal_item"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="journal_items not found")
    await session.delete(item)
    await session.commit()
    return {"deleted": int(item_id)}

