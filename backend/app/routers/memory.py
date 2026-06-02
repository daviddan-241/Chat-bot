from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.memory import ChatMemory, UserMemory
from app.models.user import User
from app.schemas.memory import (
    ChatMemoryOut,
    ChatMemoryUpsert,
    UserMemoryCreate,
    UserMemoryOut,
    UserMemoryUpdate,
)
from app.services.deps import get_current_user
from app.services.memory_service import retrieve_relevant_memory, upsert_chat_memory

router = APIRouter(prefix="/memory", tags=["memory"])


@router.post("/user", response_model=UserMemoryOut, status_code=201)
async def create_user_memory(
    payload: UserMemoryCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> UserMemoryOut:
    existing = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user.id, UserMemory.key == payload.key)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Memory key already exists")
    m = UserMemory(
        user_id=user.id,
        workspace_id=payload.workspace_id,
        key=payload.key,
        value=payload.value,
        kind=payload.kind,
        importance=payload.importance,
        memory_metadata=payload.metadata,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return UserMemoryOut.model_validate(m)


@router.get("/user", response_model=list[UserMemoryOut])
async def list_user_memory(
    workspace_id: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserMemoryOut]:
    q = select(UserMemory).where(UserMemory.user_id == user.id).order_by(UserMemory.importance.desc())
    if workspace_id is not None:
        q = q.where((UserMemory.workspace_id == workspace_id) | (UserMemory.workspace_id.is_(None)))
    res = await db.execute(q)
    return [UserMemoryOut.model_validate(m) for m in res.scalars().all()]


@router.get("/user/retrieve", response_model=list[UserMemoryOut])
async def retrieve(
    query: str,
    workspace_id: UUID | None = Query(default=None),
    limit: int = 5,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserMemoryOut]:
    items = await retrieve_relevant_memory(db, user.id, query, workspace_id, limit)
    return [UserMemoryOut.model_validate(m) for m in items]


@router.patch("/user/{memory_id}", response_model=UserMemoryOut)
async def update_user_memory(
    memory_id: UUID,
    payload: UserMemoryUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserMemoryOut:
    res = await db.execute(select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user.id))
    m = res.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Memory not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        if field == "metadata":
            m.memory_metadata = val
        else:
            setattr(m, field, val)
    await db.commit()
    await db.refresh(m)
    return UserMemoryOut.model_validate(m)


@router.delete("/user/{memory_id}", status_code=204)
async def delete_user_memory(
    memory_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> None:
    res = await db.execute(select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user.id))
    m = res.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Memory not found")
    await db.delete(m)
    await db.commit()


@router.put("/chat", response_model=ChatMemoryOut)
async def upsert_chat_mem(
    payload: ChatMemoryUpsert, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ChatMemoryOut:
    cm = await upsert_chat_memory(
        db, payload.chat_id, payload.summary, payload.salient_points, payload.tokens, payload.metadata
    )
    return ChatMemoryOut.model_validate(cm)


@router.get("/chat/{chat_id}", response_model=ChatMemoryOut | None)
async def get_chat_mem(
    chat_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ChatMemoryOut | None:
    res = await db.execute(select(ChatMemory).where(ChatMemory.chat_id == chat_id))
    cm = res.scalar_one_or_none()
    return ChatMemoryOut.model_validate(cm) if cm else None
