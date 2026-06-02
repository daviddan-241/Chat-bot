from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserMemoryCreate(BaseModel):
    key: str
    value: str
    kind: str = "preference"
    importance: float = 0.5
    workspace_id: UUID | None = None
    metadata: dict = Field(default_factory=dict)


class UserMemoryUpdate(BaseModel):
    value: str | None = None
    kind: str | None = None
    importance: float | None = None
    metadata: dict | None = None


class UserMemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: UUID
    workspace_id: UUID | None
    key: str
    value: str
    kind: str
    importance: float
    memory_metadata: dict = Field(serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime


class ChatMemoryUpsert(BaseModel):
    chat_id: UUID
    summary: str = ""
    salient_points: list = Field(default_factory=list)
    tokens: int = 0
    metadata: dict = Field(default_factory=dict)


class ChatMemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    chat_id: UUID
    summary: str
    salient_points: list
    tokens: int
    memory_metadata: dict = Field(serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime
