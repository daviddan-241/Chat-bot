from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact, ArtifactType, ArtifactVersion
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.services.deps import assert_workspace_access


async def create_artifact(
    db: AsyncSession,
    *,
    user: User,
    workspace_id: UUID,
    project_id: UUID | None,
    title: str,
    type: ArtifactType,
    language: str | None,
    content: str,
    metadata: dict | None = None,
) -> Artifact:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.member)
    artifact = Artifact(
        user_id=user.id,
        workspace_id=workspace_id,
        project_id=project_id,
        title=title,
        type=type,
        language=language,
        content=content,
        artifact_metadata=metadata or {},
        version=1,
    )
    db.add(artifact)
    await db.flush()
    db.add(
        ArtifactVersion(
            artifact_id=artifact.id,
            version=1,
            content=content,
            version_metadata=metadata or {},
            created_by=user.id,
        )
    )
    await db.commit()
    await db.refresh(artifact)
    return artifact


async def update_artifact(
    db: AsyncSession,
    *,
    user: User,
    artifact_id: UUID,
    title: str | None = None,
    language: str | None = None,
    content: str | None = None,
    metadata: dict | None = None,
) -> Artifact:
    res = await db.execute(select(Artifact).where(Artifact.id == artifact_id))
    artifact = res.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    await assert_workspace_access(db, user, artifact.workspace_id, WorkspaceRole.member)

    changed = False
    if title is not None:
        artifact.title = title
        changed = True
    if language is not None:
        artifact.language = language
        changed = True
    if metadata is not None:
        artifact.artifact_metadata = metadata
        changed = True
    if content is not None and content != artifact.content:
        artifact.content = content
        artifact.version += 1
        db.add(
            ArtifactVersion(
                artifact_id=artifact.id,
                version=artifact.version,
                content=content,
                version_metadata=metadata or artifact.artifact_metadata,
                created_by=user.id,
            )
        )
        changed = True
    if changed:
        await db.commit()
        await db.refresh(artifact)
    return artifact
