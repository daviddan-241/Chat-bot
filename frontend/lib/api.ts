/**
 * API client — talks to the FastAPI backend through the Next.js rewrite proxy
 * (`/api/backend/*` -> BACKEND_URL/*). The token is read from localStorage and
 * attached as a Bearer header. 401s automatically attempt a refresh once.
 */
import type {
  Artifact,
  ArtifactType,
  ArtifactVersion,
  Chat,
  ChatMessage,
  CommitResult,
  Deployment,
  DeploymentLogs,
  DeploymentProvider,
  EnvVar,
  GitHubBranch,
  GitHubRepo,
  Integration,
  IntegrationProvider,
  Project,
  ProjectFile,
  ProjectMemoryItem,
  RepoImport,
  SemanticHit,
  TokenPair,
  ToolDescriptor,
  ToolLog,
  User,
  UserPreferences,
  Workspace,
} from "./types";

const BASE = "/api/backend";

const TOKEN_KEY = "aiw_access";
const REFRESH_KEY = "aiw_refresh";
const USER_KEY = "aiw_user";

export const auth = {
  get access(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(REFRESH_KEY);
  },
  get user(): User | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  },
  set(tokens: TokenPair) {
    localStorage.setItem(TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function rawRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = auth.access;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });

  if (res.status === 401 && retry && auth.refresh) {
    try {
      const refreshed = await rawRequest<TokenPair>(
        "/auth/refresh",
        { method: "POST", body: JSON.stringify({ refresh_token: auth.refresh }) },
        false,
      );
      auth.set(refreshed);
      return rawRequest<T>(path, init, false);
    } catch {
      auth.clear();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized");
    }
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJSON(text) : null;
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "detail" in (body as object)
        ? String((body as { detail: unknown }).detail)
        : res.statusText) || "Request failed";
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

function safeJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export { ApiError };

/* -------- Auth -------- */
export const authApi = {
  register: (email: string, password: string, full_name?: string) =>
    rawRequest<TokenPair>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name }),
    }),
  login: (email: string, password: string) =>
    rawRequest<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => rawRequest<User>("/auth/me"),
  logout: () => {
    const r = auth.refresh;
    auth.clear();
    if (r) return rawRequest<void>("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: r }) }).catch(() => undefined);
    return Promise.resolve();
  },
};

/* -------- Workspaces -------- */
export const workspacesApi = {
  list: () => rawRequest<Workspace[]>("/workspaces"),
  create: (name: string, slug: string, description?: string) =>
    rawRequest<Workspace>("/workspaces", { method: "POST", body: JSON.stringify({ name, slug, description }) }),
  get: (id: string) => rawRequest<Workspace>(`/workspaces/${id}`),
};

