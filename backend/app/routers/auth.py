from fastapi import APIRouter, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.auth import AccessToken, RefreshRequest, TokenPair, UserCreate, UserLogin, UserOut
from app.services.auth_service import authenticate, issue_tokens, register_user, revoke_session, rotate_refresh
from app.services.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenPair, status_code=201)
async def register(payload: UserCreate, request: Request, db: AsyncSession = Depends(get_db)) -> TokenPair:
    user = await register_user(db, payload)
    access, refresh = await issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    return TokenPair(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenPair)
async def login(payload: UserLogin, request: Request, db: AsyncSession = Depends(get_db)) -> TokenPair:
    user = await authenticate(db, payload.email, payload.password)
    access, refresh = await issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    return TokenPair(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/token", response_model=TokenPair)
async def login_form(
    request: Request, form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)
) -> TokenPair:
    """OAuth2 password flow (for Swagger UI 'Authorize' button)."""
    user = await authenticate(db, form.username, form.password)
    access, refresh = await issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    return TokenPair(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    access, refresh_token, user = await rotate_refresh(db, payload.refresh_token)
    return TokenPair(access_token=access, refresh_token=refresh_token, user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> None:
    await revoke_session(db, payload.refresh_token)


@router.get("/me", response_model=UserOut)
async def me(user=Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
