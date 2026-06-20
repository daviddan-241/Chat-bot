# NEXUS Orchestrator — 350+ Real Agent Engine

This package is the **brain** of NEXUS. It turns a single user goal into a
coordinated run across **360 real, distinct specialist agents**.

## What's real here (and what isn't)

- ✅ **360 genuinely distinct agents** — each is a real Python object with a
  unique role, hand-written system prompt, declared capabilities, preferred
  model tier and allowed tools. (See `registry.py`.)
- ✅ **Real parallel execution** — tasks run on a real `ThreadPoolExecutor`
  (up to 32 concurrent by default; raise `max_workers` to run more at once).
- ✅ **Real capability-based routing** — `_route()` matches each task to the
  best-fit specialist by capability/strength overlap.
- ✅ **Real collaboration** — agents share results through a per-project
  blackboard (isolated memory) so they "support each other".
- ✅ **Real LLM calls** — when you configure any OpenAI-compatible provider
  (your custom API, Grok/xAI, OpenAI, Replit), every agent calls a real model.
- ⚠️ **Not 360 separately-trained neural networks.** Nobody does that — not
  even frontier labs. Specialization is by prompt + capability + tooling, which
  is exactly how production agent systems scale to hundreds of workers.
- 🧪 **Demo mode** — with NO provider configured the engine still runs the full
  pipeline and returns clearly-labelled stubs, so the system is always testable.

## Files

| File | Purpose |
|------|---------|
| `registry.py` | Defines the 175 base specialists + scales to 360 parallel workers. |
| `llm.py` | Resolves model TIER → real model on whatever provider you configure. |
| `engine.py` | The scheduler: plan → route → parallel execute → integrate → verify. |
| `api.py` | Flask blueprint exposing the engine over REST + SSE. |

## Run lifecycle (the 6 phases)

1. **PLAN** — Chief Coordinator decomposes the goal into a JSON task graph.
2. **ROUTE** — each task is matched to the best specialist agent.
3. **EXECUTE** — tasks run in parallel, dependency-aware waves.
4. **COLLAB** — results land on the project blackboard for teammates to use.
5. **INTEGRATE** — Coordinator merges everything into one clean answer.
6. **VERIFY** — Final Verifier scans for placeholders/errors before returning.

## Going live (make agents call real models)

Set any of these env vars (or save them via Settings → API Keys), then call
`POST /api/orchestrator/refresh-llm`:

```bash
# Your custom model API (highest priority)
export CUSTOM_API_BASE_URL="https://your-api/v1"
export CUSTOM_API_KEY="sk-..."
export CUSTOM_MODEL_FRONTIER="your-best-model"
export CUSTOM_MODEL_BALANCED="your-mid-model"
export CUSTOM_MODEL_FAST="your-fast-model"

# OR Grok / xAI
export XAI_API_KEY="xai-..."

# OR OpenAI
export OPENAI_API_KEY="sk-..."
```

Your custom **Kali Linux** box is already wired in `coordinator_agent.py`
(`KALI_API_URL` / `KALI_API_KEY`) and used by the Security domain agents
(`kali_exec` tool).

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/orchestrator/summary` | catalog counts + LLM status |
| GET | `/api/orchestrator/fleet` | all agents + live status |
| GET | `/api/orchestrator/domains` | agents grouped by domain (dashboard grid) |
| GET | `/api/orchestrator/llm` | live provider status |
| POST | `/api/orchestrator/refresh-llm` | re-read keys after Settings change |
| POST | `/api/orchestrator/run` | `{goal, project_id}` → SSE event stream |

### SSE event types from `/run`

`status` · `plan` · `route` · `agent` · `final` · `error` · `done`
