"""Deployment + env-var routes."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.crypto import decrypt
from app.models.deployment import Deployment, DeploymentProvider, DeploymentStatus, EnvVar
from app.models.project import Project
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.deployment import (
    DeploymentCreate,
    DeploymentLogs,
    DeploymentOut,
    EnvVarCreate,
    EnvVarOut,
    EnvVarUpdate,
)
from app.services import deployment_service as ds
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(tags=["deployments"])


async def _project_for_user(db: AsyncSession, user: User, project_id: UUID, min_role=WorkspaceRole.member) -> Project:
    res = await db.execute(select(Project).where(Project.id == project_id))
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")
    await assert_workspace_access(db, user, proj.workspace_id, min_role)
    return proj


# ---------- ENV VARS ----------
@router.get("/projects/{project_id}/env", response_model=list[EnvVarOut])
async def list_env(
    project_id: UUID,
    reveal: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_for_user(db, user, project_id, WorkspaceRole.viewer)
    items = await ds.list_env_vars(db, str(project_id), reveal=reveal)
    return [EnvVarOut.model_validate(i) for i in items]


@router.post("/projects/{project_id}/env", response_model=EnvVarOut, status_code=201)
async def create_env(
    project_id: UUID,
    payload: EnvVarCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_for_user(db, user, project_id, WorkspaceRole.member)
    ev = await ds.upsert_env_var(
        db, str(project_id), payload.key, payload.value, payload.environment, payload.secret, payload.description
    )
    # Re-fetch through list to apply masking
    ev.value = decrypt(ev.value)
    if payload.secret:
        ev.value = ds._mask(ev.value)
    return EnvVarOut.model_validate(ev)


@router.patch("/env/{env_id}", response_model=EnvVarOut)
async def update_env(
    env_id: UUID,
    payload: EnvVarUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(EnvVar).where(EnvVar.id == env_id))
    ev = res.scalar_one_or_none()
    if not ev:
        raise HTTPException(404, "Env var not found")
    await _project_for_user(db, user, ev.project_id, WorkspaceRole.member)
    ev = await ds.update_env_var(
        db, ev, value=payload.value, environment=payload.environment, secret=payload.secret, description=payload.description
    )
    ev.value = decrypt(ev.value)
    if ev.secret:
        ev.value = ds._mask(ev.value)
    return EnvVarOut.model_validate(ev)


@router.delete("/env/{env_id}", status_code=204)
async def delete_env(env_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(EnvVar).where(EnvVar.id == env_id))
    ev = res.scalar_one_or_none()
    if not ev:
        return
    await _project_for_user(db, user, ev.project_id, WorkspaceRole.member)
    await db.delete(ev)
    await db.commit()


# ---------- DEPLOYMENTS ----------
@router.post("/deployments", response_model=DeploymentOut, status_code=201)
async def create_deployment(
    payload: DeploymentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _project_for_user(db, user, payload.project_id, WorkspaceRole.member)
    deployment = Deployment(
        user_id=user.id,
        project_id=project.id,
        provider=payload.provider,
        branch=payload.branch,
        commit_sha=payload.commit_sha,
        status=DeploymentStatus.pending,
    )
    db.add(deployment)
    await db.commit()
    await db.refresh(deployment)

    if payload.provider == DeploymentProvider.vercel:
        try:
            info = await ds.vercel_create_deployment(db, project, payload.branch, target=payload.target or "production")
            deployment.provider_deployment_id = info.get("id")
            deployment.status = ds.map_vercel_status(info.get("readyState") or info.get("state"))
            url = info.get("url")
            if url and not url.startswith("http"):
                url = "https://" + url
            deployment.url = url
            deployment.extra = {"alias": info.get("alias", []), "inspectorUrl": info.get("inspectorUrl")}
        except HTTPException as e:
            deployment.status = DeploymentStatus.error
            deployment.logs = (deployment.logs or "") + f"\n[error] {e.detail}"
        await db.commit()
        await db.refresh(deployment)
    elif payload.provider == DeploymentProvider.railway:
        # Railway needs an existing service. We record the deployment as pending
        # and surface the missing-config error in the logs panel.
        deployment.logs = (
            "Railway deployments require an existing service. Set RAILWAY_API_TOKEN and "
            "configure your service in extra={service_id, environment_id}.\n"
        )
        await db.commit()

    return DeploymentOut.model_validate(deployment)


@router.get("/projects/{project_id}/deployments", response_model=list[DeploymentOut])
async def list_project_deployments(
    project_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _project_for_user(db, user, project_id, WorkspaceRole.viewer)
    res = await db.execute(
        select(Deployment).where(Deployment.project_id == project_id).order_by(Deployment.created_at.desc())
    )
    return [DeploymentOut.model_validate(d) for d in res.scalars().all()]


@router.get("/deployments/{deployment_id}", response_model=DeploymentOut)
async def get_deployment(
    deployment_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    d = await ds.get_deployment(db, str(deployment_id))
    await _project_for_user(db, user, d.project_id, WorkspaceRole.viewer)
    return DeploymentOut.model_validate(d)


@router.post("/deployments/{deployment_id}/refresh", response_model=DeploymentLogs)
async def refresh(
    deployment_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    d = await ds.get_deployment(db, str(deployment_id))
    await _project_for_user(db, user, d.project_id, WorkspaceRole.viewer)
    d = await ds.refresh_deployment(db, d)
    return DeploymentLogs(
        deployment_id=d.id, status=d.status, url=d.url, logs=d.logs or "", updated_at=d.updated_at
    )


@router.get("/deployments/{deployment_id}/logs", response_model=DeploymentLogs)
async def logs(
    deployment_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    d = await ds.get_deployment(db, str(deployment_id))
    await _project_for_user(db, user, d.project_id, WorkspaceRole.viewer)
    return DeploymentLogs(
        deployment_id=d.id, status=d.status, url=d.url, logs=d.logs or "", updated_at=d.updated_at
    )
