from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.integration import IntegrationProvider


class IntegrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    provider: IntegrationProvider
    account_login: str | None
    account_email: str | None
    avatar_url: str | None
    scope: str | None
    expires_at: datetime | None
    created_at: datetime


class OAuthStartResponse(BaseModel):
    authorize_url: str
    state: str


class GitHubRepo(BaseModel):
    id: int
    name: str
    full_name: str
    private: bool
    default_branch: str
    description: str | None
    html_url: str
    updated_at: str | None
    stargazers_count: int = 0
    language: str | None = None


class GitHubBranch(BaseModel):
    name: str
    sha: str
    protected: bool = False


class RepoImportRequest(BaseModel):
    repo_full_name: str
    branch: str | None = None
    project_id: UUID | None = None  # if omitted, a new project is created
    new_project_name: str | None = None
    workspace_id: UUID  # required to create a project if needed
    max_files: int = Field(default=400, ge=1, le=2000)


class RepoImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    project_id: UUID
    repo_full_name: str
    branch: str
    last_sha: str | None
    status: str
    files_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime


class CommitRequest(BaseModel):
    repo_full_name: str
    branch: str
    message: str
    files: list[dict] = Field(
        default_factory=list,
        description="[{path, content, encoding?: 'utf-8'|'base64'}]",
    )
    base_branch: str | None = None  # if branch doesn't exist, create from this


class CommitResult(BaseModel):
    commit_sha: str
    branch: str
    html_url: str | None = None
    files_committed: int


class BranchCreateRequest(BaseModel):
    repo_full_name: str
    name: str
    from_branch: str | None = None


class TokenLinkRequest(BaseModel):
    """For OAuth-less linking via personal access tokens (GitHub PAT)."""
    token: str
