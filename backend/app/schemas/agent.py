from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AgentBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    icon: str = "Sparkles"
    color: str = "indigo"
    provider: str = "auto"
    model: str | None = None
    system_prompt: str = ""
    temperature: float = 0.7
    tools: list = []
    capabilities: list = []
    examples: list = []


class AgentCreate(AgentBase):
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-_]*$")


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    provider: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    tools: list | None = None
    capabilities: list | None = None
    examples: list | None = None


class AgentOut(AgentBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    is_default: bool
    is_builtin: bool
    is_public: bool
    user_id: UUID | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ProviderStatus(BaseModel):
    name: str
    configured: bool
    default_model: str | None
