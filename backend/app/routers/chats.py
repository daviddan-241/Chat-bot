from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.chat import Chat, Message
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.chat import ChatCreate, ChatOut, ChatUpdate, MessageCreate, MessageOut
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(prefix="/chats", tags=["chats"])


@router.post("", response_model=ChatOut, status_code=201)
async def create_chat(payload: ChatCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ChatOut:
    await assert_workspace_access(db, user, payload.workspace_id, WorkspaceRole.member)
    chat = Chat(
        workspace_id=payload.workspace_id,
        project_id=payload.project_id,
        user_id=user.id,
        title=payload.title,
        model=payload.model,
        system_prompt=payload.system_prompt,
        chat_metadata=payload.metadata,
    )
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.get("", response_model=list[ChatOut])
async def list_chats(
    workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[ChatOut]:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.viewer)
    res = await db.execute(
        select(Chat).where(Chat.workspace_id == workspace_id).order_by(Chat.updated_at.desc())
    )
    return [ChatOut.model_validate(c) for c in res.scalars().all()]


async def _get_chat(db: AsyncSession, user: User, chat_id: UUID, min_role=WorkspaceRole.viewer) -> Chat:
    res = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = res.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    await assert_workspace_access(db, user, chat.workspace_id, min_role)
    return chat


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(chat_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ChatOut:
    chat = await _get_chat(db, user, chat_id)
    return ChatOut.model_validate(chat)


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(
    chat_id: UUID, payload: ChatUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ChatOut:
    chat = await _get_chat(db, user, chat_id, WorkspaceRole.member)
    for field, val in payload.model_dump(exclude_unset=True).items():
        if field == "metadata":
            chat.chat_metadata = val
        else:
            setattr(chat, field, val)
    await db.commit()
    await db.refresh(chat)
    return ChatOut.model_validate(chat)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    chat = await _get_chat(db, user, chat_id, WorkspaceRole.member)
    await db.delete(chat)
    await db.commit()


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def list_messages(
    chat_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[MessageOut]:
    await _get_chat(db, user, chat_id)
    res = await db.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.created_at))
    return [MessageOut.model_validate(m) for m in res.scalars().all()]


@router.post("/{chat_id}/messages", response_model=MessageOut, status_code=201)
async def add_message(
    chat_id: UUID,
    payload: MessageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    await _get_chat(db, user, chat_id, WorkspaceRole.member)
    msg = Message(
        chat_id=chat_id,
        role=payload.role,
        content=payload.content,
        message_metadata=payload.metadata,
        artifact_id=payload.artifact_id,
        parent_id=payload.parent_id,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return MessageOut.model_validate(msg)
