"""
NEXUS LLM ROUTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Resolves an abstract model TIER (frontier/balanced/fast/vision/image/video) to a
REAL model on whatever provider the user has configured, and performs the call.

Supports, in priority order, anything OpenAI-compatible:
  • User custom API        (CUSTOM_API_BASE_URL / CUSTOM_API_KEY)
  • Groq                   (GROQ_API_KEY)          — fast, generous free tier
  • OpenAI                 (OPENAI_API_KEY)
  • OpenRouter             (OPENROUTER_API_KEY)     — 300+ models, free tier
  • HuggingFace            (HF_TOKEN)               — free inference
  • Cerebras               (CEREBRAS_API_KEY)       — ultra-fast, free tier
  • SambaNova              (SAMBANOVA_API_KEY)       — fast, free
  • Together.ai            (TOGETHER_API_KEY)        — many free models
  • Mistral                (MISTRAL_API_KEY)         — free tier
  • Google Gemini          (GEMINI_API_KEY)          — free 60 RPM
  • Fireworks.ai           (FIREWORKS_API_KEY)       — fast, cheap/free
  • Novita.ai              (NOVITA_API_KEY)          — free credits
  • Cohere                 (COHERE_API_KEY)          — free tier
  • xAI / Grok             (XAI_API_KEY)
  • DeepSeek               (DEEPSEEK_API_KEY)
  • GitHub Models          (GITHUB_PERSONAL_ACCESS_TOKEN) — free with GitHub
  • Replit AI integration  (AI_INTEGRATIONS_OPENAI_*)     — free on Replit
  • Pollinations.ai        — ZERO CONFIG, no key, always available last resort

If NO provider is configured, Pollinations.ai handles everything for free.
"""

from __future__ import annotations
import json
import os
import threading
from typing import Dict, Any, List, Optional, Generator

from .registry import (TIER_FRONTIER, TIER_BALANCED, TIER_FAST,
                       TIER_VISION, TIER_IMAGE, TIER_VIDEO, TIER_SHELL)

# Import the OpenAI SDK ONCE at module load (not lazily inside functions, which
# caused "cannot import name 'SyncAPIResource' from partially initialized module"
# when agent threads triggered the import concurrently during startup).
try:
    from openai import OpenAI as _OpenAI
    _OPENAI_IMPORT_ERROR = None
except Exception as _e:  # pragma: no cover
    _OpenAI = None
    _OPENAI_IMPORT_ERROR = str(_e)

_CLIENT_CACHE: Dict[str, Any] = {}
_CLIENT_LOCK = threading.Lock()


def get_client(api_key: str, base_url: str, timeout: float = 60.0):
    """Thread-safe, cached OpenAI-compatible client. Raises a clear error if the
    SDK failed to import at startup."""
    if _OpenAI is None:
        raise RuntimeError(f"openai SDK not available: {_OPENAI_IMPORT_ERROR}")
    key = f"{base_url}|{api_key[:8]}|{timeout}"
    with _CLIENT_LOCK:
        c = _CLIENT_CACHE.get(key)
        if c is None:
            c = _OpenAI(api_key=api_key, base_url=base_url,
                        timeout=timeout, max_retries=1)
            _CLIENT_CACHE[key] = c
        return c


class LLMError(Exception):
    """Raised when a configured provider call fails (so the UI can show it)."""


import re as _re
# Strip the upstream gateway's hardcoded persona tags so replies stay clean.
_PERSONA_RE = _re.compile(
    r"^\s*(\[?\s*(AGENT|WORMGPT|DAN|JAILBREAK|SYSTEM)\s*\]?\s*)+"
    r"(:|-)?\s*", _re.IGNORECASE)
_PERSONA_PHRASE_RE = _re.compile(
    r"^\s*((WormGPT|DAN mode)\s+)?activated[.,]?\s*(No restrictions( in effect)?[.,]?\s*)?",
    _re.IGNORECASE)


def _strip_persona(text: str) -> str:
    if not text:
        return text
    t = text
    # phrase first (handles 'WormGPT activated. No restrictions.'), then leading
    # tags; loop a few times to peel stacked prefixes.
    for _ in range(4):
        new = _PERSONA_PHRASE_RE.sub("", t)
        new = _PERSONA_RE.sub("", new)
        if new == t:
            break
        t = new
    return t.lstrip()