/* -------- Projects + Files -------- */
export const projectsApi = {
  list: (workspaceId: string) => rawRequest<Project[]>(`/workspaces/${workspaceId}/projects`),
  create: (workspaceId: string, name: string, description?: string) =>
    rawRequest<Project>(`/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  get: (id: string) => rawRequest<Project>(`/projects/${id}`),
  delete: (id: string) => rawRequest<void>(`/projects/${id}`, { method: "DELETE" }),
  listFiles: (id: string) => rawRequest<ProjectFile[]>(`/projects/${id}/files`),
  createFile: (id: string, payload: { path: string; name: string; content: string; mime_type?: string }) =>
    rawRequest<ProjectFile>(`/projects/${id}/files`, { method: "POST", body: JSON.stringify(payload) }),
};

export const filesApi = {
  get: (id: string) => rawRequest<ProjectFile>(`/files/${id}`),
  update: (id: string, payload: { content?: string; name?: string; mime_type?: string; path?: string }) =>
    rawRequest<ProjectFile>(`/files/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  delete: (id: string) => rawRequest<void>(`/files/${id}`, { method: "DELETE" }),
};

/* -------- Chats / Messages -------- */
export const chatsApi = {
  list: (workspaceId: string) => rawRequest<Chat[]>(`/chats?workspace_id=${workspaceId}`),
  create: (payload: {
    workspace_id: string;
    project_id?: string | null;
    title?: string;
    model?: string;
    system_prompt?: string;
  }) => rawRequest<Chat>("/chats", { method: "POST", body: JSON.stringify(payload) }),
  get: (id: string) => rawRequest<Chat>(`/chats/${id}`),
  update: (id: string, payload: Partial<Pick<Chat, "title" | "model" | "system_prompt">>) =>
    rawRequest<Chat>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  delete: (id: string) => rawRequest<void>(`/chats/${id}`, { method: "DELETE" }),
  messages: (id: string) => rawRequest<ChatMessage[]>(`/chats/${id}/messages`),
  addMessage: (id: string, content: string, role: "user" | "assistant" | "system" = "user") =>
    rawRequest<ChatMessage>(`/chats/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }),
};

/* -------- Artifacts -------- */
export const artifactsApi = {
  list: (workspaceId: string, projectId?: string) => {
    const qs = new URLSearchParams({ workspace_id: workspaceId });
    if (projectId) qs.set("project_id", projectId);
    return rawRequest<Artifact[]>(`/artifacts?${qs.toString()}`);
  },
  get: (id: string) => rawRequest<Artifact>(`/artifacts/${id}`),
  create: (payload: {
    workspace_id: string;
    project_id?: string | null;
    title: string;
    type: ArtifactType;
    language?: string | null;
    content: string;
  }) => rawRequest<Artifact>("/artifacts", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: { content?: string; title?: string; language?: string }) =>
    rawRequest<Artifact>(`/artifacts/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  delete: (id: string) => rawRequest<void>(`/artifacts/${id}`, { method: "DELETE" }),
  versions: (id: string) => rawRequest<ArtifactVersion[]>(`/artifacts/${id}/versions`),
  version: (id: string, v: number) => rawRequest<ArtifactVersion>(`/artifacts/${id}/versions/${v}`),
};

/* -------- Tools -------- */
/* -------- Integrations / GitHub -------- */
export const integrationsApi = {
  list: () => rawRequest<Integration[]>("/integrations"),
  disconnect: (provider: IntegrationProvider) =>
    rawRequest<void>(`/integrations/${provider}`, { method: "DELETE" }),
  githubStart: () => rawRequest<{ authorize_url: string; state: string }>("/integrations/github/oauth/start"),
  githubLinkToken: (token: string) =>
    rawRequest<Integration>("/integrations/github/link-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  githubRepos: (page = 1, per_page = 50) =>
    rawRequest<GitHubRepo[]>(`/integrations/github/repos?page=${page}&per_page=${per_page}`),
  githubBranches: (owner: string, repo: string) =>
    rawRequest<GitHubBranch[]>(`/integrations/github/repos/${owner}/${repo}/branches`),
  githubCreateBranch: (payload: { repo_full_name: string; name: string; from_branch?: string }) =>
    rawRequest<{ ok: boolean; branch: string; from_sha: string }>("/integrations/github/branches", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  githubImport: (payload: {
    repo_full_name: string;
    branch?: string;
    project_id?: string;
    new_project_name?: string;
    workspace_id: string;
    max_files?: number;
  }) =>
    rawRequest<RepoImport>("/integrations/github/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listImports: (projectId?: string) =>
    rawRequest<RepoImport[]>(`/integrations/github/imports${projectId ? `?project_id=${projectId}` : ""}`),
  githubCommit: (payload: {
    repo_full_name: string;
    branch: string;
    message: string;
    files: { path: string; content: string; encoding?: "utf-8" | "base64" }[];
    base_branch?: string;
  }) =>
    rawRequest<CommitResult>("/integrations/github/commit", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  githubCommitProject: (params: {
    project_id: string;
    repo_full_name: string;
    branch: string;
    message: string;
    base_branch?: string;
  }) => {
    const qs = new URLSearchParams({
      project_id: params.project_id,
      repo_full_name: params.repo_full_name,
      branch: params.branch,
      message: params.message,
    });
    if (params.base_branch) qs.set("base_branch", params.base_branch);
    return rawRequest<CommitResult>(`/integrations/github/commit-project?${qs.toString()}`, { method: "POST" });
  },
};

/* -------- Google OAuth -------- */
export const googleOAuthApi = {
  start: (intent: "signin" | "link" = "signin") =>
    rawRequest<{ authorize_url: string; state: string }>(`/oauth/google/start?intent=${intent}`),
};

/* -------- Deployments + Env vars -------- */
export const deploymentsApi = {
  listEnv: (projectId: string, reveal = false) =>
    rawRequest<EnvVar[]>(`/projects/${projectId}/env${reveal ? "?reveal=true" : ""}`),
  createEnv: (
    projectId: string,
    payload: { key: string; value: string; environment?: string; secret?: boolean; description?: string },
  ) =>
    rawRequest<EnvVar>(`/projects/${projectId}/env`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateEnv: (
    envId: string,
    payload: { value?: string; environment?: string; secret?: boolean; description?: string },
  ) =>
    rawRequest<EnvVar>(`/env/${envId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteEnv: (envId: string) => rawRequest<void>(`/env/${envId}`, { method: "DELETE" }),

  create: (payload: {
    project_id: string;
    provider: DeploymentProvider;
    branch?: string;
    commit_sha?: string;
    target?: string;
  }) => rawRequest<Deployment>("/deployments", { method: "POST", body: JSON.stringify(payload) }),
  list: (projectId: string) => rawRequest<Deployment[]>(`/projects/${projectId}/deployments`),
  get: (id: string) => rawRequest<Deployment>(`/deployments/${id}`),
  refresh: (id: string) => rawRequest<DeploymentLogs>(`/deployments/${id}/refresh`, { method: "POST" }),
  logs: (id: string) => rawRequest<DeploymentLogs>(`/deployments/${id}/logs`),
};

/* -------- Preferences + Project memory + Semantic memory -------- */
export const preferencesApi = {
  get: () => rawRequest<UserPreferences>("/preferences"),
  update: (payload: Partial<Pick<UserPreferences, "theme" | "default_model" | "default_system_prompt" | "preferences">>) =>
    rawRequest<UserPreferences>("/preferences", { method: "PATCH", body: JSON.stringify(payload) }),
};

export const projectMemoryApi = {
  list: (projectId: string) => rawRequest<ProjectMemoryItem[]>(`/projects/${projectId}/memory`),
  create: (projectId: string, payload: { key: string; value: string; importance?: number }) =>
    rawRequest<ProjectMemoryItem>(`/projects/${projectId}/memory`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (memoryId: string, payload: { value?: string; importance?: number }) =>
    rawRequest<ProjectMemoryItem>(`/projects/memory/${memoryId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  delete: (memoryId: string) => rawRequest<void>(`/projects/memory/${memoryId}`, { method: "DELETE" }),
};

export const semanticApi = {
  search: (payload: { query: string; project_id?: string; limit?: number }) =>
    rawRequest<SemanticHit[]>("/memory/semantic", { method: "POST", body: JSON.stringify(payload) }),
  reindex: () => rawRequest<{ reindexed: number }>("/memory/reindex", { method: "POST" }),
  all: () =>
    rawRequest<{
      user_memory: import("./types").UserMemoryItem[];
      project_memory: ProjectMemoryItem[];
      embedding_count: number;
    }>("/memory/all"),
};

export const toolsApi = {
  list: () => rawRequest<ToolDescriptor[]>("/tools"),
  call: (payload: { tool_name: string; arguments: Record<string, unknown>; chat_id?: string; workspace_id?: string }) =>
    rawRequest<{ status: string; result: Record<string, unknown>; error: string | null; duration_ms: number; log_id: string }>(
      "/tools/call",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  logs: (workspaceId?: string, chatId?: string) => {
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspace_id", workspaceId);
    if (chatId) qs.set("chat_id", chatId);
    return rawRequest<ToolLog[]>(`/tools/logs?${qs.toString()}`);
  },
};
