from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.tool import ToolStatus


class ToolCallRequest(BaseModel):
    tool_name: str
    arguments: dict = Field(default_factory=dict)
    workspace_id: UUID | None = None
    chat_id: UUID | None = None
    message_id: UUID | None = None


class ToolCallResult(BaseModel):
    status: ToolStatus
    result: dict
    error: str | None = None
    duration_ms: int = 0
    log_id: UUID


class ToolLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    tool_name: str
    user_id: UUID
    workspace_id: UUID | None
    chat_id: UUID | None
    message_id: UUID | None
    arguments: dict
    result: dict
    status: ToolStatus
    error: str | None
    duration_ms: int
    created_at: datetime


class ToolDescriptor(BaseModel):
    name: str
    description: str
    parameters: dict
