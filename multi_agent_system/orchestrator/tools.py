"""
NEXUS TOOL EXECUTION LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The REAL hands of the agents. Every tool here actually executes — no mocks.

Tools:
  write_file(path, content)        -> writes a real file into the project workspace
  read_file(path)                  -> reads a real file
  list_files(subdir="")            -> lists workspace files
  run_code(code, lang="python")    -> runs real code in a subprocess, returns output
  run_shell(cmd)                   -> runs a real local shell command
  kali_exec(cmd)                   -> runs a real command on the custom Kali box
  web_search(query)                -> real web search (if SERP/Tavily key set; else note)
  generate_image(prompt, name)     -> real image gen (if provider key set; else note)

All file operations are SANDBOXED to a per-project workspace directory so projects
stay isolated and nothing escapes the workspace root.
"""

from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from typing import Dict, Any, Optional

# ── Workspace root (per-project subdirs live here) ──
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # multi_agent_system/
WORKSPACE_ROOT = os.environ.get("NEXUS_WORKSPACE",
                                os.path.join(_BASE, "workspace"))
os.makedirs(WORKSPACE_ROOT, exist_ok=True)

_PY = sys.executable or "python3"


# ─────────────────────────────────────────────────────────────────────────────
# Path safety — confine everything to <WORKSPACE_ROOT>/<project_id>/
# ─────────────────────────────────────────────────────────────────────────────
def project_dir(project_id: str = "default") -> str:
    safe = "".join(c for c in (project_id or "default") if c.isalnum() or c in "-_")
    d = os.path.join(WORKSPACE_ROOT, safe or "default")
    os.makedirs(d, exist_ok=True)
    return d


def _resolve(project_id: str, rel: str) -> str:
    base = project_dir(project_id)
    full = os.path.realpath(os.path.join(base, rel))
    if not full.startswith(os.path.realpath(base)):
        raise ValueError("Path escapes project workspace")
    return full


