"""Google OAuth (sign-in / account linking)."""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import encrypt
from app.core.redis_client import get_redis
from app.core.security import hash_password
from app.models.integration import Integration, IntegrationProvider
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole

AUTHZ = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN = "https://oauth2.googleapis.com/token"
USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"
OAUTH_STATE_TTL = 600


async def begin_oauth(intent_user_id: str | None) -> tuple[str, str]:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_REDIRECT_URI:
        raise HTTPException(503, "Google OAuth not configured")
    state = secrets.token_urlsafe(32)
    redis = await get_redis()
    await redis.setex(f"oauth:google:{state}", OAUTH_STATE_TTL, intent_user_id or "signin")
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": settings.GOOGLE_SCOPES,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{AUTHZ}?{urlencode(params)}", state


async def complete_oauth(db: AsyncSession, code: str, state: str) -> tuple[User, bool, Integration]:
    """Returns (user, created_new, integration)."""
    redis = await get_redis()
    intent = await redis.get(f"oauth:google:{state}")
    if not intent:
        raise HTTPException(400, "Invalid or expired OAuth state")
    await redis.delete(f"oauth:google:{state}")

    async with httpx.AsyncClient(timeout=20) as client:
        tok = await client.post(
            TOKEN,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if tok.status_code != 200:
            raise HTTPException(400, f"Google token exchange failed: {tok.text[:200]}")
        token_data = tok.json()
        access_token = token_data["access_token"]
        refresh_token = token_data.get("refresh_token")

        info = await client.get(USERINFO, headers={"Authorization": f"Bearer {access_token}"})
        if info.status_code != 200:
            raise HTTPException(400, "Failed to fetch Google profile")
        profile = info.json()

    email = (profile.get("email") or "").lower()
    if not email:
        raise HTTPException(400, "Google account has no email")

    created_new = False
    if intent == "signin":
        res = await db.execute(select(User).where(User.email == email))
        user = res.scalar_one_or_none()
        if user is None:
            # Create a user record + personal workspace
            user = User(
                email=email,
                hashed_password=hash_password(secrets.token_urlsafe(32)),
                full_name=profile.get("name"),
            )
            db.add(user)
            await db.flush()
            slug = f"personal-{str(user.id)[:8]}"
            ws = Workspace(
                name=f"{profile.get('name') or email.split('@')[0]}'s Workspace",
                slug=slug,
                owner_id=user.id,
            )
            db.add(ws)
            await db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.owner))
            created_new = True
    else:
        from uuid import UUID

        user = (await db.execute(select(User).where(User.id == UUID(intent)))).scalar_one()

    # Upsert integration
    res = await db.execute(
        select(Integration).where(
            Integration.user_id == user.id, Integration.provider == IntegrationProvider.google
        )
    )
    integ = res.scalar_one_or_none()
    if integ is None:
        integ = Integration(
            user_id=user.id,
            provider=IntegrationProvider.google,
            access_token=encrypt(access_token),
            refresh_token=encrypt(refresh_token) if refresh_token else None,
            scope=token_data.get("scope"),
            account_id=profile.get("sub"),
            account_login=email,
            account_email=email,
            avatar_url=profile.get("picture"),
            extra={"name": profile.get("name")},
        )
        db.add(integ)
    else:
        integ.access_token = encrypt(access_token)
        if refresh_token:
            integ.refresh_token = encrypt(refresh_token)
        integ.account_email = email
        integ.avatar_url = profile.get("picture")
    await db.commit()
    await db.refresh(user)
    await db.refresh(integ)
    return user, created_new, integ
