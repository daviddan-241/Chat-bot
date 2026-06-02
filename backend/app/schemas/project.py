from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    metadata: dict = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    metadata: dict | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    name: str
    description: str | None
    project_metadata: dict = Field(serialization_alias="metadata")
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class FileCreate(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=512)
    content: str = ""
    mime_type: str = "text/plain"
    metadata: dict = Field(default_factory=dict)


class FileUpdate(BaseModel):
    path: str | None = None
    name: str | None = None
    content: str | None = None
    mime_type: str | None = None
    metadata: dict | None = None


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    path: str
    name: str
    content: str
    mime_type: str
    size_bytes: int
    file_metadata: dict = Field(serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime
