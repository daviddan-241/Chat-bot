"""Streaming providers: OpenAI, Anthropic (Messages API), Google Gemini, Mock.

All providers yield a uniform stream of dicts:
    {"type": "token", "delta": "..."}
    {"type": "done", "usage": {...}}
    {"type": "error", "error": "..."}

The wrapper in `ai_engine.py` adds artifact detection + persistence on top.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncIterator

import httpx

from app.core.config import settings


# ---------- OpenAI (and OpenAI-compatible) ----------
async def stream_openai(
    messages: list[dict], model: str | None = None, temperature: float = 0.7
) -> AsyncIterator[dict]:
    if not settings.OPENAI_API_KEY and not settings.AI_API_KEY:
        yield {"type": "error", "error": "OPENAI_API_KEY not configured"}
        return
    api_key = settings.OPENAI_API_KEY or settings.AI_API_KEY
    base = (settings.OPENAI_BASE_URL or settings.AI_BASE_URL).rstrip("/")
    mdl = model or settings.OPENAI_MODEL or settings.AI_MODEL
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": mdl, "messages": messages, "stream": True, "temperature": temperature}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
            async with client.stream("POST", f"{base}/chat/completions", json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="ignore")
                    yield {"type": "error", "error": f"openai {resp.status_code}: {body[:400]}"}
                    return
                usage: dict = {}
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if "usage" in obj and obj["usage"]:
                        usage = obj["usage"]
                    delta = ((obj.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
                    if delta:
                        yield {"type": "token", "delta": delta}
                yield {"type": "done", "usage": usage}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "error": str(e)}


# ---------- Anthropic (Messages API, native SSE) ----------
async def stream_anthropic(
    messages: list[dict], model: str | None = None, temperature: float = 0.7
) -> AsyncIterator[dict]:
    if not settings.ANTHROPIC_API_KEY:
        yield {"type": "error", "error": "ANTHROPIC_API_KEY not configured"}
        return
    mdl = model or settings.ANTHROPIC_MODEL
    # Anthropic separates the system prompt from messages
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    convo = [
        {"role": ("assistant" if m["role"] == "assistant" else "user"), "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
    if not convo:
        convo = [{"role": "user", "content": " "}]
    payload = {
        "model": mdl,
        "max_tokens": settings.ANTHROPIC_MAX_TOKENS,
        "system": "\n\n".join(system_parts) if system_parts else None,
        "messages": convo,
        "stream": True,
        "temperature": temperature,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    headers = {
        "x-api-key": settings.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
            async with client.stream(
                "POST", "https://api.anthropic.com/v1/messages", json=payload, headers=headers
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="ignore")
                    yield {"type": "error", "error": f"anthropic {resp.status_code}: {body[:400]}"}
                    return
                usage: dict = {}
                event_name = ""
                async for raw in resp.aiter_lines():
                    if not raw:
                        continue
                    if raw.startswith("event:"):
                        event_name = raw[6:].strip()
                        continue
                    if not raw.startswith("data:"):
                        continue
                    data = raw[5:].strip()
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    t = obj.get("type") or event_name
                    if t == "content_block_delta":
                        d = (obj.get("delta") or {})
                        text = d.get("text") or ""
                        if text:
                            yield {"type": "token", "delta": text}
                    elif t == "message_delta":
                        u = obj.get("usage") or {}
                        if u:
                            usage.update(u)
                    elif t == "message_stop":
                        break
                    elif t == "error":
                        msg = (obj.get("error") or {}).get("message") or "anthropic error"
                        yield {"type": "error", "error": msg}
                        return
                yield {"type": "done", "usage": usage}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "error": str(e)}


# ---------- Google Gemini (streamGenerateContent) ----------
async def stream_gemini(
    messages: list[dict], model: str | None = None, temperature: float = 0.7
) -> AsyncIterator[dict]:
    if not settings.GEMINI_API_KEY:
        yield {"type": "error", "error": "GEMINI_API_KEY not configured"}
        return
    mdl = model or settings.GEMINI_MODEL
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    contents = []
    for m in messages:
        if m.get("role") not in ("user", "assistant"):
            continue
        contents.append({
            "role": ("model" if m["role"] == "assistant" else "user"),
            "parts": [{"text": m["content"]}],
        })
    if not contents:
        contents = [{"role": "user", "parts": [{"text": " "}]}]
    payload = {
        "contents": contents,
        "generationConfig": {"temperature": temperature, "maxOutputTokens": 8192},
    }
    if system_parts:
        payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:streamGenerateContent"
        f"?alt=sse&key={settings.GEMINI_API_KEY}"
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
            async with client.stream(
                "POST", url, json=payload, headers={"content-type": "application/json"}
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="ignore")
                    yield {"type": "error", "error": f"gemini {resp.status_code}: {body[:400]}"}
                    return
                usage: dict = {}
                async for raw in resp.aiter_lines():
                    if not raw or not raw.startswith("data:"):
                        continue
                    data = raw[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    candidates = obj.get("candidates") or []
                    for c in candidates:
                        parts = (c.get("content") or {}).get("parts") or []
                        for p in parts:
                            text = p.get("text") or ""
                            if text:
                                yield {"type": "token", "delta": text}
                    um = obj.get("usageMetadata")
                    if um:
                        usage = um
                yield {"type": "done", "usage": usage}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "error": str(e)}


# ---------- Mock (deterministic, no API key) ----------
async def stream_mock(
    messages: list[dict], model: str | None = None, temperature: float = 0.7, persona: str = ""
) -> AsyncIterator[dict]:
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    sys_hint = next((m["content"] for m in messages if m.get("role") == "system"), "")
    persona_label = persona or (sys_hint[:60] + "..." if sys_hint else "general assistant")
    intro = (
        f"_(mock streamer — set an API key to use a real model)_\n\n"
        f"**Persona:** {persona_label}\n\n"
        f"Here's a response to: \"{last_user[:120]}\"\n\n"
    )
    body = (
        "I can stream code, markdown, JSON, and HTML — anything in a fenced block will "
        "auto-open in the artifact panel.\n\n"
        "```python\n"
        "def greet(name: str) -> str:\n"
        "    return f\"Hello, {name}!\"\n\n"
        "print(greet(\"world\"))\n"
        "```\n"
    )
    for chunk in re.findall(r".{1,10}", intro + body, flags=re.S):
        yield {"type": "token", "delta": chunk}
        await asyncio.sleep(0.012)
    yield {"type": "done", "usage": {"prompt_tokens": 0, "completion_tokens": len(intro + body) // 4}}


# ---------- Dispatcher ----------
def pick_provider(requested: str | None) -> str:
    """Resolve a provider name (or 'auto') to a concrete provider that is configured."""
    if requested and requested != "auto":
        return requested
    # auto: prefer in order of: anthropic > openai > gemini > mock
    if settings.ANTHROPIC_API_KEY:
        return "anthropic"
    if settings.OPENAI_API_KEY or settings.AI_API_KEY:
        return "openai"
    if settings.GEMINI_API_KEY:
        return "gemini"
    return "mock"


def stream_by_provider(
    provider: str,
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.7,
    persona: str = "",
) -> AsyncIterator[dict]:
    p = pick_provider(provider)
    if p == "openai":
        return stream_openai(messages, model, temperature)
    if p == "anthropic":
        return stream_anthropic(messages, model, temperature)
    if p == "gemini":
        return stream_gemini(messages, model, temperature)
    return stream_mock(messages, model, temperature, persona)


def configured_providers() -> list[dict]:
    """List which providers are usable based on env vars."""
    return [
        {"name": "openai", "configured": bool(settings.OPENAI_API_KEY or settings.AI_API_KEY),
         "default_model": settings.OPENAI_MODEL or settings.AI_MODEL},
        {"name": "anthropic", "configured": bool(settings.ANTHROPIC_API_KEY),
         "default_model": settings.ANTHROPIC_MODEL},
        {"name": "gemini", "configured": bool(settings.GEMINI_API_KEY),
         "default_model": settings.GEMINI_MODEL},
        {"name": "mock", "configured": True, "default_model": "mock-1"},
    ]
