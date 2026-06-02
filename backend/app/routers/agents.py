"""Agents router — list/create/update/delete + provider status."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.agent import Agent
from app.models.user import User
from app.schemas.agent import AgentCreate, AgentOut, AgentUpdate, ProviderStatus
from app.services.deps import get_current_user
from app.services.agent_service import list_agents_for_user, seed_builtin_agents
from app.services.ai_providers import configured_providers

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    agents = await list_agents_for_user(db, user)
    if not agents:
        await seed_builtin_agents(db)
        agents = await list_agents_for_user(db, user)
    return [AgentOut.model_validate(a) for a in agents]


@router.get("/providers", response_model=list[ProviderStatus])
async def providers(user: User = Depends(get_current_user)):
    return [ProviderStatus(**p) for p in configured_providers()]


@router.post("/seed")
async def seed(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not user.is_superuser:
        # Allow non-supers to seed once if there are zero agents (first install)
        count = (await db.execute(select(Agent))).scalars().first()
        if count is not None:
            raise HTTPException(403, "Only superusers may re-seed agents")
    n = await seed_builtin_agents(db)
    return {"inserted": n}


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Agent).where(Agent.id == agent_id))
    a = res.scalar_one_or_none()
    if not a or (not a.is_public and a.user_id != user.id):
        raise HTTPException(404, "Agent not found")
    return AgentOut.model_validate(a)


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    payload: AgentCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    a = Agent(
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        icon=payload.icon,
        color=payload.color,
        provider=payload.provider,
        model=payload.model,
        system_prompt=payload.system_prompt,
        temperature=payload.temperature,
        tools=payload.tools,
        capabilities=payload.capabilities,
        examples=payload.examples,
        is_builtin=False,
        is_public=False,
        user_id=user.id,
        sort_order=200,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return AgentOut.model_validate(a)


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: UUID,
    payload: AgentUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Agent).where(Agent.id == agent_id))
    a = res.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Agent not found")
    if a.is_builtin and not user.is_superuser:
        raise HTTPException(403, "Built-in agents are read-only")
    if a.user_id and a.user_id != user.id and not user.is_superuser:
        raise HTTPException(403, "Not your agent")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(a, field, val)
    await db.commit()
    await db.refresh(a)
    return AgentOut.model_validate(a)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Agent).where(Agent.id == agent_id))
    a = res.scalar_one_or_none()
    if not a:
        return
    if a.is_builtin and not user.is_superuser:
        raise HTTPException(403, "Built-in agents cannot be deleted")
    if a.user_id != user.id and not user.is_superuser:
        raise HTTPException(403, "Not your agent")
    await db.delete(a)
    await db.commit()
