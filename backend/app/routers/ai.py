"""Streaming AI endpoints with multi-agent + multi-provider support.

POST /ai/stream    -> SSE
POST /chat/stream  -> alias for /ai/stream
WS   /ws/ai        -> WebSocket
"""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.database import AsyncSessionLocal, get_db
from app.core.redis_client import get_redis
from app.models.agent import Agent
from app.models.artifact import ArtifactType
from app.models.chat import Chat, Message, MessageRole
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.chat import StreamRequest
from app.services.agent_service import get_default_agent
from app.services.ai_engine import stream_ai
from app.services.artifact_service import create_artifact
from app.services.deps import assert_workspace_access, get_current_user, get_user_from_ws
from app.services.memory_service import retrieve_relevant_memory

router = APIRouter(tags=["ai"])


async def _load_chat(db: AsyncSession, user: User, chat_id: UUID) -> Chat:
    res = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = res.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    await assert_workspace_access(db, user, chat.workspace_id, WorkspaceRole.member)
    return chat


async def _resolve_agent(db: AsyncSession, chat: Chat, agent_id: UUID | None) -> Agent | None:
    """Pick which agent to use: explicit override > chat default > workspace default."""
    if agent_id:
        res = await db.execute(select(Agent).where(Agent.id == agent_id))
        a = res.scalar_one_or_none()
        if a:
            return a
    if chat.agent_id:
        res = await db.execute(select(Agent).where(Agent.id == chat.agent_id))
        a = res.scalar_one_or_none()
        if a:
            return a
    return await get_default_agent(db)


async def _build_messages(
    db: AsyncSession,
    chat: Chat,
    system_prompt: str | None,
    memory_text: str | None,
    agent: Agent | None,
) -> list[dict]:
    msgs: list[dict] = []
    # Agent persona comes first
    if agent and agent.system_prompt:
        msgs.append({"role": "system", "content": agent.system_prompt})
    # Then chat-level system prompt override
    sys = system_prompt or chat.system_prompt
    if sys:
        msgs.append({"role": "system", "content": sys})
    if memory_text:
        msgs.append({"role": "system", "content": f"Relevant user memory:\n{memory_text}"})
    res = await db.execute(select(Message).where(Message.chat_id == chat.id).order_by(Message.created_at))
    for m in res.scalars().all():
        role = m.role.value if m.role.value != "tool" else "system"
        msgs.append({"role": role, "content": m.content})
    return msgs


async def _persist_user_and_get_context(
    db: AsyncSession, user: User, payload: StreamRequest
) -> tuple[Chat, Message, list[dict], Agent | None]:
    chat = await _load_chat(db, user, payload.chat_id)
    user_msg = Message(
        chat_id=chat.id,
        role=MessageRole.user,
        content=payload.content,
        message_metadata=payload.metadata or {},
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    memory_text = None
    if payload.include_memory:
        mems = await retrieve_relevant_memory(db, user.id, payload.content, chat.workspace_id, limit=5)
        if mems:
            memory_text = "\n".join(f"- [{m.kind}] {m.key}: {m.value}" for m in mems)

    agent = await _resolve_agent(db, chat, payload.agent_id)
    messages = await _build_messages(db, chat, payload.system_prompt, memory_text, agent)
    return chat, user_msg, messages, agent


async def _finalize_assistant(
    chat: Chat,
    user: User,
    full_content: str,
    artifact_data: dict | None,
    model: str | None,
    agent: Agent | None,
    provider: str | None,
) -> tuple[UUID, UUID | None]:
    """Persist assistant message + artifact in a fresh session."""
    async with AsyncSessionLocal() as db:
        artifact_id: UUID | None = None
        if artifact_data:
            art = await create_artifact(
                db,
                user=user,
                workspace_id=chat.workspace_id,
                project_id=chat.project_id,
                title=artifact_data.get("title") or f"{chat.title} artifact",
                type=ArtifactType(artifact_data["type"]),
                language=artifact_data.get("language"),
                content=artifact_data["content"],
                metadata={"source": "ai_stream", "chat_id": str(chat.id)},
            )
            artifact_id = art.id

        msg = Message(
            chat_id=chat.id,
            role=MessageRole.assistant,
            content=full_content,
            message_metadata={
                "model": model,
                "provider": provider,
                "agent_id": str(agent.id) if agent else None,
                "agent_slug": agent.slug if agent else None,
                "streamed": True,
            },
            artifact_id=artifact_id,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg.id, artifact_id


def _resolve_provider_and_model(
    chat: Chat, payload: StreamRequest, agent: Agent | None
) -> tuple[str, str | None, float]:
    """Merge precedence: payload > agent > chat > defaults."""
    provider = payload.provider or (agent.provider if agent else None) or "auto"
    model = payload.model or (agent.model if agent else None) or chat.model
    temperature = payload.temperature if payload.temperature is not None else (agent.temperature if agent else 0.7)
    return provider, model, temperature


@router.post("/ai/stream")
async def ai_stream(
    payload: StreamRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    chat, user_msg, messages, agent = await _persist_user_and_get_context(db, user, payload)
    provider, model, temperature = _resolve_provider_and_model(chat, payload, agent)
    persona = agent.name if agent else ""

    async def event_gen():
        full = ""
        artifact_data: dict | None = None
        yield {
            "event": "start",
            "data": json.dumps({
                "chat_id": str(chat.id),
                "user_message_id": str(user_msg.id),
                "agent_id": str(agent.id) if agent else None,
                "agent_slug": agent.slug if agent else None,
                "provider": provider,
                "model": model,
            }),
        }
        try:
            async for evt in stream_ai(messages, model, provider, temperature, persona):
                if evt["type"] == "token":
                    full += evt["delta"]
                    yield {"event": "token", "data": json.dumps({"delta": evt["delta"]})}
                elif evt["type"] == "artifact":
                    artifact_data = evt["artifact"]
                    yield {"event": "artifact", "data": json.dumps({"artifact": artifact_data})}
                elif evt["type"] == "done":
                    msg_id, art_id = await _finalize_assistant(
                        chat, user, full, artifact_data, model, agent, provider
                    )
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "assistant_message_id": str(msg_id),
                            "artifact_id": str(art_id) if art_id else None,
                            "content": full,
                            "usage": evt.get("usage", {}),
                        }),
                    }
                elif evt["type"] == "error":
                    yield {"event": "error", "data": json.dumps({"error": evt["error"]})}
        except asyncio.CancelledError:
            if full:
                await _finalize_assistant(chat, user, full, artifact_data, model, agent, provider)
            raise

    return EventSourceResponse(event_gen())


