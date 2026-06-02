export type UUID = string;

export interface User {
  id: UUID;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface Workspace {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  owner_id: UUID;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: UUID;
  workspace_id: UUID;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: UUID;
  project_id: UUID;
  path: string;
  name: string;
  content: string;
  mime_type: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Chat {
  id: UUID;
  workspace_id: UUID;
  project_id: UUID | null;
  user_id: UUID;
  title: string;
  model: string | null;
  system_prompt: string | null;
  agent_id: UUID | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: UUID;
  chat_id: UUID;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  artifact_id: UUID | null;
  parent_id: UUID | null;
  created_at: string;
}

export type ArtifactType = "code" | "markdown" | "html" | "json" | "text";

export interface Artifact {
  id: UUID;
  user_id: UUID;
  workspace_id: UUID;
  project_id: UUID | null;
  title: string;
  type: ArtifactType;
  language: string | null;
  content: string;
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: UUID;
  artifact_id: UUID;
  version: number;
  content: string;
  metadata: Record<string, unknown>;
  created_by: UUID | null;
  created_at: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolLog {
  id: UUID;
  tool_name: string;
  user_id: UUID;
  workspace_id: UUID | null;
  chat_id: UUID | null;
  message_id: UUID | null;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "pending" | "success" | "error" | "denied";
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export type IntegrationProvider = "github" | "google" | "vercel" | "railway";

export interface Integration {
  id: UUID;
  provider: IntegrationProvider;
  account_login: string | null;
  account_email: string | null;
  avatar_url: string | null;
  scope: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  updated_at: string | null;
  stargazers_count: number;
  language: string | null;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface RepoImport {
  id: UUID;
  user_id: UUID;
  project_id: UUID;
  repo_full_name: string;
  branch: string;
  last_sha: string | null;
  status: string;
  files_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommitResult {
  commit_sha: string;
  branch: string;
  html_url: string | null;
  files_committed: number;
}

export type DeploymentProvider = "vercel" | "railway";
export type DeploymentStatus = "pending" | "building" | "ready" | "error" | "canceled";

export interface Deployment {
  id: UUID;
  user_id: UUID;
  project_id: UUID;
  provider: DeploymentProvider;
  provider_deployment_id: string | null;
  status: DeploymentStatus;
  url: string | null;
  branch: string | null;
  commit_sha: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentLogs {
  deployment_id: UUID;
  status: DeploymentStatus;
  url: string | null;
  logs: string;
  updated_at: string;
}

export interface EnvVar {
  id: UUID;
  project_id: UUID;
  key: string;
  value: string;
  environment: string;
  secret: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: UUID;
  theme: string;
  default_model: string | null;
  default_system_prompt: string | null;
  preferences: Record<string, unknown>;
  updated_at: string;
}

export interface ProjectMemoryItem {
  id: UUID;
  project_id: UUID;
  user_id: UUID;
  key: string;
  value: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export interface UserMemoryItem {
  id: UUID;
  key: string;
  value: string;
  kind: string;
  importance: number;
  workspace_id: UUID | null;
  updated_at: string;
}

export interface SemanticHit {
  scope: "user" | "project";
  ref_id: UUID;
  project_id: UUID | null;
  text: string;
  score: number;
}

export interface Agent {
  id: UUID;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  provider: string;
  model: string | null;
  system_prompt: string;
  temperature: number;
  tools: unknown[];
  capabilities: string[];
  examples: string[];
  is_default: boolean;
  is_builtin: boolean;
  is_public: boolean;
  user_id: UUID | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  default_model: string | null;
}

/* SSE stream events */
export type StreamEvent =
  | { type: "start"; chat_id: string; user_message_id: string; agent_id?: string | null; agent_slug?: string | null; provider?: string; model?: string | null }
  | { type: "token"; delta: string }
  | { type: "artifact"; artifact: { type: ArtifactType; language: string | null; content: string; title?: string } }
  | { type: "done"; assistant_message_id: string; artifact_id: string | null; content: string; usage: Record<string, unknown> }
  | { type: "error"; error: string };
