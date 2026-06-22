# NEXUS Multi-Agent AI OS

> **Production security testing + local AI platform**  
> Free · Offline-capable (Ollama) · Online-capable · Open source

---

## What is NEXUS?

NEXUS is a self-hosted AI operating system built on Flask + PostgreSQL + Redis + Ollama.
It gives you a unified UI for running local LLMs, orchestrating security assessments,
analysing files, managing privacy routing via Tor, and collaborating in real-time —
all from a single browser tab.

**No cloud required. No subscriptions. No data leaves your machine unless you choose.**

---

## Quick Start

### Option A — Docker Compose (full stack, recommended)

```bash
git clone https://github.com/daviddan-241/Chat-bot
cd Chat-bot
docker compose up -d
```

Services started:
| Service       | URL                      | Purpose                          |
|---------------|--------------------------|----------------------------------|
| NEXUS UI      | http://localhost:5000/nexus | Main interface                |
| Open WebUI    | http://localhost:3000    | Ollama chat (alternative UI)     |
| Ollama        | http://localhost:11434   | Local LLM inference              |
| PostgreSQL    | localhost:5432           | Persistent storage               |
| Redis         | localhost:6379           | Cache + job queue                |
| Tor           | localhost:9050 (SOCKS5)  | Anonymous routing                |

### Option B — Local Python (minimal)

```bash
pip install -r requirements.txt
cd multi_agent_system
python main.py
# open http://localhost:5000/nexus
```

### Environment Variables

```env
# Database (optional — falls back to JSON files)
DATABASE_URL=postgresql://nexus:nexus@localhost:5432/nexus
REDIS_URL=redis://localhost:6379/0

# Ollama (optional — set if running on a different host)
OLLAMA_HOST=http://localhost:11434

# Tor (optional)
TOR_PROXY=socks5h://localhost:9050
TOR_CONTROL_HOST=localhost
TOR_CONTROL_PORT=9051
TOR_CONTROL_PASSWORD=
TOR_ROTATE_INTERVAL=300

# Push notifications (optional)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:you@example.com

# GitHub integration
GITHUB_PERSONAL_ACCESS_TOKEN=...
```

---

## Features

### 🤖 Local AI — Ollama
- Pull and manage models: Qwen 2.5, DeepSeek R1, Llama 3.2, Mistral, Phi-3, CodeLlama
- Streaming chat with any installed model
- Model delete / storage management
- OpenAI-compatible `/api/ollama/chat` endpoint

### 📚 Agent Library — 136 Specialised Agents
Every agent is a markdown file with a curated system prompt.
Load any agent as the active AI persona for your Ollama session.

| Category              | Agents | Examples                                     |
|-----------------------|--------|----------------------------------------------|
| Business & Product    | 12     | Product Manager, Legal Advisor, Growth Eng   |
| Core Development      | 14     | Backend Dev, API Designer, UI Designer       |
| Data & AI             | 15     | AI Engineer, MLOps, Data Scientist           |
| Developer Experience  | 8      | DevOps, CI/CD, Platform Eng                  |
| Infrastructure        | 12     | Kubernetes, Terraform, Cloud Architect       |
| Language Experts      | 10     | Rust, Go, Python, TypeScript                 |
| Orchestration         | 8      | Multi-agent systems, workflow engines        |
| Quality Assurance     | 10     | Test automation, performance, security QA   |
| Research & Analysis   | 8      | AutoResearch, data analysis, technical doc   |
| Specialised Domains   | 39     | Crypto, blockchain, embedded, game dev...   |

### ⚡ Auto Security Workflow
8-phase automated assessment (scope-gated):
1. **Discovery** — host/port scan via nmap
2. **Enumeration** — service version detection
3. **Vulnerability ID** — CVE matching, banner grabbing
4. **Validation** — confirm reachable attack surface
5. **SSL/TLS** — certificate and cipher analysis
6. **DNS** — zone, SPF, DMARC, DNSSEC checks
7. **Headers** — HTTP security header analysis
8. **Report** — structured findings output

All targets must be listed in `scope.txt`. Streaming NDJSON output.

### 🔬 File Analysis
- Magic bytes / file type detection (libmagic)
- Shannon entropy (>7.5 = packed/encrypted)
- MD5, SHA1, SHA256 hashes
- String extraction (min 4 chars, up to 500 results)
- Archive listing (ZIP, TAR, 7z, APK)
- Safe binary preview

### 🛡️ EDR Detection Validator
Run 6 safe telemetry test categories on your authorised lab system.
Check your EDR/SIEM console afterwards to identify detection gaps.

| Test               | Pattern                               |
|--------------------|---------------------------------------|
| Process Telemetry  | sh → python → perl ancestry chain     |
| Network Telemetry  | DNS + ICMP + HTTP to public resolvers |
| File Telemetry     | Create/exec/delete script in /tmp     |
| Command Obfuscation| base64-encoded command execution      |
| Memory Telemetry   | memfd_create fileless execution (Linux)|
| Jitter Simulation  | Randomised delay + UA spoofed beacon  |

### 🧅 Tor Manager
- New circuit on demand (SIGNAL NEWNYM via control port)
- Auto-rotate circuits (configurable interval, default 5 min)
- Verify current exit node IP + country
- DoH — DNS over HTTPS via Cloudflare, Quad9, or Google (no plaintext DNS)

