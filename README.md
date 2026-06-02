# Nova — AI Workspace

A production AI workspace platform: streaming chat, live artifacts, projects + files, GitHub sync, one-click deploys to Vercel/Railway, semantic memory, encrypted env vars, OAuth, and a full mobile-first UX.

> Think Claude.ai's polish meets Replit's developer surface — own your stack end-to-end.

[![Backend](https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white)](#backend) [![Frontend](https://img.shields.io/badge/frontend-Next.js%2015-black?logo=nextdotjs&logoColor=white)](#frontend) [![DB](https://img.shields.io/badge/db-PostgreSQL%2016-336791?logo=postgresql&logoColor=white)](#stack) [![License](https://img.shields.io/badge/license-MIT-green)](#license)

---

## ✨ Features

### Agents (19 built-in + custom)
- **Nova · Claude · GPT-4o · Gemini** — direct provider routing per agent
- **Specialists**: Code Sage · Code Reviewer · Debugger · Architect · DevOps · SQL Expert · Data Analyst · UI Designer · Writer · Researcher · QA Tester · Translator · Explain-Like-I'm-Five · Product Manager · Security Auditor
- Each agent ships with its own **system prompt, model, temperature, capabilities, and example prompts**
- **AgentPicker** in the chat header — switch mid-conversation, persisted to the chat
- Avatars + provider badges; warning chip when an agent's provider has no API key
- `/agents` gallery: search, filter (All / Built-in / Mine), one-click "Start chat"
- Build your own via `POST /agents` — same fields, scoped to your user

### Multi-provider AI
- **OpenAI** (GPT-4o, etc.) · **Anthropic** (Claude Sonnet 4.5) · **Google Gemini** · **Mock**
- Native SSE for each provider (Anthropic Messages API, Gemini `streamGenerateContent`, OpenAI Chat Completions)
- `provider="auto"` picks the first configured one
- Per-message override: `{ "agent_id": "...", "provider": "anthropic", "model": "..." }`

### Chat
- **Real-time SSE streaming** with token-by-token caret
- Optimistic user messages, server-canonical reconciliation
- Stop / regenerate / edit / per-code-block copy
- Markdown + GFM + syntax-highlighted code (highlight.js)
- Image & file attachments (drag-drop, paste, upload)
- `⏎` send · `⇧⏎` newline · `⌘⏎` force send · `⌘K` palette

### Artifact engine
- Auto-detects fenced code blocks in streaming responses
- Opens right panel automatically with **Monaco editor** + live preview
- Tabs: **Code · Preview · History**
  - HTML → sandboxed iframe
  - Markdown → rendered preview
  - JSON → collapsible tree
- **Autosave** with debounced `PATCH` — every change creates an immutable version
- Full **version history** with restore-as-new-version

### Projects & Files
- Tree view synthesized from flat paths
- Tabbed Monaco editor with dirty markers + per-tab autosave
- Language auto-detected from extension
- Direct GitHub commit/import

### 🔗 GitHub integration
- OAuth flow + personal-access-token fallback
- Browse all your repos with filter + language/star metadata
- **Import** a repo into a Nova project (concurrent blob download, text-only filter, size cap)
- **Commit** all files in a project to a branch as a single atomic commit
- **Branch management** (create from base SHA)

### 🚀 Deployment system
- **Vercel** — one-click deploy of project files with injected env vars; live status + logs polling
- **Railway** — service redeploy via GraphQL
- Per-deployment **logs panel** with refresh & build status pill
- Encrypted **env vars manager** per project (per-environment scoping, secret masking, reveal toggle)

### 🔐 Auth
- Email/password + JWT (access + refresh with rotation)
- **Google OAuth** sign-in & account linking
- **GitHub OAuth** account linking
- Session persistence via httpOnly-style localStorage with auto-refresh-once on 401

### 🧠 Memory system
- **User memory** — long-lived preferences/facts (key/value + importance)
- **Project memory** — facts scoped to a project the AI uses when working there
- **Semantic search** via hash-based 256-dim embeddings + cosine similarity
- Memory viewer UI with rebuild-embeddings button
- Auto-retrieval into prompts during streaming

### ⚡ Performance polish
- React Query: 60s stale-time, 5min gc, exponential retry backoff, no focus refetch
- Lazy-loaded Monaco editor (dynamic import, SSR off)
- Skeleton loaders everywhere
- Optimistic UI for chat messages, artifacts, env vars, memory
- SSE stream parser via `fetch` + `ReadableStream` (no polyfills)

### 🎨 UI polish
- Dark-first glass design, hairline borders, soft elevations
- Framer Motion micro-animations everywhere
- **Command palette** (⌘K) — fuzzy search chats/projects/artifacts/commands
- Keyboard shortcuts: ⌘K, ⌘⇧P (artifacts), ⌘B (sidebar), ⌘J (chat), ⌘/ (logs), ⌘,
- Consistent spacing/typography tokens via Tailwind theme

### 📱 Mobile / iOS (real PWA)
- **Installable PWA** with manifest, 192/512 maskable icons, Apple touch icon
- **Service worker** with network-first nav + cache-first static assets (never caches SSE/auth)
- `apple-mobile-web-app-capable` + black-translucent status bar
- **5-slot bottom navigation** (Menu · Chat · Agents · Files · Artifact) with active-tab indicator + haptic feedback (`navigator.vibrate`)
- **Swipe-to-navigate** between views (touch gestures)
- `100dvh`, safe-area insets, no overscroll bounce, no tap-highlight flash
- Tap-targets sized for thumbs; active-press scale animation

---

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI · SQLAlchemy 2.0 async · PostgreSQL 16 · Redis · Alembic |
| Frontend | Next.js 15 · React 19 · TypeScript · Tailwind · Zustand · React Query · Framer Motion · Monaco |
| Auth | JWT (access + refresh rotation) · Google OAuth · GitHub OAuth · session table |
| Integrations | GitHub REST API · Vercel REST · Railway GraphQL |
| Streaming | SSE (`/ai/stream`) + WebSocket (`/ws/ai`) |
| Encryption | Fernet (SECRET_KEY-derived) for tokens, env vars, refresh tokens |

---

## Quickstart (Docker)

```bash
git clone <this-repo>
cd <repo>
cp backend/.env.example backend/.env
docker compose up --build
```

- **Frontend** → http://localhost:3000
- **Backend** → http://localhost:8000 · docs at `/docs`
- **DB** → localhost:5432 · **Redis** → localhost:6379

Migrations run automatically on backend start. The AI provider defaults to a **deterministic mock streamer** so it works without any API key.

## Local dev (no Docker)

```bash
# Postgres + Redis somewhere
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_workspace -p 5432:5432 postgres:16-alpine
docker run -d --name rd -p 6379:6379 redis:7-alpine

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload     # :8000

# Frontend (new terminal)
cd frontend
npm install --legacy-peer-deps
cp .env.example .env.local
npm run dev                       # :3000
```

---

## Enabling integrations

Add these to `backend/.env`:

```env
# --- AI providers (set any/all; the UI shows which are live) ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# Default agent provider routing: 'auto' picks the first configured one above
AI_PROVIDER=auto

# --- GitHub OAuth (https://github.com/settings/developers) ---
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=http://localhost:8000/integrations/github/callback

# --- Google OAuth (https://console.cloud.google.com/apis/credentials) ---
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8000/oauth/google/callback

# --- Deployments ---
VERCEL_API_TOKEN=...           # https://vercel.com/account/tokens
VERCEL_TEAM_ID=                # optional
RAILWAY_API_TOKEN=...          # https://railway.app/account/tokens
```

Restart the backend. The Settings → Integrations / Deployments pages and the `/agents` gallery will light up.

---

## Architecture

```
.
├── backend/                      FastAPI service
│   ├── app/
│   │   ├── core/                 config, async db, redis, JWT, Fernet crypto
│   │   ├── models/               13 SQLAlchemy models (users, chats, artifacts,
│   │   │                         projects, files, memory, integrations,
│   │   │                         deployments, env_vars, embeddings, …)
│   │   ├── routers/              auth · workspaces · projects · chats · ai (SSE/WS)
│   │   │                         · artifacts · memory · tools · integrations
│   │   │                         · oauth_google · deployments · preferences · health
│   │   ├── services/             auth · ai_engine · artifact · memory · tool_registry
│   │   │                         · github · google · deployment · semantic
│   │   └── main.py
│   ├── alembic/                  0001_init + 0002_integrations migrations
│   └── Dockerfile
│
├── frontend/                     Next.js 15 / React 19 app
│   ├── app/                      App router
│   │   ├── (app)/                Auth-gated shell
│   │   │   ├── chat/[id]         Streaming chat
│   │   │   ├── projects/[id]     File tree + Monaco + GitHub commit
│   │   │   ├── files/            Project grid
│   │   │   ├── artifacts/        Artifact gallery
│   │   │   └── settings/         Account · integrations · deployments · memory
│   │   ├── auth/callback/        OAuth landing
│   │   └── login · register
│   ├── components/
│   │   ├── ui/                   shadcn-style primitives (no CLI)
│   │   ├── layout/               AppShell · Sidebar · MobileNav
│   │   ├── chat/                 ChatView · ChatMessage · ChatComposer
│   │   ├── artifact/             ArtifactPanel · MonacoEditor
│   │   ├── files/                FileTree · FileEditor · ProjectHeaderActions
│   │   ├── bottom-panel/         Logs · Tools · Terminal
│   │   ├── command-palette.tsx   ⌘K palette
│   │   └── global-hotkeys.tsx
│   ├── lib/                      api.ts · stream.ts · markdown.ts · types.ts
│   ├── stores/                   Zustand: auth · workspace · artifact · ui · file
│   │                             · log · command
│   ├── hooks/                    use-media-query · use-debounce · use-hotkeys
│   │                             · use-swipe-nav
│   └── next.config.mjs           /api/backend/* → BACKEND_URL/*
│
└── docker-compose.yml            db + redis + backend + frontend
```

---

## API surface (~85 operations)

| Group | Endpoints |
|---|---|
| Health | `GET /healthz` |
| Auth | `POST /auth/register · /auth/login · /auth/token · /auth/refresh · /auth/logout`, `GET /auth/me` |
| Workspaces | `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id`, `GET/POST/DELETE /workspaces/:id/members[...]` |
| Projects | `GET/POST /workspaces/:id/projects`, `GET/PATCH/DELETE /projects/:id` |
| Files | `GET/POST /projects/:id/files`, `GET/PATCH/DELETE /files/:id` |
| Chats | `GET/POST /chats`, `GET/PATCH/DELETE /chats/:id`, `GET/POST /chats/:id/messages` |
| AI | `POST /ai/stream` (SSE), `WS /ws/ai`, `POST /chat/stream` (alias) |
| Artifacts | `GET/POST /artifacts`, `GET/PATCH/DELETE /artifacts/:id`, `GET /artifacts/:id/versions[/:n]` |
| Memory | `GET/POST/PATCH/DELETE /memory/user[...]`, `GET /memory/user/retrieve`, `PUT/GET /memory/chat[...]` |
| Tools | `GET /tools`, `POST /tools/call`, `GET /tools/logs[/:id]` |
| Integrations | `GET/DELETE /integrations[/:provider]`, `GET /integrations/github/oauth/start`, `GET /integrations/github/callback`, `POST /integrations/github/link-token`, `GET /integrations/github/repos`, `GET /integrations/github/repos/:owner/:repo/branches`, `POST /integrations/github/branches`, `POST /integrations/github/import`, `GET /integrations/github/imports`, `POST /integrations/github/commit`, `POST /integrations/github/commit-project` |
| OAuth | `GET /oauth/google/start`, `GET /oauth/google/callback` |
| Deployments | `POST /deployments`, `GET /projects/:id/deployments`, `GET /deployments/:id`, `POST /deployments/:id/refresh`, `GET /deployments/:id/logs` |
| Env vars | `GET/POST /projects/:id/env`, `PATCH/DELETE /env/:id` |
| Preferences | `GET/PATCH /preferences` |
| Project memory | `GET/POST /projects/:id/memory`, `PATCH/DELETE /projects/memory/:id` |
| Semantic | `POST /memory/semantic`, `POST /memory/reindex`, `GET /memory/all` |

---

## Streaming events (SSE)

```
event: start    data: {"chat_id":"...","user_message_id":"..."}
event: token    data: {"delta":"..."}
event: artifact data: {"artifact":{"type":"code","language":"python","content":"..."}}
event: done     data: {"assistant_message_id":"...","artifact_id":"...","content":"...","usage":{...}}
event: error    data: {"error":"..."}
```

The WebSocket sends the same payloads as JSON frames keyed by `event`.

---

## Security notes

- All OAuth access tokens, refresh tokens, and env-var values are **encrypted at rest** with Fernet (key derived from `SECRET_KEY`).
- Env-var values are **masked** in the API response by default; pass `?reveal=true` (RBAC-gated) to see plaintext.
- Refresh token rotation with reuse detection (any mismatch revokes the session).
- All tool calls are **server-validated** (JSON-schema) and logged to `tool_execution_logs`.
- HTML artifact preview uses `<iframe sandbox="allow-scripts allow-forms">` — no network access.

## License

MIT
