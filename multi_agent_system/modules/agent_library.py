"""
NEXUS Module: Agent Library
━━━━━━━━━━━━━━━━━━━━━━━━━━
Indexes all 136+ agent .md files from the agents/ directory.
Each agent has a system prompt (the .md body) + frontmatter metadata.

Agents can be loaded as active system prompts for Ollama chat sessions,
or invoked directly via /api/agents/invoke.

Directory layout:
  agents/
    business-product/   → 12 agents
    core-development/   → 14 agents
    data-ai/            → 15 agents
    developer-experience/ → 8 agents
    infrastructure/     → 12 agents
    language-experts/   → 10 agents
    orchestration/      → 8 agents
    quality-assurance/  → 10 agents
    research-analysis/  → 8 agents
    specialized-domains/ → 39 agents
"""
from __future__ import annotations
import os, re
from typing import Optional

# Resolve agents/ from repo root (two levels up from this module file)
_HERE       = os.path.dirname(os.path.abspath(__file__))
_NEXUS_DIR  = os.path.dirname(_HERE)
_REPO_ROOT  = os.path.dirname(_NEXUS_DIR)
_AGENTS_DIR = os.path.join(_REPO_ROOT, "agents")

_CACHE: Optional[list] = None


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split YAML frontmatter and markdown body."""
    meta = {}
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            try:
                import yaml
                meta = yaml.safe_load(parts[1]) or {}
            except Exception:
                for line in parts[1].splitlines():
                    if ":" in line:
                        k, _, v = line.partition(":")
                        meta[k.strip()] = v.strip().strip('"')
            body = parts[2].strip()
    return meta, body


def _category_label(dir_name: str) -> str:
    return dir_name.replace("-", " ").title()


def load_all(force: bool = False) -> list[dict]:
    """Return list of all agents parsed from agents/**/*.md."""
    global _CACHE
    if _CACHE is not None and not force:
        return _CACHE
    agents = []
    if not os.path.isdir(_AGENTS_DIR):
        return agents
    for cat_dir in sorted(os.listdir(_AGENTS_DIR)):
        cat_path = os.path.join(_AGENTS_DIR, cat_dir)
        if not os.path.isdir(cat_path):
            continue
        category = _category_label(cat_dir)
        for fname in sorted(os.listdir(cat_path)):
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(cat_path, fname)
            try:
                with open(fpath, encoding="utf-8", errors="replace") as f:
                    raw = f.read()
                meta, body = _parse_frontmatter(raw)
                slug = fname[:-3]
                agents.append({
                    "id":          f"{cat_dir}/{slug}",
                    "slug":        slug,
                    "name":        meta.get("name", slug.replace("-", " ").title()),
                    "description": meta.get("description", body[:120].strip()),
                    "category":    category,
                    "category_id": cat_dir,
                    "model":       meta.get("model", "any"),
                    "tools":       meta.get("tools", []),
                    "path":        fpath,
                    "system_prompt": body,
                    "prompt_length": len(body),
                })
            except Exception:
                continue
    _CACHE = agents
    return agents


def get_agent(agent_id: str) -> Optional[dict]:
    """Get a single agent by id (e.g. 'core-development/backend-developer')."""
    for a in load_all():
        if a["id"] == agent_id or a["slug"] == agent_id:
            return a
    return None


def search_agents(query: str, category: str = "") -> list[dict]:
    """Full-text search across agent name + description + body."""
    q   = query.lower()
    cat = category.lower()
    results = []
    for a in load_all():
        if cat and cat not in a["category_id"].lower():
            continue
        score = 0
        if q in a["name"].lower():      score += 3
        if q in a["description"].lower(): score += 2
        if q in a["system_prompt"].lower(): score += 1
        if not q or score > 0:
            results.append((score, a))
    results.sort(key=lambda x: -x[0])
    return [a for _, a in results]


def get_categories() -> list[dict]:
    """Return list of agent categories with counts."""
    cats: dict[str, int] = {}
    for a in load_all():
        cats.setdefault(a["category"], 0)
        cats[a["category"]] += 1
    return [{"id": k.lower().replace(" ", "-"), "name": k, "count": v}
            for k, v in sorted(cats.items())]


def invoke_agent(agent_id: str, user_message: str,
                 model: str = "") -> dict:
    """
    Invoke an agent via Ollama, using its system prompt.
    Returns {ok, response, agent, model_used}.
    """
    agent = get_agent(agent_id)
    if not agent:
        return {"ok": False, "error": f"Agent not found: {agent_id}"}
    try:
        from agents.ollama_provider import chat, DEFAULT_MODEL, is_available
        if not is_available():
            return {"ok": False, "error": "Ollama not running — cannot invoke agent offline"}
        m = model or DEFAULT_MODEL
        messages = [{"role": "user", "content": user_message}]
        response = chat(messages, model=m, system=agent["system_prompt"])
        return {"ok": True, "agent": agent_id, "model_used": m,
                "response": response, "agent_name": agent["name"]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


TOOLS = {
    "agent_search":    search_agents,
    "agent_get":       get_agent,
    "agent_invoke":    invoke_agent,
    "agent_categories": get_categories,
    "agent_reload":    lambda: load_all(force=True),
}

def on_load():
    agents = load_all()
    print(f"[agent_library] {len(agents)} agents indexed across {len(get_categories())} categories")
