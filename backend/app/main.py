from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.redis_client import close_redis, get_redis
from app.routers import (
    agents, ai, artifacts, auth, chats, deployments, health, integrations, memory,
    oauth_google, preferences, projects, tools, workspaces,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # warm redis
    try:
        r = await get_redis()
        await r.ping()
    except Exception:
        pass
    # Seed built-in agents (idempotent)
    try:
        from app.core.database import AsyncSessionLocal
        from app.services.agent_service import seed_builtin_agents
        async with AsyncSessionLocal() as db:
            await seed_builtin_agents(db)
    except Exception:
        pass
    yield
    await close_redis()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(projects.router)
app.include_router(chats.router)
app.include_router(artifacts.router)
app.include_router(memory.router)
app.include_router(tools.router)
app.include_router(ai.router)
app.include_router(integrations.router)
app.include_router(oauth_google.router)
app.include_router(deployments.router)
app.include_router(preferences.router)
app.include_router(agents.router)


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs", "health": "/healthz"}