### 🔒 Secure File Deletion
NIST SP 800-88 / DoD 5220.22-M compliant:
- Pass 1: cryptographically random data
- Pass 2: bit-complement of pass 1
- Pass 3: cryptographically random data
- Pass 4: zeros (fsync'd to disk)
- Generates GDPR Article 17 / HIPAA disposal JSON report

### ⏱️ Background Job Queue
- Submit any shell command as a background job
- Redis-backed persistence (RAM fallback)
- SSE output stream per job
- Offline command queue — execute on reconnect

### 💰 Crypto Wallet
- Litecoin (LTC) and Monero (XMR) address generation
- Balance checking via public APIs
- Transaction broadcast via Tor proxy
- Optional Tor routing for all wallet HTTP calls

### 🔗 Live Sessions
- 60-minute shared session links
- Role-based: recon / exploit / reporting
- Real-time SSE event bus — all participants see same output
- Revoke at any time

### 📋 Rules & Behavior Editor
- Edit AI system prompt (applies to all Ollama chats)
- Define command aliases (e.g. `/scan` → `nmap -sV -O -T4`)
- Manage default scope
- Export/import profiles as JSON

### 📱 Progressive Web App
- Install on iOS, Android, or desktop
- Offline capability via service worker
- Push notifications for job completion
- Offline command queue — syncs when back online

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  NEXUS UI (browser)              │
│  Flask /nexus  ←──SSE──→  WebSocket-compatible  │
└───────────────┬──────────────────────────────────┘
                │ REST + SSE
┌───────────────▼──────────────────────────────────┐
│           Flask App  (multi_agent_system/app.py) │
│                                                  │
│  Module Loader ──auto-loads──→ modules/*.py      │
│  Agent Library ──indexes──→  agents/**/*.md      │
│  Orchestrator  ──routes──→   350+ agent types   │
└──┬─────────┬──────────┬───────────────┬──────────┘
   │         │          │               │
   ▼         ▼          ▼               ▼
 Ollama  PostgreSQL  Redis          Tor (SOCKS5)
 :11434    :5432      :6379          :9050
```

### Module Auto-Loader
Modules in `multi_agent_system/modules/` are loaded at startup and reloaded every 3600s.
Each module exports a `TOOLS` dict and optional `on_load()` hook.

Currently loaded modules (18 tools total):
- `auto_workflow` — phased security assessment
- `edr_validator` — EDR telemetry testing
- `file_analyzer` — static file analysis
- `job_queue` — background job management
- `secure_delete` — NIST 800-88 file wipe
- `security_tools` — port scan, whois, DNS, HTTP headers
- `tor_manager` — Tor circuit + DoH

---

## API Reference

### Ollama
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/ollama/status`    | Availability + installed models |
| GET  | `/api/ollama/models`    | List installed models |
| POST | `/api/ollama/pull`      | Pull a model (streaming NDJSON) |
| POST | `/api/ollama/chat`      | Chat completion (streaming text) |
| DELETE | `/api/ollama/delete`  | Remove a model |

### Agents
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/agents/library`         | All 136 agents |
| GET  | `/api/agents/categories`      | Category list + counts |
| GET  | `/api/agents/library/<id>`    | Single agent detail |
| POST | `/api/agents/invoke`          | Run agent + return response |
| GET  | `/api/agents/search?q=...`    | Search agents |

### Security Workflow
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workflow/start`    | Start 8-phase assessment (streaming) |
| GET  | `/api/scope`             | Get current scope |
| POST | `/api/scope`             | Update scope.txt |

### EDR Validator
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/edr/run`        | Run single test by id |
| POST | `/api/edr/run-all`    | Run all 6 tests (streaming NDJSON) |

### Tor
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/tor/status`        | Circuit count + version |
| POST | `/api/tor/new-circuit`   | Request new identity |
| GET  | `/api/tor/exit-ip`       | Current exit node IP |
| POST | `/api/tor/start-rotate`  | Start auto-rotation |
| POST | `/api/tor/stop-rotate`   | Stop auto-rotation |
| POST | `/api/tor/doh`           | DNS over HTTPS lookup |

### File Analysis
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analysis`   | Analyse uploaded file (multipart) |

### Secure Delete
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/secure-delete`  | Wipe paths (NIST 800-88) |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/jobs`               | List jobs |
| POST | `/api/jobs`               | Submit job |
| GET  | `/api/jobs/<id>`          | Job status |
| DELETE | `/api/jobs/<id>`        | Cancel job |
| GET  | `/api/jobs/<id>/stream`   | SSE output stream |
| GET  | `/api/jobs/offline`       | Offline queue |
| POST | `/api/jobs/offline/flush` | Execute offline queue |

### Sessions
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/sessions`                   | List active sessions |
| POST | `/api/sessions`                   | Create session link |
| DELETE | `/api/sessions/<id>`            | Revoke session |
| GET  | `/api/sessions/<id>/events`       | SSE event stream |
| POST | `/api/sessions/<id>/publish`      | Broadcast event to session |

### Rules
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/rules`  | Get all rules |
| POST | `/api/rules`  | Update rules |

---

## Deployment

### Render (recommended)

```bash
# render.yaml is pre-configured
# Just connect your GitHub repo at render.com
```

### Manual VPS

```bash
# With Gunicorn + Nginx
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 multi_agent_system.app:app
```

---

## Adding a New Module

1. Create `multi_agent_system/modules/your_module.py`
2. Define `TOOLS = {"tool_name": function, ...}`
3. Optionally define `on_load()` for startup logging
4. The module auto-loader picks it up within 3600s (or restart)

---

## Legal & Ethics

- **Authorised testing only.** The security tools are for systems you own or have explicit written permission to test.
- **Scope enforcement.** Auto Workflow checks `scope.txt` before touching any target.
- **Data disposal.** Secure Delete generates disposal reports for GDPR/HIPAA compliance.
- **Privacy routing.** Tor integration is for legitimate privacy use.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
