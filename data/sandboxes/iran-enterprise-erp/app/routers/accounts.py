"""FastAPI router generated from the OpenAPI contract."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.accounts import Account
from app.models.base import apply_payload, as_dict, from_payload

router = APIRouter(prefix="/api/v1/accounts", tags=["accounts"])

MODEL = Account

@router.get("")
async def list_accounts(session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    """List accounts"""
    result = await session.execute(select(MODEL).order_by(MODEL.id))
    return [as_dict(row) for row in result.scalars().all()]

@router.post("", status_code=201)
async def create_account(payload: dict[str, Any] | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Create account"""
    item = from_payload(MODEL, payload)
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return as_dict(item)

@router.get("/{item_id}")
async def get_account(item_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Read one account"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="accounts not found")
    return as_dict(item)

@router.put("/{item_id}")
async def update_account(item_id: int, payload: dict[str, Any] | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Update account"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="accounts not found")
    apply_payload(item, payload)
    await session.commit()
    await session.refresh(item)
    return as_dict(item)

@router.delete("/{item_id}")
async def delete_account(item_id: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Delete account"""
    item = await session.get(MODEL, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="accounts not found")
    await session.delete(item)
    await session.commit()
    return {"deleted": int(item_id)}

