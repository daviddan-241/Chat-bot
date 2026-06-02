"""Google OAuth — sign-in and account linking."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.models.user import Session as DBSession
from app.schemas.integration import OAuthStartResponse
from app.services import google_service as google
from app.services.auth_service import _hash_refresh

router = APIRouter(prefix="/oauth/google", tags=["oauth"])


@router.get("/start", response_model=OAuthStartResponse)
async def start(intent: str = Query("signin"), authorization: str | None = Header(default=None)):
    """If intent='link', requires a logged-in user (Bearer); else creates a sign-in flow."""
    user_id: str | None = None
    if intent == "link":
        if not authorization or not authorization.lower().startswith("bearer "):
            from fastapi import HTTPException
            raise HTTPException(401, "Login required to link a Google account")
        try:
            payload = decode_token(authorization.split(" ", 1)[1])
            user_id = payload.get("sub")
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(401, "Invalid token")
    url, state = await google.begin_oauth(user_id)
    return OAuthStartResponse(authorize_url=url, state=state)


@router.get("/callback")
async def callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    user, created_new, _ = await google.complete_oauth(db, code, state)

    # Issue our own tokens
    session = DBSession(
        user_id=user.id,
        refresh_token_hash="",
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    await db.flush()
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id, session.id)
    session.refresh_token_hash = _hash_refresh(refresh)
    await db.commit()

    fe = settings.FRONTEND_URL.rstrip("/")
    # Send tokens to the frontend via fragment (not in query) so they don't hit server logs as easily
    return RedirectResponse(
        f"{fe}/auth/callback#access_token={access}&refresh_token={refresh}&new={int(created_new)}"
    )