def _short_error(provider: str, e: Exception) -> str:
    """Turn a noisy provider exception into a short, friendly one line."""
    msg = str(e)
    low = msg.lower()
    if "401" in msg or "incorrect api key" in low or "invalid api key" in low \
            or "authentication" in low or "unauthorized" in low:
        return f"{provider}: invalid API key — check it in Settings."
    if "429" in msg or "rate limit" in low or "quota" in low:
        return f"{provider}: rate limited or out of quota — try again shortly."
    if "model" in low and ("not found" in low or "does not exist" in low):
        return f"{provider}: model name not found — fix the model in Settings."
    if "timeout" in low or "timed out" in low:
        return f"{provider}: request timed out — endpoint may be slow/down."
    if "connection" in low or "connect" in low or "resolve" in low:
        return f"{provider}: cannot reach the API — check the base URL."
    if "404" in msg:
        return f"{provider}: endpoint not found — base URL should end in /v1."
    # generic: keep it to ~90 chars, no JSON noise
    clean = msg.split("{")[0].split(" - ")[0].strip()[:90]
    return f"{provider}: {clean or 'request failed'}"


# ─────────────────────────────────────────────────────────────────────────────
class Provider:
    """One OpenAI-compatible endpoint with a tier->model map."""
    def __init__(self, name: str, base_url: str, api_key: str,
                 tier_map: Dict[str, str]):
        self.name = name
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.api_key = api_key
        self.tier_map = tier_map

    def available(self) -> bool:
        return bool(self.api_key)

    def model_for(self, tier: str) -> Optional[str]:
        return self.tier_map.get(tier) or self.tier_map.get(TIER_BALANCED)


def _env(*names: str, default: str = "") -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return default


