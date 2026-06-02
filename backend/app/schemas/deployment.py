from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.deployment import DeploymentProvider, DeploymentStatus


class EnvVarCreate(BaseModel):
    key: str = Field(min_length=1, max_length=255, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    value: str
    environment: str = "production"
    secret: bool = True
    description: str | None = None


class EnvVarUpdate(BaseModel):
    value: str | None = None
    environment: str | None = None
    secret: bool | None = None
    description: str | None = None


class EnvVarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    key: str
    value: str  # masked unless ?reveal=1
    environment: str
    secret: bool
    description: str | None
    created_at: datetime
    updated_at: datetime


class DeploymentCreate(BaseModel):
    project_id: UUID
    provider: DeploymentProvider
    branch: str | None = None
    commit_sha: str | None = None
    repo_full_name: str | None = None  # for Vercel git-based deploys
    target: str | None = "production"  # vercel target


class DeploymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    project_id: UUID
    provider: DeploymentProvider
    provider_deployment_id: str | None
    status: DeploymentStatus
    url: str | None
    branch: str | None
    commit_sha: str | None
    created_at: datetime
    updated_at: datetime


class DeploymentLogs(BaseModel):
    deployment_id: UUID
    status: DeploymentStatus
    url: str | None
    logs: str
    updated_at: datetime
