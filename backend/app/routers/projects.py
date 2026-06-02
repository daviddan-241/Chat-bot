from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.project import File, Project
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.project import (
    FileCreate,
    FileOut,
    FileUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(tags=["projects"])


@router.post("/workspaces/{workspace_id}/projects", response_model=ProjectOut, status_code=201)
async def create_project(
    workspace_id: UUID,
    payload: ProjectCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectOut:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.member)
    proj = Project(
        workspace_id=workspace_id,
        name=payload.name,
        description=payload.description,
        project_metadata=payload.metadata,
        created_by=user.id,
    )
    db.add(proj)
    await db.commit()
    await db.refresh(proj)
    return ProjectOut.model_validate(proj)


@router.get("/workspaces/{workspace_id}/projects", response_model=list[ProjectOut])
async def list_projects(
    workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[ProjectOut]:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.viewer)
    res = await db.execute(select(Project).where(Project.workspace_id == workspace_id).order_by(Project.created_at.desc()))
    return [ProjectOut.model_validate(p) for p in res.scalars().all()]


async def _get_project_with_access(db: AsyncSession, user: User, project_id: UUID, min_role=WorkspaceRole.viewer) -> Project:
    res = await db.execute(select(Project).where(Project.id == project_id))
    proj = res.scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")
    await assert_workspace_access(db, user, proj.workspace_id, min_role)
    return proj


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> ProjectOut:
    proj = await _get_project_with_access(db, user, project_id)
    return ProjectOut.model_validate(proj)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: UUID, payload: ProjectUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ProjectOut:
    proj = await _get_project_with_access(db, user, project_id, WorkspaceRole.member)
    if payload.name is not None:
        proj.name = payload.name
    if payload.description is not None:
        proj.description = payload.description
    if payload.metadata is not None:
        proj.project_metadata = payload.metadata
    await db.commit()
    await db.refresh(proj)
    return ProjectOut.model_validate(proj)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    proj = await _get_project_with_access(db, user, project_id, WorkspaceRole.admin)
    await db.delete(proj)
    await db.commit()


# ---------- Files ----------
@router.post("/projects/{project_id}/files", response_model=FileOut, status_code=201)
async def create_file(
    project_id: UUID, payload: FileCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> FileOut:
    proj = await _get_project_with_access(db, user, project_id, WorkspaceRole.member)
    existing = await db.execute(select(File).where(File.project_id == project_id, File.path == payload.path))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "File path already exists in this project")
    f = File(
        project_id=proj.id,
        path=payload.path,
        name=payload.name,
        content=payload.content,
        mime_type=payload.mime_type,
        size_bytes=len(payload.content.encode("utf-8")),
        file_metadata=payload.metadata,
        created_by=user.id,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return FileOut.model_validate(f)


@router.get("/projects/{project_id}/files", response_model=list[FileOut])
async def list_files(project_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[FileOut]:
    await _get_project_with_access(db, user, project_id)
    res = await db.execute(select(File).where(File.project_id == project_id).order_by(File.path))
    return [FileOut.model_validate(f) for f in res.scalars().all()]


async def _get_file_with_access(db: AsyncSession, user: User, file_id: UUID, min_role=WorkspaceRole.viewer) -> File:
    res = await db.execute(select(File).where(File.id == file_id))
    f = res.scalar_one_or_none()
    if not f:
        raise HTTPException(404, "File not found")
    proj = (await db.execute(select(Project).where(Project.id == f.project_id))).scalar_one()
    await assert_workspace_access(db, user, proj.workspace_id, min_role)
    return f


@router.get("/files/{file_id}", response_model=FileOut)
async def get_file(file_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> FileOut:
    f = await _get_file_with_access(db, user, file_id)
    return FileOut.model_validate(f)


@router.patch("/files/{file_id}", response_model=FileOut)
async def update_file(
    file_id: UUID, payload: FileUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> FileOut:
    f = await _get_file_with_access(db, user, file_id, WorkspaceRole.member)
    if payload.path is not None:
        f.path = payload.path
    if payload.name is not None:
        f.name = payload.name
    if payload.mime_type is not None:
        f.mime_type = payload.mime_type
    if payload.metadata is not None:
        f.file_metadata = payload.metadata
    if payload.content is not None:
        f.content = payload.content
        f.size_bytes = len(payload.content.encode("utf-8"))
    await db.commit()
    await db.refresh(f)
    return FileOut.model_validate(f)


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    f = await _get_file_with_access(db, user, file_id, WorkspaceRole.member)
    await db.delete(f)
    await db.commit()
