"""
NEXUS Ollama Provider
━━━━━━━━━━━━━━━━━━━━
Local/offline AI via Ollama. Streams chat completions.
Falls back to Pollinations.ai if Ollama is unavailable.

Supported models (auto-pulled on first use):
  qwen2.5:7b         — Alibaba Qwen 2.5
  deepseek-r1:7b     — DeepSeek R1
  llama3.2:3b        — Meta Llama 3.2
  mistral:7b         — Mistral
  phi3:mini          — Microsoft Phi-3

Set env:
  OLLAMA_HOST     = http://localhost:11434  (default)
  OLLAMA_MODEL    = qwen2.5:7b             (default)
  OLLAMA_TIMEOUT  = 120                    (seconds)
"""
from __future__ import annotations
import json, os, urllib.request, urllib.error, threading, time
from typing import Iterator, Optional

OLLAMA_HOST    = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
DEFAULT_MODEL  = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT", 120))

_available: Optional[bool] = None   # None = not yet tested
_available_lock = threading.Lock()


def _req(method: str, path: str, body: dict | None = None, timeout: int = 10) -> tuple[dict | None, int]:
    url  = f"{OLLAMA_HOST}{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method,
                                  headers={"Content-Type": "application/json", "User-Agent": "NEXUS/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try: return json.loads(raw), r.status
            except: return {"raw": raw.decode()}, r.status
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code
    except Exception as e:
        return {"error": str(e)}, 0


def is_available() -> bool:
    global _available
    with _available_lock:
        if _available is not None:
            return _available
    _, status = _req("GET", "/api/version", timeout=3)
    with _available_lock:
        _available = (status == 200)
    return _available


def list_models() -> list[dict]:
    """Return list of locally installed Ollama models."""
    data, status = _req("GET", "/api/tags", timeout=8)
    if status != 200:
        return []
    return data.get("models", [])


def pull_model(model: str) -> Iterator[str]:
    """Pull a model from Ollama registry. Yields progress lines."""
    url  = f"{OLLAMA_HOST}/api/pull"
    body = json.dumps({"name": model, "stream": True}).encode()
    req  = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r:
                line = line.strip()
                if line:
                    try:
                        obj = json.loads(line)
                        yield obj.get("status", "") + (" " + str(obj.get("completed","")) if "completed" in obj else "")
                    except:
                        yield line.decode(errors="replace")
    except Exception as e:
        yield f"Error pulling {model}: {e}"


def chat_stream(messages: list[dict], model: str = DEFAULT_MODEL,
                system: str | None = None) -> Iterator[str]:
    """
    Stream a chat completion from Ollama.
    messages: [{role:'user'|'assistant'|'system', content:str}]
    Yields text chunks.
    """
    if not is_available():
        yield "[Ollama offline — check OLLAMA_HOST or start Ollama]"
        return

    full_messages = []
    if system:
        full_messages.append({"role": "system", "content": system})
    full_messages.extend(messages)

    url  = f"{OLLAMA_HOST}/api/chat"
    body = json.dumps({"model": model, "messages": full_messages, "stream": True}).encode()
    req  = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as r:
            for raw_line in r:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    obj = json.loads(raw_line)
                    content = obj.get("message", {}).get("content", "")
                    if content:
                        yield content
                    if obj.get("done"):
                        break
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        yield f"\n[Ollama error: {e}]"


def chat(messages: list[dict], model: str = DEFAULT_MODEL,
         system: str | None = None) -> str:
    """Non-streaming chat — returns full response string."""
    return "".join(chat_stream(messages, model=model, system=system))


def generate_stream(prompt: str, model: str = DEFAULT_MODEL,
                    system: str | None = None) -> Iterator[str]:
    """Raw generate (non-chat) streaming."""
    if not is_available():
        yield "[Ollama offline]"
        return
    url  = f"{OLLAMA_HOST}/api/generate"
    body = json.dumps({"model": model, "prompt": prompt,
                       "system": system or "", "stream": True}).encode()
    req  = urllib.request.Request(url, data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as r:
            for raw_line in r:
                raw_line = raw_line.strip()
                if not raw_line: continue
                try:
                    obj = json.loads(raw_line)
                    if obj.get("response"):
                        yield obj["response"]
                    if obj.get("done"): break
                except: continue
    except Exception as e:
        yield f"\n[Ollama error: {e}]"


def get_model_info(model: str) -> dict:
    data, status = _req("POST", "/api/show", {"name": model}, timeout=10)
    return data if status == 200 else {"error": f"status {status}"}


RECOMMENDED_MODELS = [
    {"id": "qwen2.5:7b",      "name": "Qwen 2.5 7B",       "size": "~4.7 GB", "desc": "Alibaba — excellent reasoning & coding"},
    {"id": "qwen2.5:1.5b",    "name": "Qwen 2.5 1.5B",     "size": "~1 GB",   "desc": "Ultra-fast, minimal RAM"},
    {"id": "deepseek-r1:7b",  "name": "DeepSeek R1 7B",    "size": "~4.7 GB", "desc": "Strong chain-of-thought reasoning"},
    {"id": "deepseek-r1:1.5b","name": "DeepSeek R1 1.5B",  "size": "~1 GB",   "desc": "Fast reasoning, tiny footprint"},
    {"id": "llama3.2:3b",     "name": "Llama 3.2 3B",      "size": "~2 GB",   "desc": "Meta — balanced speed & quality"},
    {"id": "llama3.2:1b",     "name": "Llama 3.2 1B",      "size": "~0.8 GB", "desc": "Meta — minimal, runs anywhere"},
    {"id": "mistral:7b",      "name": "Mistral 7B",        "size": "~4.1 GB", "desc": "European open model, instruction-tuned"},
    {"id": "phi3:mini",       "name": "Phi-3 Mini",        "size": "~2.2 GB", "desc": "Microsoft — small but smart"},
    {"id": "codellama:7b",    "name": "Code Llama 7B",     "size": "~3.8 GB", "desc": "Meta — code generation specialist"},
    {"id": "gemma2:2b",       "name": "Gemma 2 2B",        "size": "~1.6 GB", "desc": "Google — efficient chat model"},
]
