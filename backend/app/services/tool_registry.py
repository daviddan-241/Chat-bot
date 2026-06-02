"""Tool system: registry + executor. All tools execute server-side and are logged.

Tools are pure-async callables with the signature:
    async def tool(db, user, args) -> dict
Each registers a JSON-schema-style parameter spec for the AI to use.
"""
from __future__ import annotations

import time
from typing import Any, Awaitable, Callable
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact, ArtifactType
from app.models.memory import UserMemory
from app.models.project import File, Project
from app.models.tool import ToolExecutionLog, ToolStatus
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.services.artifact_service import create_artifact, update_artifact
from app.services.deps import assert_workspace_access

ToolFn = Callable[[AsyncSession, User, dict], Awaitable[dict]]


class ToolDef(BaseModel):
    name: str
    description: str
    parameters: dict  # JSON schema-ish
    requires_workspace: bool = True


REGISTRY: dict[str, tuple[ToolDef, ToolFn]] = {}


def register(defn: ToolDef):
    def deco(fn: ToolFn) -> ToolFn:
        REGISTRY[defn.name] = (defn, fn)
        return fn

    return deco


# ---------- File tools ----------
@register(
    ToolDef(
        name="file.read",
        description="Read a file from a project by id.",
        parameters={
            "type": "object",
            "required": ["file_id"],
            "properties": {"file_id": {"type": "string", "format": "uuid"}},
        },
    )
)
async def file_read(db: AsyncSession, user: User, args: dict) -> dict:
    file_id = UUID(args["file_id"])
    res = await db.execute(select(File).join(Project, Project.id == File.project_id).where(File.id == file_id))
    f = res.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "File not found")
    res2 = await db.execute(select(Project).where(Project.id == f.project_id))
    proj = res2.scalar_one()
    await assert_workspace_access(db, user, proj.workspace_id, WorkspaceRole.viewer)
    return {"id": str(f.id), "path": f.path, "name": f.name, "content": f.content, "mime_type": f.mime_type}


