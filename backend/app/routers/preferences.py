"""User preferences + project memory + semantic search."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.preferences import MemoryEmbedding, ProjectMemory, UserPreferences
from app.models.project import Project
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.preferences import (
    ProjectMemoryCreate,
    ProjectMemoryOut,
    ProjectMemoryUpdate,
    SemanticHit,
    SemanticSearchQuery,
    UserPreferencesOut,
    UserPreferencesUpdate,
)
from app.services import semantic_service as sem
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(tags=["preferences"])


# ---------- preferences ----------
@router.get("/preferences", response_model=UserPreferencesOut)
async def get_preferences(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user.id))
    p = res.scalar_one_or_none()
    if p is None:
        p = UserPreferences(user_id=user.id)
        db.add(p)
        await db.commit()
        await db.refresh(p)
    return UserPreferencesOut.model_validate(p)


@router.patch("/preferences", response_model=UserPreferencesOut)
async def update_preferences(
    payload: UserPreferencesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(UserPreferences).where(UserPreferences.user_id == user.id))
    p = res.scalar_one_or_none() or UserPreferences(user_id=user.id)
    if payload.theme is not None:
        p.theme = payload.theme
    if payload.default_model is not None:
        p.default_model = payload.default_model
    if payload.default_system_prompt is not None:
        p.default_system_prompt = payload.default_system_prompt
    if payload.preferences is not None:
        p.preferences = payload.preferences
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return UserPreferencesOut.model_validate(p)


# ---------- project memory ----------
async def _project_for_user(db: AsyncSession, user: User, project_id: UUID, min_role=WorkspaceRole.member) -> Project:
    res = await db.execute(select(Project).where(Project.id == project_id))
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")
    await assert_workspace_access(db, user, proj.workspace_id, min_role)
    return proj


@router.get("/projects/{project_id}/memory", response_model=list[ProjectMemoryOut])
async def list_project_memory(
    project_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _project_for_user(db, user, project_id, WorkspaceRole.viewer)
    res = await db.execute(
        select(ProjectMemory)
        .where(ProjectMemory.project_id == project_id)
        .order_by(ProjectMemory.importance.desc())
    )
    return [ProjectMemoryOut.model_validate(m) for m in res.scalars().all()]


@router.post("/projects/{project_id}/memory", response_model=ProjectMemoryOut, status_code=201)
async def create_project_memory(
    project_id: UUID,
    payload: ProjectMemoryCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_for_user(db, user, project_id, WorkspaceRole.member)
    res = await db.execute(
        select(ProjectMemory).where(ProjectMemory.project_id == project_id, ProjectMemory.key == payload.key)
    )
    m = res.scalar_one_or_none()
    if m is None:
        m = ProjectMemory(
            project_id=project_id,
            user_id=user.id,
            key=payload.key,
            value=payload.value,
            importance=payload.importance,
        )
        db.add(m)
    else:
        m.value = payload.value
        m.importance = payload.importance
    await db.commit()
    await db.refresh(m)
    await sem.upsert_embedding(
        db,
        user_id=user.id,
        scope="project",
        ref_id=m.id,
        project_id=m.project_id,
        text=f"{m.key}: {m.value}",
    )
    return ProjectMemoryOut.model_validate(m)


@router.patch("/projects/memory/{memory_id}", response_model=ProjectMemoryOut)
async def update_project_memory(
    memory_id: UUID,
    payload: ProjectMemoryUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(ProjectMemory).where(ProjectMemory.id == memory_id))
    m = res.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Not found")
    await _project_for_user(db, user, m.project_id, WorkspaceRole.member)
    if payload.value is not None:
        m.value = payload.value
    if payload.importance is not None:
        m.importance = payload.importance
    await db.commit()
    await db.refresh(m)
    await sem.upsert_embedding(
        db,
        user_id=user.id,
        scope="project",
        ref_id=m.id,
        project_id=m.project_id,
        text=f"{m.key}: {m.value}",
    )
    return ProjectMemoryOut.model_validate(m)


@router.delete("/projects/memory/{memory_id}", status_code=204)
async def delete_project_memory(
    memory_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(ProjectMemory).where(ProjectMemory.id == memory_id))
    m = res.scalar_one_or_none()
    if not m:
        return
    await _project_for_user(db, user, m.project_id, WorkspaceRole.member)
    await sem.delete_embedding(db, "project", m.id)
    await db.delete(m)
    await db.commit()


# ---------- semantic search across user + project memory ----------
@router.post("/memory/semantic", response_model=list[SemanticHit])
async def semantic_search(
    payload: SemanticSearchQuery,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hits = await sem.search(db, user.id, payload.query, payload.project_id, payload.limit)
    return [
        SemanticHit(scope=h.scope, ref_id=h.ref_id, project_id=h.project_id, text=h.text, score=score)
        for h, score in hits
    ]


@router.post("/memory/reindex")
async def reindex(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    n = await sem.reindex_for_user(db, user.id)
    return {"reindexed": n}


@router.get("/memory/all")
async def all_memory(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Combined viewer: user + project memory in one payload for the Memory UI."""
    from app.models.memory import UserMemory

    u = (await db.execute(select(UserMemory).where(UserMemory.user_id == user.id))).scalars().all()
    p = (await db.execute(select(ProjectMemory).where(ProjectMemory.user_id == user.id))).scalars().all()
    e = (await db.execute(select(MemoryEmbedding).where(MemoryEmbedding.user_id == user.id))).scalars().all()
    return {
        "user_memory": [
            {
                "id": str(m.id), "key": m.key, "value": m.value, "kind": m.kind,
                "importance": m.importance, "workspace_id": str(m.workspace_id) if m.workspace_id else None,
                "updated_at": m.updated_at.isoformat(),
            }
            for m in u
        ],
        "project_memory": [
            {
                "id": str(m.id), "project_id": str(m.project_id), "key": m.key, "value": m.value,
                "importance": m.importance, "updated_at": m.updated_at.isoformat(),
            }
            for m in p
        ],
        "embedding_count": len(e),
    }
