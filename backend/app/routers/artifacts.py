from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.artifact import Artifact, ArtifactVersion
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.artifact import ArtifactCreate, ArtifactOut, ArtifactUpdate, ArtifactVersionOut
from app.services.artifact_service import create_artifact, update_artifact
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.post("", response_model=ArtifactOut, status_code=201)
async def create(
    payload: ArtifactCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ArtifactOut:
    art = await create_artifact(
        db,
        user=user,
        workspace_id=payload.workspace_id,
        project_id=payload.project_id,
        title=payload.title,
        type=payload.type,
        language=payload.language,
        content=payload.content,
        metadata=payload.metadata,
    )
    return ArtifactOut.model_validate(art)


@router.get("", response_model=list[ArtifactOut])
async def list_artifacts(
    workspace_id: UUID,
    project_id: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ArtifactOut]:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.viewer)
    q = select(Artifact).where(Artifact.workspace_id == workspace_id)
    if project_id:
        q = q.where(Artifact.project_id == project_id)
    q = q.order_by(Artifact.updated_at.desc())
    res = await db.execute(q)
    return [ArtifactOut.model_validate(a) for a in res.scalars().all()]


async def _get_artifact(db: AsyncSession, user: User, artifact_id: UUID) -> Artifact:
    res = await db.execute(select(Artifact).where(Artifact.id == artifact_id))
    a = res.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Artifact not found")
    await assert_workspace_access(db, user, a.workspace_id, WorkspaceRole.viewer)
    return a


@router.get("/{artifact_id}", response_model=ArtifactOut)
async def get_artifact(
    artifact_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ArtifactOut:
    a = await _get_artifact(db, user, artifact_id)
    return ArtifactOut.model_validate(a)


@router.patch("/{artifact_id}", response_model=ArtifactOut)
async def patch_artifact(
    artifact_id: UUID,
    payload: ArtifactUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ArtifactOut:
    a = await update_artifact(
        db,
        user=user,
        artifact_id=artifact_id,
        title=payload.title,
        language=payload.language,
        content=payload.content,
        metadata=payload.metadata,
    )
    return ArtifactOut.model_validate(a)


@router.delete("/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> None:
    a = await _get_artifact(db, user, artifact_id)
    await assert_workspace_access(db, user, a.workspace_id, WorkspaceRole.member)
    await db.delete(a)
    await db.commit()


@router.get("/{artifact_id}/versions", response_model=list[ArtifactVersionOut])
async def list_versions(
    artifact_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[ArtifactVersionOut]:
    await _get_artifact(db, user, artifact_id)
    res = await db.execute(
        select(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact_id).order_by(ArtifactVersion.version)
    )
    return [ArtifactVersionOut.model_validate(v) for v in res.scalars().all()]


@router.get("/{artifact_id}/versions/{version}", response_model=ArtifactVersionOut)
async def get_version(
    artifact_id: UUID,
    version: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ArtifactVersionOut:
    await _get_artifact(db, user, artifact_id)
    res = await db.execute(
        select(ArtifactVersion).where(
            ArtifactVersion.artifact_id == artifact_id, ArtifactVersion.version == version
        )
    )
    v = res.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Version not found")
    return ArtifactVersionOut.model_validate(v)
