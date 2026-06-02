# Nova — AI Workspace Frontend

Production-grade Next.js 15 / React 19 frontend for the FastAPI **AI Workspace** backend. Streaming chat, live artifacts (Monaco editor + preview), versioned history, projects & files, and a true mobile layout.

## Stack

- **Next.js 15 (App Router)** + **React 19**
- **TypeScript** strict mode
- **Tailwind CSS** + custom glass design system
- **Zustand** for client state (auth, workspace, artifacts, files, UI, logs)
- **TanStack React Query** for server state
- **Framer Motion** for animations
- **Monaco Editor** for code editing
- **Radix UI primitives** wrapped in shadcn-style components
- **SSE** streaming via `fetch` + `ReadableStream` (matches backend `/ai/stream`)

## Features

### Chat
- Token-by-token streaming with a live caret indicator
- Optimistic user messages, server-canonical reconciliation
- Stop / regenerate / edit / copy
- Markdown + GFM + syntax-highlighted code (highlight.js) with per-block copy
- Image & file attachments (drag-drop, paste, upload) — embedded into the prompt
- Empty state with suggestion chips
- Inline title rename, delete chat, "new chat"

### Artifacts (right panel, auto-opens on stream)
- Live draft preview while the assistant streams a code/markdown/html/json block
- Auto-detects type from fenced code language and opens the panel
- Monaco editor with custom **nova-dark** theme; word-wrap, smooth caret
- Tabs: **Code / Preview / History**
  - HTML → sandboxed iframe preview
  - Markdown → rendered preview
  - JSON → collapsible tree viewer
- **Autosave** with debounced PATCH (creates a new version on the server)
- **Version history** with restore-as-new-version
- Save draft → first persisted artifact
- Copy / download / close

### Projects & Files
- Tree view (folders synthesized from `path`)
- Tabbed editor with dirty markers + per-tab autosave
- Create file (any nested path), delete, rename via path
- Language autodetected from extension

### Bottom panel
- Resizable (drag the splitter)
- **Logs** — every stream event, error, and tool invocation, color-coded
- **Tools** — live registry from `/tools` and a polling view of `/tools/logs`
- **Terminal** — sandboxed local toy shell

### Layout / Mobile
- Desktop: collapsible left sidebar + center chat + right artifact panel
- Tablet: artifact panel takes over center when open
- Mobile (≤ 768px): three swipeable views (**Menu / Chat / Artifact**) with iOS-style bottom navigation, `100dvh`, safe-area insets, badge dot when an artifact is fresh

### Auth
- Email/password register + login
- Access/refresh tokens persisted to `localStorage`
- Automatic refresh on 401, hard-redirect to `/login` on refresh failure
- Personal workspace auto-selected after login

## Run it

### 1. Start the backend
See `../backend/README.md`. Defaults expect it on `http://localhost:8000`.

### 2. Frontend
```bash
cd frontend
cp .env.example .env.local       # BACKEND_URL=http://localhost:8000
npm install --legacy-peer-deps
npm run dev                       # http://localhost:3000
```

Open <http://localhost:3000>. Register an account — a personal workspace is created automatically.

### Docker
```bash
docker build -t nova-frontend ./frontend
docker run -p 3000:3000 -e BACKEND_URL=http://host.docker.internal:8000 nova-frontend
```

## Architecture

```
frontend/
├── app/
│   ├── (app)/                    # Authenticated shell
│   │   ├── layout.tsx            # auth gate + workspace bootstrap + AppShell
│   │   ├── chat/[id]/page.tsx    # Chat with streaming
│   │   ├── projects/[id]/page.tsx# File tree + editor
│   │   ├── files/page.tsx
│   │   ├── artifacts/page.tsx
│   │   └── settings/page.tsx
│   ├── login/ register/          # Public
│   ├── layout.tsx                # Providers, viewport, metadata
│   └── globals.css               # Tailwind + design tokens
├── components/
│   ├── ui/                       # Button, Input, Tabs, Dialog, Tooltip, Dropdown, Toast, ...
│   ├── layout/                   # AppShell, Sidebar, MobileNav
│   ├── chat/                     # ChatView, ChatMessage, ChatComposer
│   ├── artifact/                 # ArtifactPanel, MonacoEditor
│   ├── files/                    # FileTree, FileEditor
│   ├── bottom-panel/             # Logs / Tools / Terminal
│   └── providers.tsx
├── lib/
│   ├── api.ts                    # All REST clients + 401 refresh
│   ├── stream.ts                 # SSE consumer for /ai/stream
│   ├── markdown.ts               # marked + highlight.js
│   ├── types.ts                  # Backend DTOs
│   └── utils.ts                  # cn, fmtTime, slugify, language detect
├── stores/                       # Zustand: auth, workspace, artifact, ui, file, log
├── hooks/                        # use-media-query, use-debounce
└── next.config.mjs               # /api/backend/* proxy → BACKEND_URL/*
```

### Backend connection layer
- All requests go through `/api/backend/*`, rewritten in `next.config.mjs` to `${BACKEND_URL}/*`. This solves CORS and lets you swap backends per-environment.
- Bearer token is attached automatically from `localStorage`.
- On `401`, the client transparently calls `/auth/refresh` once and retries.

### Streaming
`lib/stream.ts` uses `fetch` with `text/event-stream` and parses SSE frames manually (since `EventSource` doesn't support POST + headers). It emits typed events: `start | token | artifact | done | error`, which the chat view dispatches into Zustand stores:
- `token` → appends to the streaming assistant message
- `artifact` → sets `draft` on the artifact store, opens the right panel, switches mobile view
- `done` → invalidates React Query messages/artifacts caches and pulls the persisted artifact

### Artifact lifecycle
1. Assistant streams a fenced code block → backend emits `event: artifact`.
2. Frontend shows a **draft** in the right panel (Monaco + Preview).
3. On `event: done` the backend has persisted it; the panel switches to the real artifact.
4. Edits autosave every 700ms → `PATCH /artifacts/:id` → backend bumps `version` and writes `artifact_versions`.
5. **History** tab lists all versions; "Restore" creates a new top version (immutable history).

### Files lifecycle
- File tree built from flat `files[]` by splitting `path` on `/`.
- Opening a file fetches the full content, opens a tab, populates Monaco.
- Edits set `dirty` and autosave after 900ms via `PATCH /files/:id`.

## Backend endpoints used

| Endpoint | Where |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | `lib/api.ts` |
| `GET/POST /workspaces`, `GET /workspaces/:id` | sidebar switcher |
| `GET/POST /workspaces/:id/projects`, `GET/DELETE /projects/:id` | sidebar + projects page |
| `GET/POST /projects/:id/files`, `GET/PATCH/DELETE /files/:id` | file tree + editor |
| `GET/POST /chats`, `GET/PATCH/DELETE /chats/:id`, `GET/POST /chats/:id/messages` | chat view |
| `POST /ai/stream` (SSE) | streaming engine |
| `GET/POST /artifacts`, `GET/PATCH/DELETE /artifacts/:id`, `GET /artifacts/:id/versions[/:n]` | artifact panel |
| `GET /tools`, `GET /tools/logs` | bottom panel |

## Notes

- Sandboxed HTML preview uses `sandbox="allow-scripts allow-forms"` (no network from in-app preview, by design).
- All persisted artifact mutations are server-side; the UI is purely a controller.
- Tested with the matching backend's `mock` AI provider; works identically with `AI_PROVIDER=openai` + `AI_API_KEY` in the backend.
