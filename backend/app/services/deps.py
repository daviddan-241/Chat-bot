from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Query, WebSocket, WebSocketException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.workspace import WorkspaceMember, WorkspaceRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    raw = token
    if not raw and authorization and authorization.lower().startswith("bearer "):
        raw = authorization.split(" ", 1)[1]
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(raw)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    res = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


async def get_user_from_ws(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw = token
    if not raw:
        auth = websocket.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            raw = auth.split(" ", 1)[1]
    if not raw:
        raise WebSocketException(code=1008, reason="Missing token")
    try:
        payload = decode_token(raw)
    except ValueError:
        raise WebSocketException(code=1008, reason="Invalid token")
    if payload.get("type") != "access":
        raise WebSocketException(code=1008, reason="Invalid token type")
    user_id = payload.get("sub")
    res = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = res.scalar_one_or_none()
    if not user or not user.is_active:
        raise WebSocketException(code=1008, reason="User invalid")
    return user


ROLE_RANK = {
    WorkspaceRole.viewer: 0,
    WorkspaceRole.member: 1,
    WorkspaceRole.admin: 2,
    WorkspaceRole.owner: 3,
}


async def assert_workspace_access(
    db: AsyncSession, user: User, workspace_id: UUID, min_role: WorkspaceRole = WorkspaceRole.viewer
) -> WorkspaceMember:
    res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id
        )
    )
    member = res.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")
    if ROLE_RANK[member.role] < ROLE_RANK[min_role]:
        raise HTTPException(status_code=403, detail=f"Requires role {min_role.value}")
    return member
