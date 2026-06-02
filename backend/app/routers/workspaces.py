from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole
from app.schemas.workspace import MemberAdd, MemberOut, WorkspaceCreate, WorkspaceOut, WorkspaceUpdate
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("", response_model=WorkspaceOut, status_code=201)
async def create_workspace(
    payload: WorkspaceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> WorkspaceOut:
    existing = await db.execute(select(Workspace).where(Workspace.slug == payload.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Slug already taken")
    ws = Workspace(name=payload.name, slug=payload.slug, description=payload.description, owner_id=user.id)
    db.add(ws)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=WorkspaceRole.owner))
    await db.commit()
    await db.refresh(ws)
    return WorkspaceOut.model_validate(ws)


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[WorkspaceOut]:
    res = await db.execute(
        select(Workspace).join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id).where(
            WorkspaceMember.user_id == user.id
        )
    )
    return [WorkspaceOut.model_validate(w) for w in res.scalars().all()]


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(
    workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> WorkspaceOut:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.viewer)
    res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ws = res.scalar_one_or_none()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    return WorkspaceOut.model_validate(ws)


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    workspace_id: UUID,
    payload: WorkspaceUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.admin)
    res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ws = res.scalar_one_or_none()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    if payload.name is not None:
        ws.name = payload.name
    if payload.description is not None:
        ws.description = payload.description
    await db.commit()
    await db.refresh(ws)
    return WorkspaceOut.model_validate(ws)


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> None:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.owner)
    res = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ws = res.scalar_one_or_none()
    if not ws:
        raise HTTPException(404, "Workspace not found")
    await db.delete(ws)
    await db.commit()


@router.get("/{workspace_id}/members", response_model=list[MemberOut])
async def list_members(
    workspace_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[MemberOut]:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.viewer)
    res = await db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id))
    return [MemberOut.model_validate(m) for m in res.scalars().all()]


@router.post("/{workspace_id}/members", response_model=MemberOut, status_code=201)
async def add_member(
    workspace_id: UUID,
    payload: MemberAdd,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.admin)
    target = await db.execute(select(User).where(User.id == payload.user_id))
    if not target.scalar_one_or_none():
        raise HTTPException(404, "User not found")
    existing = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == payload.user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Already a member")
    member = WorkspaceMember(workspace_id=workspace_id, user_id=payload.user_id, role=payload.role)
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return MemberOut.model_validate(member)


@router.delete("/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(
    workspace_id: UUID,
    user_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await assert_workspace_access(db, user, workspace_id, WorkspaceRole.admin)
    res = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    m = res.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Member not found")
    if m.role == WorkspaceRole.owner:
        raise HTTPException(400, "Cannot remove the owner")
    await db.delete(m)
    await db.commit()
