from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import ChatMemory, UserMemory


async def list_user_memory(db: AsyncSession, user_id: UUID, workspace_id: UUID | None = None) -> list[UserMemory]:
    q = select(UserMemory).where(UserMemory.user_id == user_id).order_by(UserMemory.importance.desc())
    if workspace_id is not None:
        q = q.where((UserMemory.workspace_id == workspace_id) | (UserMemory.workspace_id.is_(None)))
    res = await db.execute(q)
    return list(res.scalars().all())


async def retrieve_relevant_memory(
    db: AsyncSession, user_id: UUID, query: str, workspace_id: UUID | None = None, limit: int = 5
) -> list[UserMemory]:
    """Naive keyword scoring; replace with embeddings/pgvector in production."""
    memories = await list_user_memory(db, user_id, workspace_id)
    if not query:
        return memories[:limit]
    terms = [t.lower() for t in query.split() if len(t) > 2]
    scored: list[tuple[float, UserMemory]] = []
    for m in memories:
        text = f"{m.key} {m.value}".lower()
        score = sum(1.0 for t in terms if t in text) + m.importance
        if score > 0:
            scored.append((score, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:limit]]


async def upsert_chat_memory(
    db: AsyncSession, chat_id: UUID, summary: str, salient_points: list, tokens: int, metadata: dict | None = None
) -> ChatMemory:
    res = await db.execute(select(ChatMemory).where(ChatMemory.chat_id == chat_id))
    cm = res.scalar_one_or_none()
    if cm is None:
        cm = ChatMemory(
            chat_id=chat_id,
            summary=summary,
            salient_points=salient_points,
            tokens=tokens,
            memory_metadata=metadata or {},
        )
        db.add(cm)
    else:
        cm.summary = summary
        cm.salient_points = salient_points
        cm.tokens = tokens
        if metadata is not None:
            cm.memory_metadata = metadata
    await db.commit()
    await db.refresh(cm)
    return cm
