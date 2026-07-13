"""Agent management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from typing import Any

from backend.app.core.agent_manager import AgentManager, get_agent_manager
from backend.app.models.schemas import Agent, CreateAgentRequest, ResizeRequest, SendTextRequest

router = APIRouter()


def _manager() -> AgentManager:
    return get_agent_manager()


@router.get("", response_model=list[Agent])
def list_agents() -> list[Agent]:
    return [Agent.model_validate(item) for item in _manager().list_agents()]


@router.post("", response_model=Agent)
async def create_agent(body: CreateAgentRequest) -> Agent:
    try:
        agent = _manager().create_agent(
            agent_id=body.id,
            name=body.name,
            command=body.command,
            args=body.args,
            cwd=body.cwd,
            autostart=body.autostart,
        )
        return Agent(
            id=agent.id,
            name=agent.name,
            command=agent.command,
            args=agent.args,
            cwd=agent.cwd,
            status=agent.status,
            git={},
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str) -> dict[str, str]:
    try:
        _manager().remove_agent(agent_id)
        return {"status": "deleted", "agent_id": agent_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("")
async def delete_all_agents() -> dict[str, Any]:
    manager = _manager()
    removed = manager.list_agents()
    for agent in removed:
        try:
            manager.remove_agent(agent["id"])
        except ValueError:
            pass
    return {"status": "deleted_all", "count": len(removed)}


@router.post("/{agent_id}/start")
async def start_agent(agent_id: str) -> dict[str, str]:
    try:
        _manager().start_agent(agent_id)
        return {"status": "started", "agent_id": agent_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{agent_id}/stop")
async def stop_agent(agent_id: str) -> dict[str, str]:
    try:
        _manager().stop_agent(agent_id)
        return {"status": "stopped", "agent_id": agent_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{agent_id}/resize")
async def resize_agent(agent_id: str, body: ResizeRequest) -> dict[str, str]:
    try:
        _manager().resize_agent(agent_id, body.cols, body.rows)
        return {
            "status": "resized",
            "agent_id": agent_id,
            "cols": str(body.cols),
            "rows": str(body.rows),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{agent_id}/send")
async def send_text(agent_id: str, body: SendTextRequest) -> dict[str, str]:
    try:
        _manager().send_to_agent(agent_id, body.text)
        return {"status": "sent", "agent_id": agent_id}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
