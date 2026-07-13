"""CLI discovery and user profile endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.app.core.cli_registry import get_cli_registry
from backend.app.models.schemas import CustomCliRequest

router = APIRouter()


@router.get("")
def list_clis() -> list[dict[str, Any]]:
    return get_cli_registry().scan()


@router.post("/custom")
def save_custom_cli(body: CustomCliRequest) -> dict[str, Any]:
    try:
        return get_cli_registry().save_custom(body.id, body.name, body.executable, body.args)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/custom/{profile_id}")
def delete_custom_cli(profile_id: str) -> dict[str, str]:
    try:
        get_cli_registry().remove_custom(profile_id)
        return {"status": "deleted", "id": profile_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
