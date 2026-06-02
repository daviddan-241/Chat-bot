"""Vercel + Railway deployment helpers."""
from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt, encrypt
from app.models.deployment import Deployment, DeploymentProvider, DeploymentStatus, EnvVar
from app.models.project import File, Project

VERCEL_API = "https://api.vercel.com"
RAILWAY_API = "https://backboard.railway.app/graphql/v2"


# ---------- Env vars ----------
async def list_env_vars(db: AsyncSession, project_id: str, reveal: bool = False) -> list[EnvVar]:
    res = await db.execute(select(EnvVar).where(EnvVar.project_id == project_id).order_by(EnvVar.key))
    items = list(res.scalars().all())
    for it in items:
        plain = decrypt(it.value)
        it.value = plain if reveal else _mask(plain)
    return items


def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 4:
        return "•" * len(v)
    return v[:2] + "•" * (len(v) - 4) + v[-2:]


async def upsert_env_var(
    db: AsyncSession,
    project_id: str,
    key: str,
    value: str,
    environment: str,
    secret: bool,
    description: str | None,
) -> EnvVar:
    res = await db.execute(
        select(EnvVar).where(
            EnvVar.project_id == project_id,
            EnvVar.key == key,
            EnvVar.environment == environment,
        )
    )
    ev = res.scalar_one_or_none()
    if ev is None:
        ev = EnvVar(
            project_id=project_id,
            key=key,
            value=encrypt(value),
            environment=environment,
            secret=secret,
            description=description,
        )
        db.add(ev)
    else:
        ev.value = encrypt(value)
        ev.secret = secret
        ev.description = description
    await db.commit()
    await db.refresh(ev)
    return ev


async def update_env_var(
    db: AsyncSession,
    ev: EnvVar,
    *,
    value: str | None,
    environment: str | None,
    secret: bool | None,
    description: str | None,
) -> EnvVar:
    if value is not None:
        ev.value = encrypt(value)
    if environment is not None:
        ev.environment = environment
    if secret is not None:
        ev.secret = secret
    if description is not None:
        ev.description = description
    await db.commit()
    await db.refresh(ev)
    return ev


async def env_vars_dict(db: AsyncSession, project_id: str, environment: str = "production") -> dict[str, str]:
    res = await db.execute(
        select(EnvVar).where(EnvVar.project_id == project_id, EnvVar.environment == environment)
    )
    return {ev.key: decrypt(ev.value) for ev in res.scalars().all()}


# ---------- Vercel ----------
def _vercel_headers() -> dict[str, str]:
    if not settings.VERCEL_API_TOKEN:
        raise HTTPException(503, "VERCEL_API_TOKEN not configured")
    return {"Authorization": f"Bearer {settings.VERCEL_API_TOKEN}", "Content-Type": "application/json"}


def _vercel_query() -> dict:
    return {"teamId": settings.VERCEL_TEAM_ID} if settings.VERCEL_TEAM_ID else {}


async def vercel_create_deployment(
    db: AsyncSession,
    project: Project,
    branch: str | None,
    target: str = "production",
) -> dict:
    """Bundle the project's files and trigger a Vercel deployment."""
    files_res = await db.execute(select(File).where(File.project_id == project.id))
    files = list(files_res.scalars().all())
    if not files:
        raise HTTPException(400, "Project has no files to deploy")

    env = await env_vars_dict(db, str(project.id), "production")
    env_block = [{"key": k, "value": v, "target": ["production"], "type": "encrypted"} for k, v in env.items()]

    payload: dict[str, Any] = {
        "name": project.name.lower().replace(" ", "-")[:50] or "nova-app",
        "target": target,
        "files": [
            {"file": f.path, "data": f.content}
            for f in files
            if f.size_bytes < 4_000_000
        ],
        "projectSettings": {"framework": (project.project_metadata or {}).get("framework")},
        "env": env_block,
        "build": {"env": env_block},
    }
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"{VERCEL_API}/v13/deployments",
            headers=_vercel_headers(),
            params=_vercel_query(),
            content=json.dumps(payload),
        )
        if res.status_code not in (200, 201):
            raise HTTPException(res.status_code, f"Vercel: {res.text[:300]}")
        return res.json()


async def vercel_get_deployment(deployment_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{VERCEL_API}/v13/deployments/{deployment_id}",
            headers=_vercel_headers(),
            params=_vercel_query(),
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"Vercel: {res.text[:300]}")
        return res.json()


async def vercel_get_logs(deployment_id: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{VERCEL_API}/v2/deployments/{deployment_id}/events",
            headers=_vercel_headers(),
            params={**_vercel_query(), "follow": "0"},
        )
        if res.status_code != 200:
            return f"(no logs: {res.status_code})"
        try:
            events = res.json()
        except Exception:
            return res.text
        lines = []
        for e in events if isinstance(events, list) else []:
            ts = e.get("created", "")
            txt = e.get("text") or e.get("payload", {}).get("text", "") or ""
            lines.append(f"{ts} {txt}".strip())
        return "\n".join(lines) or "(no events)"


# ---------- Railway ----------
def _railway_headers() -> dict[str, str]:
    if not settings.RAILWAY_API_TOKEN:
        raise HTTPException(503, "RAILWAY_API_TOKEN not configured")
    return {"Authorization": f"Bearer {settings.RAILWAY_API_TOKEN}", "Content-Type": "application/json"}


async def railway_trigger_deploy(railway_service_id: str, environment_id: str) -> dict:
    """Trigger a redeploy of an existing Railway service."""
    mutation = """
    mutation ServiceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
    """
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            RAILWAY_API,
            headers=_railway_headers(),
            json={"query": mutation, "variables": {"serviceId": railway_service_id, "environmentId": environment_id}},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"Railway: {res.text[:300]}")
        data = res.json()
        if "errors" in data:
            raise HTTPException(400, f"Railway: {data['errors']}")
        return data


# ---------- Status mapping ----------
def map_vercel_status(state: str | None) -> DeploymentStatus:
    return {
        "READY": DeploymentStatus.ready,
        "BUILDING": DeploymentStatus.building,
        "QUEUED": DeploymentStatus.pending,
        "INITIALIZING": DeploymentStatus.pending,
        "ERROR": DeploymentStatus.error,
        "CANCELED": DeploymentStatus.canceled,
    }.get((state or "").upper(), DeploymentStatus.pending)


# ---------- DB helpers ----------
async def get_deployment(db: AsyncSession, deployment_id: str) -> Deployment:
    res = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Deployment not found")
    return d


async def refresh_deployment(db: AsyncSession, deployment: Deployment) -> Deployment:
    if deployment.provider == DeploymentProvider.vercel and deployment.provider_deployment_id:
        info = await vercel_get_deployment(deployment.provider_deployment_id)
        deployment.status = map_vercel_status(info.get("readyState") or info.get("state"))
        url = info.get("url")
        if url and not url.startswith("http"):
            url = "https://" + url
        deployment.url = url or deployment.url
        try:
            deployment.logs = await vercel_get_logs(deployment.provider_deployment_id)
        except Exception as e:  # noqa: BLE001
            deployment.logs = f"(log fetch failed: {e})"
    await db.commit()
    await db.refresh(deployment)
    return deployment
