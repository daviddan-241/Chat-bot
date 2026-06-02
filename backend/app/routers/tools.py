from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.tool import ToolExecutionLog
from app.models.user import User
from app.schemas.tool import ToolCallRequest, ToolCallResult, ToolDescriptor, ToolLogOut
from app.services.deps import get_current_user
from app.services.tool_registry import execute_tool, list_tools

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=list[ToolDescriptor])
async def list_available_tools(user: User = Depends(get_current_user)) -> list[ToolDescriptor]:
    return [ToolDescriptor(**t) for t in list_tools()]


@router.post("/call", response_model=ToolCallResult)
async def call_tool(
    payload: ToolCallRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ToolCallResult:
    status, result, error, duration_ms, log_id = await execute_tool(
        db,
        user,
        payload.tool_name,
        payload.arguments,
        workspace_id=payload.workspace_id,
        chat_id=payload.chat_id,
        message_id=payload.message_id,
    )
    return ToolCallResult(status=status, result=result, error=error, duration_ms=duration_ms, log_id=log_id)


@router.get("/logs", response_model=list[ToolLogOut])
async def list_logs(
    workspace_id: UUID | None = Query(default=None),
    chat_id: UUID | None = Query(default=None),
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ToolLogOut]:
    q = select(ToolExecutionLog).where(ToolExecutionLog.user_id == user.id)
    if workspace_id:
        q = q.where(ToolExecutionLog.workspace_id == workspace_id)
    if chat_id:
        q = q.where(ToolExecutionLog.chat_id == chat_id)
    q = q.order_by(ToolExecutionLog.created_at.desc()).limit(min(max(limit, 1), 500))
    res = await db.execute(q)
    return [ToolLogOut.model_validate(l) for l in res.scalars().all()]


@router.get("/logs/{log_id}", response_model=ToolLogOut)
async def get_log(
    log_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ToolLogOut:
    res = await db.execute(
        select(ToolExecutionLog).where(ToolExecutionLog.id == log_id, ToolExecutionLog.user_id == user.id)
    )
    l = res.scalar_one_or_none()
    if not l:
        raise HTTPException(404, "Log not found")
    return ToolLogOut.model_validate(l)