def discover_providers() -> List[Provider]:
    """Build the provider FALLBACK CHAIN in the user's requested priority:
    Groq → OpenAI → OpenRouter → HuggingFace → custom → DeepSeek (+grok/replit).
    The router tries each in order; if one rate-limits/fails it cascades to the next."""
    providers: List[Provider] = []

    # 1) GROQ (first — fast & free). keys: gsk_
    groq_key = _env("GROQ_API_KEY")
    if groq_key:
        providers.append(Provider("groq", "https://api.groq.com/openai/v1", groq_key, {
            TIER_FRONTIER: _env("GROQ_MODEL_FRONTIER", default="llama-3.3-70b-versatile"),
            TIER_BALANCED: _env("GROQ_MODEL_BALANCED", default="llama-3.3-70b-versatile"),
            TIER_FAST:     _env("GROQ_MODEL_FAST", default="llama-3.1-8b-instant"),
            TIER_VISION:   _env("GROQ_MODEL_VISION", default="meta-llama/llama-4-scout-17b-16e-instruct"),
        }))

    # 2) OPENAI
    oai_key = _env("OPENAI_API_KEY")
    if oai_key:
        providers.append(Provider("openai", "https://api.openai.com/v1", oai_key, {
            TIER_FRONTIER: _env("OPENAI_MODEL_FRONTIER", default="gpt-4o"),
            TIER_BALANCED: "gpt-4o",
            TIER_FAST:     "gpt-4o-mini",
            TIER_VISION:   "gpt-4o",
        }))

    # 3) OPENROUTER (huge model catalog). keys: sk-or-...
    or_key = _env("OPENROUTER_API_KEY")
    if or_key:
        providers.append(Provider("openrouter", "https://openrouter.ai/api/v1", or_key, {
            TIER_FRONTIER: _env("OPENROUTER_MODEL_FRONTIER", default="anthropic/claude-3.5-sonnet"),
            TIER_BALANCED: _env("OPENROUTER_MODEL_BALANCED", default="anthropic/claude-3.5-sonnet"),
            TIER_FAST:     _env("OPENROUTER_MODEL_FAST", default="meta-llama/llama-3.3-70b-instruct"),
            TIER_VISION:   _env("OPENROUTER_MODEL_VISION", default="openai/gpt-4o"),
        }))

    # 4) HUGGINGFACE (router, OpenAI-compatible). keys: hf_...
    hf_key = _env("HF_TOKEN", "HUGGINGFACE_TOKEN")
    if hf_key:
        providers.append(Provider("huggingface", "https://router.huggingface.co/v1", hf_key, {
            TIER_FRONTIER: _env("HF_MODEL_FRONTIER", default="meta-llama/Llama-3.3-70B-Instruct"),
            TIER_BALANCED: _env("HF_MODEL_BALANCED", default="meta-llama/Llama-3.3-70B-Instruct"),
            TIER_FAST:     _env("HF_MODEL_FAST", default="meta-llama/Llama-3.1-8B-Instruct"),
            TIER_VISION:   _env("HF_MODEL_VISION", default="meta-llama/Llama-3.2-11B-Vision-Instruct"),
        }))

    # 5) CUSTOM gateway
    custom_key = _env("CUSTOM_API_KEY", "NEXUS_CUSTOM_API_KEY")
    custom_base = _env("CUSTOM_API_BASE_URL", "NEXUS_CUSTOM_BASE_URL")
    if custom_key and custom_base:
        providers.append(Provider("custom", custom_base, custom_key, {
            TIER_FRONTIER: _env("CUSTOM_MODEL_FRONTIER", default="llama-3.3-70b-versatile"),
            TIER_BALANCED: _env("CUSTOM_MODEL_BALANCED", default="llama-3.3-70b-versatile"),
            TIER_FAST:     _env("CUSTOM_MODEL_FAST", default="llama-3.1-8b-instant"),
            TIER_VISION:   _env("CUSTOM_MODEL_VISION", default="llama-3.3-70b-versatile"),
        }))

    # 7) CEREBRAS — ultra-fast inference, generous free tier (cerebras.ai)
    cerebras_key = _env("CEREBRAS_API_KEY")
    if cerebras_key:
        providers.append(Provider("cerebras", "https://api.cerebras.ai/v1", cerebras_key, {
            TIER_FRONTIER: _env("CEREBRAS_MODEL_FRONTIER", default="llama-3.3-70b"),
            TIER_BALANCED: _env("CEREBRAS_MODEL_BALANCED", default="llama-3.3-70b"),
            TIER_FAST:     _env("CEREBRAS_MODEL_FAST", default="llama-3.1-8b"),
            TIER_VISION:   _env("CEREBRAS_MODEL_VISION", default="llama-3.3-70b"),
        }))

    # 8) SAMBANOVA — fast, free tier (sambanova.ai)
    sn_key = _env("SAMBANOVA_API_KEY")
    if sn_key:
        providers.append(Provider("sambanova", "https://api.sambanova.ai/v1", sn_key, {
            TIER_FRONTIER: _env("SAMBANOVA_MODEL_FRONTIER", default="Meta-Llama-3.3-70B-Instruct"),
            TIER_BALANCED: _env("SAMBANOVA_MODEL_BALANCED", default="Meta-Llama-3.3-70B-Instruct"),
            TIER_FAST:     _env("SAMBANOVA_MODEL_FAST", default="Meta-Llama-3.1-8B-Instruct"),
            TIER_VISION:   _env("SAMBANOVA_MODEL_VISION", default="Llama-4-Scout-17B-16E-Instruct"),
        }))

    # 9) TOGETHER.AI — large free model catalog (together.ai)
    together_key = _env("TOGETHER_API_KEY")
    if together_key:
        providers.append(Provider("together", "https://api.together.xyz/v1", together_key, {
            TIER_FRONTIER: _env("TOGETHER_MODEL_FRONTIER", default="meta-llama/Llama-3.3-70B-Instruct-Turbo"),
            TIER_BALANCED: _env("TOGETHER_MODEL_BALANCED", default="meta-llama/Llama-3.3-70B-Instruct-Turbo"),
            TIER_FAST:     _env("TOGETHER_MODEL_FAST", default="meta-llama/Llama-3.1-8B-Instruct-Turbo"),
            TIER_VISION:   _env("TOGETHER_MODEL_VISION", default="meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo"),
        }))

    # 10) MISTRAL — free tier available (mistral.ai)
    mistral_key = _env("MISTRAL_API_KEY")
    if mistral_key:
        providers.append(Provider("mistral", "https://api.mistral.ai/v1", mistral_key, {
            TIER_FRONTIER: _env("MISTRAL_MODEL_FRONTIER", default="mistral-large-latest"),
            TIER_BALANCED: _env("MISTRAL_MODEL_BALANCED", default="mistral-small-latest"),
            TIER_FAST:     _env("MISTRAL_MODEL_FAST", default="mistral-small-latest"),
            TIER_VISION:   _env("MISTRAL_MODEL_VISION", default="pixtral-12b-2409"),
        }))

    # 11) GOOGLE GEMINI — free 60 RPM, OpenAI-compatible (aistudio.google.com)
    gemini_key = _env("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if gemini_key:
        providers.append(Provider("gemini",
            "https://generativelanguage.googleapis.com/v1beta/openai/", gemini_key, {
            TIER_FRONTIER: _env("GEMINI_MODEL_FRONTIER", default="gemini-2.0-flash"),
            TIER_BALANCED: _env("GEMINI_MODEL_BALANCED", default="gemini-2.0-flash"),
            TIER_FAST:     _env("GEMINI_MODEL_FAST", default="gemini-2.0-flash-lite"),
            TIER_VISION:   _env("GEMINI_MODEL_VISION", default="gemini-2.0-flash"),
        }))

    # 12) FIREWORKS.AI — fast inference, free credits (fireworks.ai)
    fw_key = _env("FIREWORKS_API_KEY")
    if fw_key:
        providers.append(Provider("fireworks", "https://api.fireworks.ai/inference/v1", fw_key, {
            TIER_FRONTIER: _env("FIREWORKS_MODEL_FRONTIER", default="accounts/fireworks/models/llama-v3p3-70b-instruct"),
            TIER_BALANCED: _env("FIREWORKS_MODEL_BALANCED", default="accounts/fireworks/models/llama-v3p3-70b-instruct"),
            TIER_FAST:     _env("FIREWORKS_MODEL_FAST", default="accounts/fireworks/models/llama-v3p1-8b-instruct"),
            TIER_VISION:   _env("FIREWORKS_MODEL_VISION", default="accounts/fireworks/models/llama-v3p2-11b-vision-instruct"),
        }))

    # 13) NOVITA.AI — free credits on signup (novita.ai)
    novita_key = _env("NOVITA_API_KEY")
    if novita_key:
        providers.append(Provider("novita", "https://api.novita.ai/v3/openai", novita_key, {
            TIER_FRONTIER: _env("NOVITA_MODEL_FRONTIER", default="meta-llama/llama-3.3-70b-instruct"),
            TIER_BALANCED: _env("NOVITA_MODEL_BALANCED", default="meta-llama/llama-3.3-70b-instruct"),
            TIER_FAST:     _env("NOVITA_MODEL_FAST", default="meta-llama/llama-3.1-8b-instruct"),
            TIER_VISION:   _env("NOVITA_MODEL_VISION", default="meta-llama/llama-3.2-11b-vision-instruct"),
        }))

    # 14) COHERE — free tier (cohere.com)
    cohere_key = _env("COHERE_API_KEY")
    if cohere_key:
        providers.append(Provider("cohere", "https://api.cohere.ai/compatibility/v1", cohere_key, {
            TIER_FRONTIER: _env("COHERE_MODEL_FRONTIER", default="command-r-plus"),
            TIER_BALANCED: _env("COHERE_MODEL_BALANCED", default="command-r"),
            TIER_FAST:     _env("COHERE_MODEL_FAST", default="command-r"),
            TIER_VISION:   _env("COHERE_MODEL_VISION", default="command-r-plus"),
        }))

    # 15) xAI / Grok
    xai_key = _env("XAI_API_KEY", "GROK_API_KEY")
    if xai_key:
        providers.append(Provider("grok", "https://api.x.ai/v1", xai_key, {
            TIER_FRONTIER: "grok-4", TIER_BALANCED: "grok-4",
            TIER_FAST: "grok-3-mini", TIER_VISION: "grok-4"}))

    # 16) DEEPSEEK
    ds_key = _env("DEEPSEEK_API_KEY")
    if ds_key:
        providers.append(Provider("deepseek", "https://api.deepseek.com/v1", ds_key, {
            TIER_FRONTIER: _env("DEEPSEEK_MODEL_FRONTIER", default="deepseek-chat"),
            TIER_BALANCED: "deepseek-chat",
            TIER_FAST:     "deepseek-chat",
            TIER_VISION:   "deepseek-chat",
        }))

    # 17) GITHUB MODELS — free with any GitHub token (github.com/marketplace/models)
    gh_tok = _env("GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN")
    if gh_tok:
        providers.append(Provider("github-models",
            "https://models.inference.ai.azure.com", gh_tok, {
            TIER_FRONTIER: _env("GITHUB_MODEL_FRONTIER", default="gpt-4o"),
            TIER_BALANCED: _env("GITHUB_MODEL_BALANCED", default="gpt-4o-mini"),
            TIER_FAST:     _env("GITHUB_MODEL_FAST", default="gpt-4o-mini"),
            TIER_VISION:   _env("GITHUB_MODEL_VISION", default="gpt-4o"),
        }))

    # 18) Replit AI integration — free on Replit, great fallback
    replit_key = _env("AI_INTEGRATIONS_OPENAI_API_KEY")
    replit_base = _env("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if replit_key and replit_base:
        providers.append(Provider("replit", replit_base, replit_key, {
            TIER_FRONTIER: "gpt-5", TIER_BALANCED: "gpt-5-mini",
            TIER_FAST: "gpt-5-nano", TIER_VISION: "gpt-5"}))

    return providers


# ─────────────────────────────────────────────────────────────────────────────
# POLLINATIONS FREE TEXT API — zero config, no key, always available as last resort
# https://text.pollinations.ai/  — accepts plain POST with {"messages": [...]}
# ─────────────────────────────────────────────────────────────────────────────
def _pollinations_text_complete(messages: List[Dict], max_tokens: int = 2000) -> str:
    """Call Pollinations free text API. No API key required. Always works."""
    import urllib.request as _ur
    import json as _j
    payload = _j.dumps({
        "model": "openai-large",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "private": True,
    }).encode()
    req = _ur.Request(
        "https://text.pollinations.ai/openai",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "NEXUS/1.0"},
        method="POST"
    )
    try:
        with _ur.urlopen(req, timeout=45) as r:
            result = _j.loads(r.read())
        return result["choices"][0]["message"]["content"].strip()
    except Exception as e:
        raise RuntimeError(f"pollinations-text: {e}")


def _pollinations_text_stream(messages: List[Dict], max_tokens: int = 2000):
    """Streaming version of Pollinations free text API."""
    import urllib.request as _ur
    import json as _j
    payload = _j.dumps({
        "model": "openai-large",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "stream": True,
        "private": True,
    }).encode()
    req = _ur.Request(
        "https://text.pollinations.ai/openai",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "NEXUS/1.0"},
        method="POST"
    )
    try:
        with _ur.urlopen(req, timeout=45) as r:
            buf = b""
            while True:
                chunk = r.read(256)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.decode("utf-8", errors="replace").strip()
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            data = _j.loads(line[6:])
                            content = data["choices"][0]["delta"].get("content", "")
                            if content:
                                yield content
                        except Exception:
                            pass
    except Exception as e:
        yield f"⚠️ pollinations-text: {e}"


