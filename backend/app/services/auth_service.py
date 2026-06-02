import hashlib
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.models.user import Session, User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole
from app.schemas.auth import UserCreate


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def register_user(db: AsyncSession, payload: UserCreate) -> User:
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    await db.flush()

    # Bootstrap a personal workspace
    slug = f"personal-{str(user.id)[:8]}"
    ws = Workspace(name=f"{user.full_name or user.email.split('@')[0]}'s Workspace", slug=slug, owner_id=user.id)
    db.add(ws)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.owner))
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    res = await db.execute(select(User).where(User.email == email.lower()))
    user = res.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive")
    return user


async def issue_tokens(db: AsyncSession, user: User, user_agent: str | None, ip: str | None) -> tuple[str, str]:
    session = Session(
        user_id=user.id,
        refresh_token_hash="",  # filled after we have token
        user_agent=user_agent,
        ip_address=ip,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()

    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id, session.id)
    session.refresh_token_hash = _hash_refresh(refresh)
    await db.commit()
    return access, refresh


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str, User]:
    try:
        payload = decode_token(refresh_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    sid = payload.get("sid")
    sub = payload.get("sub")
    if not sid or not sub:
        raise HTTPException(status_code=401, detail="Invalid token")
    res = await db.execute(select(Session).where(Session.id == UUID(sid)))
    session = res.scalar_one_or_none()
    if not session or session.revoked:
        raise HTTPException(status_code=401, detail="Session revoked")
    if session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    if session.refresh_token_hash != _hash_refresh(refresh_token):
        # token reuse — revoke session as a safety measure
        session.revoked = True
        await db.commit()
        raise HTTPException(status_code=401, detail="Refresh token mismatch")
    user_res = await db.execute(select(User).where(User.id == UUID(sub)))
    user = user_res.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User invalid")

    # rotate
    new_refresh = create_refresh_token(user.id, session.id)
    session.refresh_token_hash = _hash_refresh(new_refresh)
    session.expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    new_access = create_access_token(user.id)
    await db.commit()
    return new_access, new_refresh, user


async def revoke_session(db: AsyncSession, refresh_token: str) -> None:
    try:
        payload = decode_token(refresh_token)
    except ValueError:
        return
    sid = payload.get("sid")
    if not sid:
        return
    res = await db.execute(select(Session).where(Session.id == UUID(sid)))
    session = res.scalar_one_or_none()
    if session:
        session.revoked = True
        await db.commit()
