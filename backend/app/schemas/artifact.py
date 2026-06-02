from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.artifact import ArtifactType


class ArtifactCreate(BaseModel):
    workspace_id: UUID
    project_id: UUID | None = None
    title: str = "Untitled"
    type: ArtifactType
    language: str | None = None
    content: str
    metadata: dict = Field(default_factory=dict)


class ArtifactUpdate(BaseModel):
    title: str | None = None
    language: str | None = None
    content: str | None = None
    metadata: dict | None = None


class ArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    workspace_id: UUID
    project_id: UUID | None
    title: str
    type: ArtifactType
    language: str | None
    content: str
    artifact_metadata: dict = Field(serialization_alias="metadata")
    version: int
    created_at: datetime
    updated_at: datetime


class ArtifactVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    artifact_id: UUID
    version: int
    content: str
    version_metadata: dict = Field(serialization_alias="metadata")
    created_by: UUID | None
    created_at: datetime
