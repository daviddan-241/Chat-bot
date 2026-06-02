"""Streaming AI engine with multi-provider support + artifact detection.

Yields events of shape:
    {"type": "token", "delta": "..."}
    {"type": "artifact", "artifact": {...}}
    {"type": "done", "content": "<full>", "usage": {...}}
    {"type": "error", "error": "..."}
"""
from __future__ import annotations

import re
from typing import AsyncIterator

from app.services.ai_providers import stream_by_provider

CODE_FENCE_RE = re.compile(r"```(\w+)?\n([\s\S]*?)```")


def _detect_artifact(text: str) -> dict | None:
    m = CODE_FENCE_RE.search(text)
    if not m:
        return None
    lang = (m.group(1) or "").lower().strip()
    content = m.group(2)
    if lang == "html":
        atype = "html"
    elif lang == "json":
        atype = "json"
    elif lang in ("md", "markdown"):
        atype = "markdown"
    elif lang == "":
        return None
    else:
        atype = "code"
    return {"type": atype, "language": lang or None, "content": content}


async def stream_ai(
    messages: list[dict],
    model: str | None = None,
    provider: str = "auto",
    temperature: float = 0.7,
    persona: str = "",
) -> AsyncIterator[dict]:
    """Top-level streaming wrapper. Adds artifact detection on top of provider stream."""
    full = ""
    artifact_yielded = False
    async for ev in stream_by_provider(provider, messages, model, temperature, persona):
        if ev["type"] == "token":
            full += ev["delta"]
            yield ev
            # Detect artifact as soon as we have a complete fenced block
            if not artifact_yielded:
                art = _detect_artifact(full)
                if art:
                    artifact_yielded = True
                    yield {"type": "artifact", "artifact": art}
        elif ev["type"] == "done":
            # Final attempt to detect artifact (handles streaming-mid-fence)
            if not artifact_yielded:
                art = _detect_artifact(full)
                if art:
                    yield {"type": "artifact", "artifact": art}
            yield {"type": "done", "content": full, "usage": ev.get("usage", {})}
        else:
            yield ev
