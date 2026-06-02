from fastapi import APIRouter
from sqlalchemy import text

from app.core.database import engine
from app.core.redis_client import get_redis

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict:
    status = {"app": "ok", "db": "unknown", "redis": "unknown"}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        status["db"] = "ok"
    except Exception as e:  # noqa: BLE001
        status["db"] = f"error: {e}"
    try:
        r = await get_redis()
        pong = await r.ping()
        status["redis"] = "ok" if pong else "error"
    except Exception as e:  # noqa: BLE001
        status["redis"] = f"error: {e}"
    return status