# ─────────────────────────────────────────────────────────────────────────────
class LLMRouter:
    """Picks a provider for a tier and runs chat completions (sync + stream)."""

    def __init__(self):
        self.refresh()

    def refresh(self):
        self.providers = discover_providers()
        self.demo = len(self.providers) == 0
        self.last_used = None  # the provider that last answered successfully

    def status(self) -> Dict[str, Any]:
        return {
            "demo_mode": self.demo,
            "providers": [p.name for p in self.providers],
            "active": self.last_used or (self.providers[0].name if self.providers else "demo"),
        }

    def _pick(self, tier: str) -> Optional[Provider]:
        for p in self.providers:
            if p.available() and p.model_for(tier):
                return p
        return None

    def _pick_all(self, tier: str) -> List[Provider]:
        """ALL capable providers, in priority order — for the fallback chain."""
        return [p for p in self.providers if p.available() and p.model_for(tier)]

    # ── synchronous completion with FALLBACK CHAIN + retry/backoff ──
    def complete(self, tier: str, messages: List[Dict[str, str]],
                 temperature: float = 0.3, max_tokens: int = 4000) -> str:
        provs = self._pick_all(tier)
        if not provs:
            return self._demo_reply(messages, tier)
        import time as _t
        timeout = float(os.environ.get("LLM_TIMEOUT", "30"))
        max_retries = int(os.environ.get("LLM_RETRIES", "2"))
        errors = []
        # Try each provider in order; skip immediately on quota/bad-key errors.
        for prov in provs:
            for attempt in range(max_retries + 1):
                try:
                    client = get_client(prov.api_key, prov.base_url, timeout)
                    resp = client.chat.completions.create(
                        model=prov.model_for(tier), messages=messages,
                        temperature=temperature, max_tokens=max_tokens)
                    self.last_used = prov.name  # record the provider that worked
                    return _strip_persona(resp.choices[0].message.content or "")
                except Exception as e:
                    msg = str(e).lower()
                    short = _short_error(prov.name, e)
                    # Hard-skip conditions: rate limit, bad key, payment required, quota
                    is_quota = ("429" in msg or "402" in msg or "rate limit" in msg
                                or "quota" in msg or "insufficient" in msg
                                or "payment required" in msg or "billing" in msg
                                or "invalid api key" in msg or "incorrect api key" in msg
                                or "401" in msg)
                    # Transient (overloaded/timeout/5xx) -> one quick retry then move on.
                    transient = ("overloaded" in msg or "503" in msg or "502" in msg
                                 or "timeout" in msg or "timed out" in msg
                                 or "connection" in msg)
                    if transient and attempt < max_retries and not is_quota:
                        _t.sleep(1.5)
                        continue
                    errors.append(short)
                    break  # move to next provider immediately
        # all configured providers exhausted — try Pollinations free text API as last resort
        try:
            result = _pollinations_text_complete(messages, max_tokens=max_tokens)
            self.last_used = "pollinations-text"
            return result
        except Exception as pol_e:
            errors.append(f"pollinations-text: {pol_e}")
        raise LLMError(" → ".join(errors[-4:]) or "all providers failed")

    # ── streaming completion — tries ALL providers in order, falls back on failure ──
    def stream(self, tier: str, messages: List[Dict[str, str]],
               temperature: float = 0.3, max_tokens: int = 4000) -> Generator[str, None, None]:
        import time as _t
        provs = self._pick_all(tier)
        if not provs:
            yield self._demo_reply(messages, tier)
            return
        timeout = float(os.environ.get("LLM_TIMEOUT", "30"))
        errors = []
        for prov in provs:
            for attempt in range(2):
                try:
                    client = get_client(prov.api_key, prov.base_url, timeout)
                    stream = client.chat.completions.create(
                        model=prov.model_for(tier),
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        stream=True,
                    )
                    got_any = False
                    for chunk in stream:
                        delta = chunk.choices[0].delta
                        if delta and delta.content:
                            got_any = True
                            yield delta.content
                    if got_any:
                        self.last_used = prov.name
                        return  # success — done
                    # empty stream — treat as failure, try next provider
                    errors.append(f"{prov.name}: empty response")
                    break
                except Exception as e:
                    msg = str(e).lower()
                    short = _short_error(prov.name, e)
                    is_quota = ("429" in msg or "rate limit" in msg or "quota" in msg
                                or "insufficient" in msg or "invalid api key" in msg
                                or "incorrect api key" in msg or "401" in msg)
                    transient = ("overloaded" in msg or "503" in msg or "502" in msg
                                 or "timeout" in msg or "timed out" in msg
                                 or "connection" in msg)
                    if transient and attempt == 0 and not is_quota:
                        _t.sleep(1.0)
                        continue
                    errors.append(short)
                    break  # next provider
        # all configured providers failed — fall back to Pollinations free streaming API
        try:
            self.last_used = "pollinations-text"
            yield from _pollinations_text_stream(messages, max_tokens=max_tokens)
            return
        except Exception as pol_e:
            errors.append(f"pollinations-text: {pol_e}")
        yield f"⚠️ All providers failed: {' → '.join(errors[-4:])}"

    # ── demo fallback (clearly labelled, never crashes) ──
    def _demo_reply(self, messages: List[Dict[str, str]], tier: str) -> str:
        """No configured providers — use Pollinations (always free) before showing an error."""
        try:
            return _pollinations_text_complete(messages, max_tokens=2000)
        except Exception:
            pass
        last = next(
            (str(m.get("content", ""))[:200] for m in reversed(messages)
             if m.get("role") == "user"), "")
        return (
            f"No AI provider configured and Pollinations is unreachable.\n"
            f"Add any free key in Settings → Model Providers (Groq, Gemini, etc.).\n\n"
            f"Your message: \"{last}\""
        )


# Singleton
ROUTER = LLMRouter()