@router.post("/chat/stream")
async def chat_stream(
    payload: StreamRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await ai_stream(payload, user, db)


@router.websocket("/ws/ai")
async def ws_ai(websocket: WebSocket, user: User = Depends(get_user_from_ws)):
    await websocket.accept()
    redis = await get_redis()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                payload = StreamRequest(**data)
            except Exception as e:  # noqa: BLE001
                await websocket.send_json({"event": "error", "error": f"Invalid payload: {e}"})
                continue

            async with AsyncSessionLocal() as db:
                try:
                    chat, user_msg, messages, agent = await _persist_user_and_get_context(db, user, payload)
                except HTTPException as e:
                    await websocket.send_json({"event": "error", "error": e.detail})
                    continue

            provider, model, temperature = _resolve_provider_and_model(chat, payload, agent)
            persona = agent.name if agent else ""
            await websocket.send_json({
                "event": "start",
                "chat_id": str(chat.id),
                "user_message_id": str(user_msg.id),
                "agent_id": str(agent.id) if agent else None,
                "agent_slug": agent.slug if agent else None,
                "provider": provider,
                "model": model,
            })

            full = ""
            artifact_data: dict | None = None
            stream_key = f"stream:{chat.id}:{user_msg.id}"
            try:
                async for evt in stream_ai(messages, model, provider, temperature, persona):
                    if evt["type"] == "token":
                        full += evt["delta"]
                        await websocket.send_json({"event": "token", "delta": evt["delta"]})
                        await redis.append(stream_key, evt["delta"])
                        await redis.expire(stream_key, 600)
                    elif evt["type"] == "artifact":
                        artifact_data = evt["artifact"]
                        await websocket.send_json({"event": "artifact", "artifact": artifact_data})
                    elif evt["type"] == "done":
                        msg_id, art_id = await _finalize_assistant(
                            chat, user, full, artifact_data, model, agent, provider
                        )
                        await websocket.send_json({
                            "event": "done",
                            "assistant_message_id": str(msg_id),
                            "artifact_id": str(art_id) if art_id else None,
                            "content": full,
                            "usage": evt.get("usage", {}),
                        })
                        await redis.delete(stream_key)
                    elif evt["type"] == "error":
                        await websocket.send_json({"event": "error", "error": evt["error"]})
            except WebSocketDisconnect:
                if full:
                    await _finalize_assistant(chat, user, full, artifact_data, model, agent, provider)
                return
    except WebSocketDisconnect:
        return
