from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import MessageRole


class ChatCreate(BaseModel):
    workspace_id: UUID
    project_id: UUID | None = None
    title: str = "New Chat"
    model: str | None = None
    system_prompt: str | None = None
    agent_id: UUID | None = None
    metadata: dict = Field(default_factory=dict)


class ChatUpdate(BaseModel):
    title: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    agent_id: UUID | None = None
    metadata: dict | None = None


class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    workspace_id: UUID
    project_id: UUID | None
    user_id: UUID
    title: str
    model: str | None
    system_prompt: str | None
    agent_id: UUID | None
    chat_metadata: dict = Field(serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    role: MessageRole = MessageRole.user
    content: str
    metadata: dict = Field(default_factory=dict)
    artifact_id: UUID | None = None
    parent_id: UUID | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    chat_id: UUID
    role: MessageRole
    content: str
    message_metadata: dict = Field(serialization_alias="metadata")
    artifact_id: UUID | None
    parent_id: UUID | None
    created_at: datetime


class StreamRequest(BaseModel):
    chat_id: UUID
    content: str
    model: str | None = None
    system_prompt: str | None = None
    agent_id: UUID | None = None
    provider: str | None = None  # 'openai'|'anthropic'|'gemini'|'mock'|'auto'
    temperature: float | None = None
    include_memory: bool = True
    metadata: dict = Field(default_factory=dict)