# ─────────────────────────────────────────────────────────────────────────────
# FILE TOOLS (real)
# ─────────────────────────────────────────────────────────────────────────────
def write_file(path: str, content: str, project_id: str = "default") -> Dict[str, Any]:
    full = _resolve(project_id, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    return {"ok": True, "tool": "write_file", "path": path,
            "bytes": len(content.encode("utf-8")),
            "abs": os.path.relpath(full, WORKSPACE_ROOT)}


def read_file(path: str, project_id: str = "default") -> Dict[str, Any]:
    full = _resolve(project_id, path)
    if not os.path.exists(full):
        return {"ok": False, "tool": "read_file", "path": path, "error": "not found"}
    with open(full, "r", encoding="utf-8", errors="replace") as f:
        return {"ok": True, "tool": "read_file", "path": path, "content": f.read()}


def list_files(subdir: str = "", project_id: str = "default") -> Dict[str, Any]:
    base = project_dir(project_id)
    root = _resolve(project_id, subdir) if subdir else base
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            fp = os.path.join(dirpath, fn)
            out.append({"path": os.path.relpath(fp, base),
                        "size": os.path.getsize(fp)})
    return {"ok": True, "tool": "list_files", "files": out, "count": len(out)}


# ─────────────────────────────────────────────────────────────────────────────
# CODE / SHELL EXECUTION (real subprocesses, sandboxed cwd, timeouts)
# ─────────────────────────────────────────────────────────────────────────────
def run_code(code: str, lang: str = "python", project_id: str = "default",
             timeout: int = 30) -> Dict[str, Any]:
    cwd = project_dir(project_id)
    lang = (lang or "python").lower()
    try:
        if lang in ("python", "py"):
            fn = os.path.join(cwd, f"_run_{uuid.uuid4().hex[:6]}.py")
            with open(fn, "w") as f:
                f.write(code)
            r = subprocess.run([_PY, fn], capture_output=True, text=True,
                               timeout=timeout, cwd=cwd)
            os.unlink(fn)
        elif lang in ("javascript", "js", "node"):
            fn = os.path.join(cwd, f"_run_{uuid.uuid4().hex[:6]}.js")
            with open(fn, "w") as f:
                f.write(code)
            r = subprocess.run(["node", fn], capture_output=True, text=True,
                               timeout=timeout, cwd=cwd)
            os.unlink(fn)
        elif lang in ("bash", "sh", "shell"):
            r = subprocess.run(code, shell=True, capture_output=True, text=True,
                               timeout=timeout, cwd=cwd)
        else:
            return {"ok": False, "tool": "run_code",
                    "error": f"unsupported lang '{lang}'"}
        out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
        return {"ok": r.returncode == 0, "tool": "run_code", "lang": lang,
                "exit_code": r.returncode, "output": out[:8000]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "tool": "run_code",
                "error": f"timed out after {timeout}s"}
    except FileNotFoundError as e:
        return {"ok": False, "tool": "run_code",
                "error": f"runtime not installed: {e}"}
    except Exception as e:
        return {"ok": False, "tool": "run_code", "error": str(e)}


def run_shell(cmd: str, project_id: str = "default", timeout: int = 30) -> Dict[str, Any]:
    cwd = project_dir(project_id)
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=timeout, cwd=cwd)
        out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
        return {"ok": r.returncode == 0, "tool": "run_shell",
                "exit_code": r.returncode, "output": out[:8000]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "tool": "run_shell", "error": f"timed out after {timeout}s"}
    except Exception as e:
        return {"ok": False, "tool": "run_shell", "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# KALI EXEC (real — reuses the coordinator's wired custom Kali box)
# ─────────────────────────────────────────────────────────────────────────────
def kali_exec(cmd: str, timeout: int = 60) -> Dict[str, Any]:
    try:
        from agents.coordinator_agent import _kali_exec, _kali_available
        if not _kali_available():
            return {"ok": False, "tool": "kali_exec",
                    "error": "Kali box not reachable (check KALI_API_URL/KEY in Settings)"}
        res = _kali_exec(cmd, timeout=timeout)
        return {"ok": res.get("ok", True), "tool": "kali_exec",
                "output": (res.get("output") or res.get("stdout") or "")[:8000],
                "raw": res}
    except Exception as e:
        return {"ok": False, "tool": "kali_exec", "error": str(e)}


def apt_install(packages: str, timeout: int = 240) -> Dict[str, Any]:
    """Install system tools/packages. Tries the Kali box (sudo apt) first, then
    a local apt fallback, then pip for python pkgs. Real package installation."""
    pkgs = packages.replace(",", " ").strip()
    if not pkgs:
        return {"ok": False, "tool": "apt_install", "error": "no packages given"}
    # 1) Kali box (real sudo apt on your authorized machine)
    try:
        from agents.coordinator_agent import _kali_exec, _kali_available
        if _kali_available():
            cmd = (f"sudo apt-get update -y >/dev/null 2>&1; "
                   f"sudo DEBIAN_FRONTEND=noninteractive apt-get install -y {pkgs}")
            res = _kali_exec(cmd, timeout=timeout)
            out = (res.get("output") or res.get("stdout") or "")
            ok = res.get("ok", True) and "unable to locate" not in out.lower()
            return {"ok": ok, "tool": "apt_install", "via": "kali",
                    "packages": pkgs, "output": out[:4000]}
    except Exception:
        pass
    # 2) local apt (if running on a Debian host with sudo)
    if shutil.which("apt-get"):
        try:
            r = subprocess.run(
                f"sudo apt-get install -y {pkgs} || apt-get install -y {pkgs}",
                shell=True, capture_output=True, text=True, timeout=timeout)
            return {"ok": r.returncode == 0, "tool": "apt_install", "via": "local-apt",
                    "packages": pkgs, "output": (r.stdout + r.stderr)[-4000:]}
        except Exception as e:
            return {"ok": False, "tool": "apt_install", "error": str(e)}
    # 3) pip fallback (treat as python packages)
    try:
        r = subprocess.run([_PY, "-m", "pip", "install"] + pkgs.split(),
                           capture_output=True, text=True, timeout=timeout)
        return {"ok": r.returncode == 0, "tool": "apt_install", "via": "pip",
                "packages": pkgs, "output": (r.stdout + r.stderr)[-4000:]}
    except Exception as e:
        return {"ok": False, "tool": "apt_install", "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# WEB SEARCH — real multi-provider with free fallbacks, no key required
# Priority: Tavily → Serper → Bing → DuckDuckGo (free) → SearXNG (free)
# ─────────────────────────────────────────────────────────────────────────────
def _search_duckduckgo(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Free DuckDuckGo search — no API key needed. Uses DDG Lite HTML API."""
    try:
        import html as _html
        import re as _re
        enc = urllib.parse.quote_plus(query)
        # DDG HTML endpoint — returns real results without a key
        for url in [
            f"https://api.duckduckgo.com/?q={enc}&format=json&no_html=1&skip_disambig=1",
        ]:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; NEXUS/1.0)",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8", errors="replace"))
            results = []
            # RelatedTopics gives real results
            for item in data.get("RelatedTopics", [])[:max_results]:
                if isinstance(item, dict) and item.get("FirstURL"):
                    results.append({
                        "title": _html.unescape(item.get("Text", "")[:120]),
                        "url": item.get("FirstURL"),
                        "snippet": _html.unescape(item.get("Text", "")[:300]),
                    })
            if results:
                return {"ok": True, "tool": "web_search", "query": query,
                        "results": results, "provider": "duckduckgo(free)"}
    except Exception as e:
        return {"ok": False, "tool": "web_search", "query": query,
                "error": f"duckduckgo: {e}"}
    return {"ok": False, "tool": "web_search", "query": query,
            "error": "duckduckgo returned no results"}


def _search_searxng(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Free SearXNG public instance — no key needed."""
    instances = [
        "https://search.tiekoetter.com",
        "https://searx.be",
        "https://searxng.world",
        "https://search.bus-hit.me",
    ]
    for base in instances:
        try:
            enc = urllib.parse.quote_plus(query)
            url = f"{base}/search?q={enc}&format=json&categories=general"
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; NEXUS/1.0)",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=12) as r:
                data = json.loads(r.read().decode("utf-8", errors="replace"))
            items = data.get("results", [])[:max_results]
            if items:
                results = [{"title": x.get("title", ""), "url": x.get("url", ""),
                            "snippet": x.get("content", "")[:300]} for x in items]
                return {"ok": True, "tool": "web_search", "query": query,
                        "results": results, "provider": f"searxng({base})"}
        except Exception:
            continue
    return {"ok": False, "tool": "web_search", "query": query,
            "error": "all searxng instances failed"}


def web_search(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Real web search — tries Tavily, Serper, Bing, then free DDG/SearXNG fallbacks."""
    # 1) Tavily (best quality, free tier available at tavily.com)
    tavily = os.environ.get("TAVILY_API_KEY")
    if tavily:
        try:
            body = json.dumps({"api_key": tavily, "query": query,
                               "max_results": max_results}).encode()
            req = urllib.request.Request("https://api.tavily.com/search",
                                         data=body,
                                         headers={"Content-Type": "application/json"},
                                         method="POST")
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode())
            results = [{"title": x.get("title"), "url": x.get("url"),
                        "snippet": x.get("content", "")[:300]}
                       for x in data.get("results", [])]
            if results:
                return {"ok": True, "tool": "web_search", "query": query,
                        "results": results, "provider": "tavily"}
        except Exception:
            pass

    # 2) Serper.dev (free 2500 req/month at serper.dev)
    serper = os.environ.get("SERPER_API_KEY")
    if serper:
        try:
            body = json.dumps({"q": query, "num": max_results}).encode()
            req = urllib.request.Request("https://google.serper.dev/search",
                                         data=body,
                                         headers={"X-API-KEY": serper,
                                                  "Content-Type": "application/json"},
                                         method="POST")
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode())
            items = data.get("organic", [])[:max_results]
            if items:
                results = [{"title": x.get("title"), "url": x.get("link"),
                            "snippet": x.get("snippet", "")[:300]} for x in items]
                return {"ok": True, "tool": "web_search", "query": query,
                        "results": results, "provider": "serper"}
        except Exception:
            pass

    # 3) Bing Search API (free tier at azure.microsoft.com)
    bing = os.environ.get("BING_SEARCH_API_KEY")
    if bing:
        try:
            enc = urllib.parse.quote_plus(query)
            url = f"https://api.bing.microsoft.com/v7.0/search?q={enc}&count={max_results}"
            req = urllib.request.Request(url, headers={"Ocp-Apim-Subscription-Key": bing})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode())
            items = data.get("webPages", {}).get("value", [])[:max_results]
            if items:
                results = [{"title": x.get("name"), "url": x.get("url"),
                            "snippet": x.get("snippet", "")[:300]} for x in items]
                return {"ok": True, "tool": "web_search", "query": query,
                        "results": results, "provider": "bing"}
        except Exception:
            pass

    # 4) DuckDuckGo — FREE, no key needed
    ddg = _search_duckduckgo(query, max_results)
    if ddg.get("ok"):
        return ddg

    # 5) SearXNG public instances — FREE, no key needed
    sxng = _search_searxng(query, max_results)
    if sxng.get("ok"):
        return sxng

    return {"ok": False, "tool": "web_search", "query": query,
            "error": "All search providers failed. Add TAVILY_API_KEY in Settings for best results."}


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE GENERATION (real if an image provider is set, else honest note)
# ─────────────────────────────────────────────────────────────────────────────
def generate_image(prompt: str, name: str = "", project_id: str = "default") -> Dict[str, Any]:
    from . import media
    return media.generate_image(prompt, name=name, project_id=project_id)


def generate_video(prompt: str, name: str = "", project_id: str = "default") -> Dict[str, Any]:
    from . import media
    return media.generate_video(prompt, name=name, project_id=project_id)


def edit_image(image_b64: str, instruction: str, name: str = "",
               project_id: str = "default") -> Dict[str, Any]:
    """Edit/transform an uploaded image using Pollinations AI.
    Describes the current image then generates a new version with the instruction applied.
    Works with any image: change clothes, add objects, alter style, swap background, etc.
    """
    import base64 as _b64
    import urllib.request as _ur
    import urllib.parse as _up
    import uuid as _uuid

    fname = name or f"edited_{_uuid.uuid4().hex[:8]}.png"
    # Describe what the image contains using vision LLM, then build a combined prompt
    from .llm import ROUTER
    try:
        describe_msgs = [
            {"role": "system", "content": "Describe this image in detail: subjects, clothing, pose, setting, lighting. Be concrete."},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image_b64 if image_b64.startswith("data:") else f"data:image/png;base64,{image_b64}"}},
                {"type": "text", "text": "Describe everything you see."}
            ]}
        ]
        description = ROUTER.complete("vision", describe_msgs, max_tokens=400, temperature=0.3)
    except Exception:
        description = "a person in a scene"

    # Build the full prompt: original description + edit instruction
    full_prompt = (
        f"photorealistic image: {description.strip()}. "
        f"MODIFICATION: {instruction.strip()}. "
        f"High quality, detailed, realistic photography style."
    )

    # Try OpenAI image edit first if key is set
    key = os.environ.get("CUSTOM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    out = _resolve(project_id, fname)
    if key:
        try:
            import base64 as b64
            from .llm import get_client
            base_url = (os.environ.get("CUSTOM_API_BASE_URL")
                        if os.environ.get("CUSTOM_API_KEY") else "https://api.openai.com/v1")
            client = get_client(key, base_url)
            resp = client.images.generate(
                model=os.environ.get("IMAGE_MODEL", "gpt-image-1"),
                prompt=full_prompt, size="1024x1024", n=1)
            d = resp.data[0]
            if getattr(d, "b64_json", None):
                with open(out, "wb") as f:
                    f.write(b64.b64decode(d.b64_json))
                return {"ok": True, "tool": "edit_image", "path": fname,
                        "provider": "openai-images", "prompt_used": full_prompt}
            elif getattr(d, "url", None):
                _ur.urlretrieve(d.url, out)
                return {"ok": True, "tool": "edit_image", "path": fname,
                        "provider": "openai-images", "prompt_used": full_prompt}
        except Exception:
            pass  # fall through to Pollinations

    # Pollinations AI — free, no key needed
    try:
        enc = _up.quote(full_prompt, safe="")
        url = f"https://image.pollinations.ai/prompt/{enc}?width=1024&height=1024&nologo=true&enhance=true"
        req = _ur.Request(url, headers={"User-Agent": "NEXUS/1.0"})
        with _ur.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(out, "wb") as f:
            f.write(data)
        return {"ok": True, "tool": "edit_image", "path": fname,
                "provider": "pollinations-ai", "prompt_used": full_prompt}
    except Exception as e:
        return {"ok": False, "tool": "edit_image", "error": str(e),
                "prompt_used": full_prompt}


# ─────────────────────────────────────────────────────────────────────────────
# DISPATCH — agents call tools by name; this is the single entry point.
# ─────────────────────────────────────────────────────────────────────────────
def fetch_url(url: str, max_chars: int = 60000) -> Dict[str, Any]:
    """Fetch a real web page's HTML so agents can clone/analyze it (like same.new)."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; NEXUS/1.0)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            ct = r.headers.get("Content-Type", "")
            raw = r.read(max_chars * 2)
        html = raw.decode("utf-8", errors="replace")[:max_chars]
        return {"ok": True, "tool": "fetch_url", "url": url,
                "content_type": ct, "html": html, "length": len(html)}
    except Exception as e:
        return {"ok": False, "tool": "fetch_url", "url": url, "error": str(e)}


def deploy(target: str, project_id: str = "default", **kwargs) -> Dict[str, Any]:
    """Real deploy from inside chat: target = github|netlify|vercel."""
    from . import deploy as DEP
    return DEP.deploy(target, project_id, **kwargs)


def humanize_text(text: str) -> Dict[str, Any]:
    """Rewrite text to read human (real, used by agents on request)."""
    from . import inspector as INSP
    r = INSP.humanize(text)  # always does at least one real rewrite pass
    return {"ok": True, "tool": "humanize_text", "text": r["text"],
            "ai_score": r["after"]["ai_score"], "changed": r["changed"]}


TOOL_FUNCS = {
    "fetch_url": fetch_url,
    "deploy": deploy,
    "humanize_text": humanize_text,
    "write_file": write_file,
    "read_file": read_file,
    "list_files": list_files,
    "run_code": run_code,
    "run_shell": run_shell,
    "kali_exec": kali_exec,
    "apt_install": apt_install,
    "web_search": web_search,
    "generate_image": generate_image,
    "generate_video": generate_video,
    "edit_image": edit_image,
}


def call_tool(tool: str, args: Dict[str, Any], project_id: str = "default") -> Dict[str, Any]:
    fn = TOOL_FUNCS.get(tool)
    if not fn:
        return {"ok": False, "error": f"unknown tool '{tool}'"}
    # Inject project_id only where the function accepts it
    import inspect
    params = inspect.signature(fn).parameters
    if "project_id" in params:
        args = {**args, "project_id": project_id}
    try:
        return fn(**args)
    except TypeError as e:
        return {"ok": False, "tool": tool, "error": f"bad args: {e}"}
    except Exception as e:
        return {"ok": False, "tool": tool, "error": str(e)}