@register(
    ToolDef(
        name="file.write",
        description="Create or overwrite a file in a project.",
        parameters={
            "type": "object",
            "required": ["project_id", "path", "content"],
            "properties": {
                "project_id": {"type": "string", "format": "uuid"},
                "path": {"type": "string"},
                "name": {"type": "string"},
                "content": {"type": "string"},
                "mime_type": {"type": "string"},
            },
        },
    )
)
async def file_write(db: AsyncSession, user: User, args: dict) -> dict:
    project_id = UUID(args["project_id"])
    res = await db.execute(select(Project).where(Project.id == project_id))
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")
    await assert_workspace_access(db, user, proj.workspace_id, WorkspaceRole.member)

    path = args["path"]
    content = args["content"]
    name = args.get("name") or path.rsplit("/", 1)[-1]
    mime = args.get("mime_type", "text/plain")

    res2 = await db.execute(select(File).where(File.project_id == project_id, File.path == path))
    existing = res2.scalar_one_or_none()
    if existing:
        existing.content = content
        existing.name = name
        existing.mime_type = mime
        existing.size_bytes = len(content.encode("utf-8"))
        await db.commit()
        await db.refresh(existing)
        return {"id": str(existing.id), "updated": True, "path": existing.path}
    f = File(
        project_id=project_id,
        path=path,
        name=name,
        content=content,
        mime_type=mime,
        size_bytes=len(content.encode("utf-8")),
        created_by=user.id,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return {"id": str(f.id), "created": True, "path": f.path}


# ---------- Artifact tools ----------
@register(
    ToolDef(
        name="artifact.create",
        description="Create a new artifact (code, markdown, html, json, text).",
        parameters={
            "type": "object",
            "required": ["workspace_id", "type", "content"],
            "properties": {
                "workspace_id": {"type": "string", "format": "uuid"},
                "project_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "type": {"type": "string", "enum": ["code", "markdown", "html", "json", "text"]},
                "language": {"type": "string"},
                "content": {"type": "string"},
                "metadata": {"type": "object"},
            },
        },
    )
)
async def artifact_create(db: AsyncSession, user: User, args: dict) -> dict:
    art = await create_artifact(
        db,
        user=user,
        workspace_id=UUID(args["workspace_id"]),
        project_id=UUID(args["project_id"]) if args.get("project_id") else None,
        title=args.get("title", "Untitled"),
        type=ArtifactType(args["type"]),
        language=args.get("language"),
        content=args["content"],
        metadata=args.get("metadata") or {},
    )
    return {"id": str(art.id), "version": art.version}


@register(
    ToolDef(
        name="artifact.update",
        description="Update an artifact, creating a new version.",
        parameters={
            "type": "object",
            "required": ["artifact_id"],
            "properties": {
                "artifact_id": {"type": "string", "format": "uuid"},
                "title": {"type": "string"},
                "language": {"type": "string"},
                "content": {"type": "string"},
                "metadata": {"type": "object"},
            },
        },
    )
)
async def artifact_update_tool(db: AsyncSession, user: User, args: dict) -> dict:
    art = await update_artifact(
        db,
        user=user,
        artifact_id=UUID(args["artifact_id"]),
        title=args.get("title"),
        language=args.get("language"),
        content=args.get("content"),
        metadata=args.get("metadata"),
    )
    return {"id": str(art.id), "version": art.version}


# ---------- Memory tools ----------
@register(
    ToolDef(
        name="memory.store",
        description="Store a memory item (preference, fact, profile).",
        parameters={
            "type": "object",
            "required": ["key", "value"],
            "properties": {
                "key": {"type": "string"},
                "value": {"type": "string"},
                "kind": {"type": "string"},
                "importance": {"type": "number"},
                "workspace_id": {"type": "string", "format": "uuid"},
                "metadata": {"type": "object"},
            },
        },
        requires_workspace=False,
    )
)
async def memory_store(db: AsyncSession, user: User, args: dict) -> dict:
    res = await db.execute(
        select(UserMemory).where(UserMemory.user_id == user.id, UserMemory.key == args["key"])
    )
    mem = res.scalar_one_or_none()
    if mem:
        mem.value = args["value"]
        if "kind" in args:
            mem.kind = args["kind"]
        if "importance" in args:
            mem.importance = float(args["importance"])
        if "metadata" in args:
            mem.memory_metadata = args["metadata"]
    else:
        mem = UserMemory(
            user_id=user.id,
            workspace_id=UUID(args["workspace_id"]) if args.get("workspace_id") else None,
            key=args["key"],
            value=args["value"],
            kind=args.get("kind", "preference"),
            importance=float(args.get("importance", 0.5)),
            memory_metadata=args.get("metadata") or {},
        )
        db.add(mem)
    await db.commit()
    await db.refresh(mem)
    return {"id": str(mem.id), "key": mem.key}


@register(
    ToolDef(
        name="memory.retrieve",
        description="Retrieve relevant memories for a query.",
        parameters={
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "workspace_id": {"type": "string", "format": "uuid"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
        requires_workspace=False,
    )
)
async def memory_retrieve(db: AsyncSession, user: User, args: dict) -> dict:
    from app.services.memory_service import retrieve_relevant_memory

    items = await retrieve_relevant_memory(
        db,
        user.id,
        args["query"],
        UUID(args["workspace_id"]) if args.get("workspace_id") else None,
        int(args.get("limit", 5)),
    )
    return {
        "items": [
            {"id": str(m.id), "key": m.key, "value": m.value, "kind": m.kind, "importance": m.importance}
            for m in items
        ]
    }


# ---------- Executor ----------
def _validate_args(spec: dict, args: dict) -> None:
    """Minimal JSON-schema validation (required + simple type checks)."""
    required = spec.get("required", [])
    for r in required:
        if r not in args:
            raise HTTPException(400, f"Missing required arg: {r}")
    props = spec.get("properties", {})
    for k, v in args.items():
        if k in props:
            t = props[k].get("type")
            type_map = {
                "string": str,
                "integer": int,
                "number": (int, float),
                "boolean": bool,
                "object": dict,
                "array": list,
            }
            if t and t in type_map and not isinstance(v, type_map[t]):
                raise HTTPException(400, f"Arg {k} must be {t}")


async def execute_tool(
    db: AsyncSession,
    user: User,
    tool_name: str,
    arguments: dict,
    workspace_id: UUID | None = None,
    chat_id: UUID | None = None,
    message_id: UUID | None = None,
) -> tuple[ToolStatus, dict, str | None, int, UUID]:
    if tool_name not in REGISTRY:
        log = ToolExecutionLog(
            tool_name=tool_name,
            user_id=user.id,
            workspace_id=workspace_id,
            chat_id=chat_id,
            message_id=message_id,
            arguments=arguments,
            result={},
            status=ToolStatus.denied,
            error="Unknown tool",
            duration_ms=0,
        )
        db.add(log)
        await db.commit()
        await db.refresh(log)
        return ToolStatus.denied, {}, "Unknown tool", 0, log.id

    defn, fn = REGISTRY[tool_name]
    start = time.perf_counter()
    status = ToolStatus.success
    result: dict[str, Any] = {}
    error: str | None = None
    try:
        _validate_args(defn.parameters, arguments)
        if defn.requires_workspace:
            ws = arguments.get("workspace_id") or (str(workspace_id) if workspace_id else None)
            if not ws:
                raise HTTPException(400, "workspace_id required")
            await assert_workspace_access(db, user, UUID(ws), WorkspaceRole.viewer)
        result = await fn(db, user, arguments)
    except HTTPException as e:
        status = ToolStatus.denied if e.status_code in (401, 403) else ToolStatus.error
        error = e.detail if isinstance(e.detail, str) else str(e.detail)
    except ValidationError as e:
        status = ToolStatus.error
        error = e.json()
    except Exception as e:  # noqa: BLE001
        status = ToolStatus.error
        error = str(e)
    duration_ms = int((time.perf_counter() - start) * 1000)

    log = ToolExecutionLog(
        tool_name=tool_name,
        user_id=user.id,
        workspace_id=workspace_id,
        chat_id=chat_id,
        message_id=message_id,
        arguments=arguments,
        result=result,
        status=status,
        error=error,
        duration_ms=duration_ms,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return status, result, error, duration_ms, log.id


def list_tools() -> list[dict]:
    return [
        {"name": d.name, "description": d.description, "parameters": d.parameters}
        for d, _ in REGISTRY.values()
    ]
