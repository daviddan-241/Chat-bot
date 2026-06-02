from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserPreferencesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    theme: str
    default_model: str | None
    default_system_prompt: str | None
    preferences: dict
    updated_at: datetime


class UserPreferencesUpdate(BaseModel):
    theme: str | None = None
    default_model: str | None = None
    default_system_prompt: str | None = None
    preferences: dict | None = None


class ProjectMemoryCreate(BaseModel):
    key: str
    value: str
    importance: float = 0.5


class ProjectMemoryUpdate(BaseModel):
    value: str | None = None
    importance: float | None = None


class ProjectMemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    user_id: UUID
    key: str
    value: str
    importance: float
    created_at: datetime
    updated_at: datetime


class SemanticSearchQuery(BaseModel):
    query: str
    project_id: UUID | None = None
    limit: int = Field(default=8, ge=1, le=50)


class SemanticHit(BaseModel):
    scope: str
    ref_id: UUID
    project_id: UUID | None
    text: str
    score: float
