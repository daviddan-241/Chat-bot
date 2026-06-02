"""Streaming AI engine. Supports OpenAI-compatible APIs and a built-in mock streamer.

Yields events of shape:
    {"type": "token", "delta": "..."}
    {"type": "artifact", "artifact": {...}}   # streamed metadata for artifact panel
    {"type": "done", "content": "<full>", "usage": {...}}
    {"type": "error", "error": "..."}
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncIterator

import httpx

from app.core.config import settings

CODE_FENCE_RE = re.compile(r"```(\w+)?\n([\s\S]*?)```")


def _detect_artifact(text: str) -> dict | None:
    """Detect a code/markdown/html/json artifact in a model response."""
    m = CODE_FENCE_RE.search(text)
    if not m:
        return None
    lang = (m.group(1) or "").lower().strip()
    content = m.group(2)
    if lang in ("html",):
        atype = "html"
    elif lang in ("json",):
        atype = "json"
    elif lang in ("md", "markdown"):
        atype = "markdown"
    elif lang == "":
        return None
    else:
        atype = "code"
    return {"type": atype, "language": lang or None, "content": content}


async def stream_openai(
    messages: list[dict], model: str | None = None
) -> AsyncIterator[dict]:
    model_name = model or settings.AI_MODEL
    headers = {"Authorization": f"Bearer {settings.AI_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": model_name, "messages": messages, "stream": True}
    url = f"{settings.AI_BASE_URL.rstrip('/')}/chat/completions"
    full = ""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="ignore")
                    yield {"type": "error", "error": f"upstream {resp.status_code}: {body[:500]}"}
                    return
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
                    delta = ((obj.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
                    if delta:
                        full += delta
                        yield {"type": "token", "delta": delta}
        artifact = _detect_artifact(full)
        if artifact:
            yield {"type": "artifact", "artifact": artifact}
        yield {"type": "done", "content": full, "usage": {}}
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "error": str(e)}


async def stream_mock(messages: list[dict], model: str | None = None) -> AsyncIterator[dict]:
    """Deterministic mock streamer so the system runs without external AI."""
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    intro = f"Here is a response to: \"{last_user[:80]}\"\n\n"
    body = (
        "I am a built-in mock assistant. Set `AI_PROVIDER=openai` and `AI_API_KEY` to use a real model.\n\n"
        "Below is a small code artifact you can capture:\n\n"
        "```python\n"
        "def greet(name: str) -> str:\n"
        "    return f\"Hello, {name}!\"\n\n"
        "print(greet(\"world\"))\n"
        "```\n"
    )
    full = ""
    for chunk in re.findall(r".{1,8}", intro + body, flags=re.S):
        full += chunk
        yield {"type": "token", "delta": chunk}
        await asyncio.sleep(0.01)
    artifact = _detect_artifact(full)
    if artifact:
        yield {"type": "artifact", "artifact": artifact}
    yield {"type": "done", "content": full, "usage": {"prompt_tokens": 0, "completion_tokens": len(full) // 4}}


def stream_ai(messages: list[dict], model: str | None = None) -> AsyncIterator[dict]:
    if settings.AI_PROVIDER == "openai" and settings.AI_API_KEY:
        return stream_openai(messages, model)
    return stream_mock(messages, model)
