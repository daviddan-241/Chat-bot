# AI Workspace — Backend Core

Production backend for an AI workspace platform: streaming chat, artifacts with version history, projects + files, memory, and a validated tool system.

**Stack:** FastAPI · async SQLAlchemy 2.0 · PostgreSQL · Alembic · Redis · SSE + WebSocket streaming.

---

## Features

- **Auth** — Email/password, bcrypt, JWT access + refresh tokens with session table & rotation
- **Workspaces & members** — roles: `owner | admin | member | viewer` (rank-checked on every protected route)
- **Projects + Files** — path-unique files per project, JSONB metadata, MIME tracking
- **Chats + Messages** — markdown content, JSONB metadata, role enum, parent-id threading, artifact linking
- **Artifacts (versioned)** — `code | markdown | html | json | text`; every content change creates an immutable `artifact_versions` row
- **Memory** — `user_memory` (preferences/facts) with importance scoring + keyword retrieval; `chat_memory` for rolling summaries
- **Streaming AI engine** — `POST /ai/stream` (SSE) and `WS /ws/ai`; persists user message → streams tokens → auto-detects fenced code → creates an artifact → persists assistant message → links it
- **Tool system** — registry with JSON-schema-validated args; every call logged to `tool_execution_logs`; built-in tools: `file.read`, `file.write`, `artifact.create`, `artifact.update`, `memory.store`, `memory.retrieve`
- **Redis** — session warm-up, partial stream buffer (resume-friendly)
- **Alembic** — single initial migration creates the full schema + enums + indexes

---

## Quickstart (Docker)

```bash
cd backend
cp .env.example .env            # tweak SECRET_KEY / AI_API_KEY
docker compose up --build
```

API: <http://localhost:8000> · Docs: <http://localhost:8000/docs> · Health: <http://localhost:8000/healthz>

Migrations run automatically on container start (`alembic upgrade head`).

## Quickstart (local Python)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Start Postgres + Redis (use docker compose if you like):
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_workspace -p 5432:5432 postgres:16-alpine
docker run -d --name rd -p 6379:6379 redis:7-alpine

alembic upgrade head
uvicorn app.main:app --reload
```

## End-to-end smoke test

After the server is up:

```bash
bash tests/smoke_test.sh
```

It registers a user, creates a project + file, opens a chat, streams an AI response, and lists artifacts.

---

## AI provider

By default `AI_PROVIDER=mock` returns a deterministic streamed response (with a code block that becomes an artifact) — so the system fully runs with **no API key required**.

To use a real OpenAI-compatible endpoint:

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1   # or any OpenAI-compatible URL
AI_MODEL=gpt-4o-mini
```

---

## API surface (selected)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create user, auto-create personal workspace, return tokens |
| POST | `/auth/login` | Email/password → tokens |
| POST | `/auth/token` | OAuth2 password form (Swagger Authorize) |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke session |
| GET  | `/auth/me` | Current user |
| GET/POST | `/workspaces` | List/create |
| GET/PATCH/DELETE | `/workspaces/{id}` | CRUD |
| GET/POST/DELETE | `/workspaces/{id}/members[...]` | Membership |
| GET/POST | `/workspaces/{id}/projects` | List/create projects |
| GET/PATCH/DELETE | `/projects/{id}` | CRUD |
| GET/POST | `/projects/{id}/files` | List/create files |
| GET/PATCH/DELETE | `/files/{id}` | CRUD |
| GET/POST | `/chats` | List (by `?workspace_id=`)/create |
| GET/PATCH/DELETE | `/chats/{id}` | CRUD |
| GET/POST | `/chats/{id}/messages` | List/append messages |
| POST | `/ai/stream` | **SSE** token stream (alias: `/chat/stream`) |
| WS   | `/ws/ai?token=...` | WebSocket token stream |
| GET/POST | `/artifacts` | List (by `?workspace_id=`)/create |
| GET/PATCH/DELETE | `/artifacts/{id}` | CRUD (PATCH bumps `version` and writes history) |
| GET | `/artifacts/{id}/versions[/{n}]` | Version history |
| GET/POST/PATCH/DELETE | `/memory/user[...]` | User memory CRUD |
| GET | `/memory/user/retrieve?query=...` | Keyword-ranked memory |
| PUT/GET | `/memory/chat[...]` | Chat memory upsert/fetch |
| GET | `/tools` | Tool registry (name, description, JSON schema) |
| POST | `/tools/call` | Execute a tool (server-validated, logged) |
| GET | `/tools/logs[/{id}]` | Execution audit log |
| GET | `/healthz` | DB + Redis health |

### Streaming events

SSE event types (`/ai/stream`):

```
event: start    data: {"chat_id": "...", "user_message_id": "..."}
event: token    data: {"delta": "..."}
event: artifact data: {"artifact": {"type":"code","language":"python","content":"..."}}
event: done     data: {"assistant_message_id":"...","artifact_id":"...","content":"...","usage":{...}}
event: error    data: {"error":"..."}
```

The WebSocket sends the same payloads as JSON frames keyed by `event`.

### Tool call example

```bash
curl -X POST http://localhost:8000/tools/call \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tool_name":"memory.store","arguments":{"key":"name","value":"Ada","importance":0.9}}'
```

---

## Project layout

```
backend/
├── app/
│   ├── core/           # config, db, redis, security
│   ├── models/         # SQLAlchemy ORM
│   ├── schemas/        # Pydantic v2
│   ├── routers/        # FastAPI routers (auth, workspaces, projects, chats, artifacts, memory, tools, ai, health)
│   ├── services/       # auth, AI engine, artifacts, memory, tool registry, deps
│   └── main.py
├── alembic/
│   ├── env.py
│   └── versions/0001_init.py
├── tests/smoke_test.sh
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Notes & production hardening

- Replace the naïve keyword memory ranker with embeddings (e.g. `pgvector`) for real semantic recall.
- Add rate limiting (e.g. `slowapi`) and structured logging.
- Use a managed Postgres + Redis in production; set strong `SECRET_KEY`.
- Tool registry is closed by default: only registered tools can run, and every call is validated and logged.
