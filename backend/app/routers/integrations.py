"""GitHub OAuth + repo listing + import + commits + branches."""
from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.integration import Integration, IntegrationProvider, RepoImport
from app.models.project import File, Project
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.schemas.integration import (
    BranchCreateRequest,
    CommitRequest,
    CommitResult,
    GitHubBranch,
    GitHubRepo,
    IntegrationOut,
    OAuthStartResponse,
    RepoImportOut,
    RepoImportRequest,
    TokenLinkRequest,
)
from app.services import github_service as gh
from app.services.deps import assert_workspace_access, get_current_user

router = APIRouter(prefix="/integrations", tags=["integrations"])


# ---------- list / delete connections ----------
@router.get("", response_model=list[IntegrationOut])
async def list_integrations(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(select(Integration).where(Integration.user_id == user.id))
    return [IntegrationOut.model_validate(i) for i in res.scalars().all()]


@router.delete("/{provider}", status_code=204)
async def disconnect(
    provider: IntegrationProvider,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Integration).where(Integration.user_id == user.id, Integration.provider == provider)
    )
    integ = res.scalar_one_or_none()
    if integ:
        await db.delete(integ)
        await db.commit()


# ---------- GitHub OAuth ----------
@router.get("/github/oauth/start", response_model=OAuthStartResponse)
async def github_start(user: User = Depends(get_current_user)):
    url, state = await gh.begin_oauth(str(user.id))
    return OAuthStartResponse(authorize_url=url, state=state)


@router.get("/github/callback")
async def github_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    integration, _ = await gh.complete_oauth(db, code, state)
    # Redirect back to the frontend integrations page with success flag
    fe = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(f"{fe}/settings/integrations?connected=github&login={integration.account_login or ''}")


@router.post("/github/link-token", response_model=IntegrationOut)
async def github_link_with_token(
    payload: TokenLinkRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    integ = await gh.link_with_token(db, user, payload.token)
    return IntegrationOut.model_validate(integ)


# ---------- GitHub data ----------
@router.get("/github/repos", response_model=list[GitHubRepo])
async def github_repos(
    page: int = 1,
    per_page: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = await gh.get_token(db, user)
    repos = await gh.list_repos(token, per_page=per_page, page=page)
    return [
        GitHubRepo(
            id=r["id"],
            name=r["name"],
            full_name=r["full_name"],
            private=r["private"],
            default_branch=r.get("default_branch") or "main",
            description=r.get("description"),
            html_url=r["html_url"],
            updated_at=r.get("updated_at"),
            stargazers_count=r.get("stargazers_count", 0),
            language=r.get("language"),
        )
        for r in repos
    ]


@router.get("/github/repos/{owner}/{repo}/branches", response_model=list[GitHubBranch])
async def github_branches(
    owner: str,
    repo: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = await gh.get_token(db, user)
    branches = await gh.list_branches(token, f"{owner}/{repo}")
    return [GitHubBranch(**b) for b in branches]


@router.post("/github/branches", status_code=201)
async def github_create_branch(
    payload: BranchCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = await gh.get_token(db, user)
    base = payload.from_branch or (await gh.get_repo(token, payload.repo_full_name)).get("default_branch", "main")
    base_sha = await gh.get_branch_sha(token, payload.repo_full_name, base)
    await gh.create_branch(token, payload.repo_full_name, payload.name, base_sha)
    return {"ok": True, "branch": payload.name, "from_sha": base_sha}


# ---------- Repo import ----------
TEXT_EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".md", ".html", ".css", ".scss",
    ".sass", ".yml", ".yaml", ".toml", ".sh", ".env", ".sql", ".rs", ".go", ".java",
    ".kt", ".rb", ".php", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".dart", ".lua",
    ".gitignore", ".prettierrc", ".eslintrc", "Dockerfile", "Makefile", "README",
}
MAX_FILE_BYTES = 256_000


def _looks_text(path: str) -> bool:
    lower = path.lower()
    if "/" in path:
        name = path.rsplit("/", 1)[-1]
    else:
        name = path
    if name in TEXT_EXTS:
        return True
    for ext in TEXT_EXTS:
        if lower.endswith(ext):
            return True
    return False


@router.post("/github/import", response_model=RepoImportOut)
async def github_import(
    payload: RepoImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await assert_workspace_access(db, user, payload.workspace_id, WorkspaceRole.member)
    token = await gh.get_token(db, user)

    # Resolve project (create if needed)
    project: Project | None = None
    if payload.project_id:
        res = await db.execute(select(Project).where(Project.id == payload.project_id))
        project = res.scalar_one_or_none()
        if not project:
            raise HTTPException(404, "Project not found")
    else:
        project = Project(
            workspace_id=payload.workspace_id,
            name=payload.new_project_name or payload.repo_full_name.split("/")[-1],
            description=f"Imported from github.com/{payload.repo_full_name}",
            project_metadata={"github_repo": payload.repo_full_name},
            created_by=user.id,
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)

    repo_info = await gh.get_repo(token, payload.repo_full_name)
    branch = payload.branch or repo_info.get("default_branch", "main")

    rec = RepoImport(
        user_id=user.id,
        project_id=project.id,
        repo_full_name=payload.repo_full_name,
        branch=branch,
        status="running",
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)

    try:
        head_sha = await gh.get_branch_sha(token, payload.repo_full_name, branch)
        tree = await gh.get_tree(token, payload.repo_full_name, head_sha)

        # Filter to text-y files within size budget
        blobs = [t for t in tree.get("tree", []) if t.get("type") == "blob" and _looks_text(t["path"])]
        blobs = [t for t in blobs if (t.get("size") or 0) <= MAX_FILE_BYTES]
        blobs = blobs[: payload.max_files]

        # Concurrent blob downloads (small concurrency to be nice to GH)
        sem = asyncio.Semaphore(8)
        results: list[tuple[str, str]] = []

        async def fetch_one(node: dict) -> None:
            async with sem:
                try:
                    data, _ = await gh.get_blob(token, payload.repo_full_name, node["sha"])
                    text = data.decode("utf-8", errors="replace")
                    results.append((node["path"], text))
                except Exception:
                    pass

        await asyncio.gather(*(fetch_one(b) for b in blobs))

        # Upsert files
        existing_res = await db.execute(select(File).where(File.project_id == project.id))
        existing = {f.path: f for f in existing_res.scalars().all()}
        for path, content in results:
            name = path.rsplit("/", 1)[-1]
            mime = "text/markdown" if path.endswith(".md") else "text/plain"
            if path in existing:
                f = existing[path]
                f.content = content
                f.name = name
                f.mime_type = mime
                f.size_bytes = len(content.encode("utf-8"))
            else:
                db.add(
                    File(
                        project_id=project.id,
                        path=path,
                        name=name,
                        content=content,
                        mime_type=mime,
                        size_bytes=len(content.encode("utf-8")),
                        created_by=user.id,
                        file_metadata={"source": "github", "repo": payload.repo_full_name, "sha": head_sha},
                    )
                )
        rec.last_sha = head_sha
        rec.files_count = len(results)
        rec.status = "ok"
        await db.commit()
        await db.refresh(rec)
    except HTTPException as e:
        rec.status = "error"
        rec.error = str(e.detail)
        await db.commit()
        raise
    except Exception as e:  # noqa: BLE001
        rec.status = "error"
        rec.error = str(e)
        await db.commit()
        raise HTTPException(500, str(e))

    return RepoImportOut.model_validate(rec)


@router.get("/github/imports", response_model=list[RepoImportOut])
async def list_imports(
    project_id: UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(RepoImport).where(RepoImport.user_id == user.id).order_by(RepoImport.created_at.desc())
    if project_id:
        stmt = stmt.where(RepoImport.project_id == project_id)
    res = await db.execute(stmt)
    return [RepoImportOut.model_validate(r) for r in res.scalars().all()]


# ---------- Commits ----------
@router.post("/github/commit", response_model=CommitResult)
async def github_commit(
    payload: CommitRequest = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.files:
        raise HTTPException(400, "No files to commit")
    token = await gh.get_token(db, user)
    result = await gh.commit_files(
        token,
        payload.repo_full_name,
        payload.branch,
        payload.message,
        payload.files,
        payload.base_branch,
    )
    return CommitResult(**result)


@router.post("/github/commit-project", response_model=CommitResult)
async def github_commit_project(
    project_id: UUID,
    repo_full_name: str,
    branch: str,
    message: str = "Update from Nova",
    base_branch: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Commit all files in a project to a GitHub branch as a single commit."""
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    await assert_workspace_access(db, user, project.workspace_id, WorkspaceRole.member)

    files_res = await db.execute(select(File).where(File.project_id == project.id))
    files = [{"path": f.path, "content": f.content, "encoding": "utf-8"} for f in files_res.scalars().all()]
    if not files:
        raise HTTPException(400, "Project has no files")

    token = await gh.get_token(db, user)
    result = await gh.commit_files(token, repo_full_name, branch, message, files, base_branch)
    return CommitResult(**result)
