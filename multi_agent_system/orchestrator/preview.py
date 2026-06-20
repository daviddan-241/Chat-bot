"""
NEXUS LIVE PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Preview a project's workspace BEFORE deploying — frontend AND backend.

  • Static (html/css/js)  -> served directly, fully rendered
  • Python web (Flask/FastAPI/Django/http.server) -> launched as a real server,
    requests proxied so you see the live app
  • PHP            -> php -S built-in server, proxied
  • Node/Express   -> node/npm start, proxied
  • Plain scripts (python/js/php/ruby/go/bash) -> executed, stdout shown
  • Any other code -> rendered source view

Each project gets ONE running preview server on a dynamic port. Starting a new
preview for a project stops the old one. Servers auto-stop after idle TTL.
"""

from __future__ import annotations
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from typing import Dict, Any, Optional

from . import tools

_PY = sys.executable or "python3"

# project_id -> {proc, port, kind, started, last_access, cmd}
_SERVERS: Dict[str, Dict[str, Any]] = {}
_LOCK = threading.Lock()
_IDLE_TTL = 600  # stop a preview server after 10 min idle


# ─────────────────────────────────────────────────────────────────────────────
def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _files(project_id: str) -> Dict[str, int]:
    base = tools.project_dir(project_id)
    out = {}
    for dp, _d, fs in os.walk(base):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), base)
            out[rel] = os.path.getsize(os.path.join(dp, f))
    return out


def _detect(project_id: str) -> Dict[str, Any]:
    """Figure out how to preview this project."""
    base = tools.project_dir(project_id)
    files = _files(project_id)
    names = set(files.keys())
    low = {n.lower() for n in names}

    def has(*xs):
        return any(x in low for x in xs)

    def find_with(text):
        for n in names:
            if n.endswith((".py", ".php", ".js", ".ts")):
                try:
                    with open(os.path.join(base, n), encoding="utf-8", errors="ignore") as f:
                        if text in f.read():
                            return n
                except Exception:
                    pass
        return None

    # Node / Express
    if "package.json" in low:
        return {"kind": "node", "base": base, "files": files}
    # PHP site
    php = [n for n in names if n.endswith(".php")]
    if php:
        entry = "index.php" if "index.php" in low else php[0]
        return {"kind": "php", "entry": entry, "base": base, "files": files}
    # Python web app (Flask/FastAPI/Django)
    flask_file = find_with("Flask(") or find_with("flask import")
    fastapi_file = find_with("FastAPI(") or find_with("fastapi import")
    if "manage.py" in low:
        return {"kind": "django", "base": base, "files": files}
    if fastapi_file:
        return {"kind": "fastapi", "entry": fastapi_file, "base": base, "files": files}
    if flask_file:
        return {"kind": "flask", "entry": flask_file, "base": base, "files": files}
    # Static site
    if has("index.html"):
        return {"kind": "static", "entry": "index.html", "base": base, "files": files}
    html = [n for n in names if n.endswith((".html", ".htm"))]
    if html:
        return {"kind": "static", "entry": html[0], "base": base, "files": files}
    # Plain runnable script
    py = [n for n in names if n.endswith(".py") and not n.startswith("_run_")]
    if py:
        entry = "main.py" if "main.py" in low else ("app.py" if "app.py" in low else py[0])
        return {"kind": "script", "lang": "python", "entry": entry, "base": base, "files": files}
    js = [n for n in names if n.endswith(".js")]
    if js:
        return {"kind": "script", "lang": "node", "entry": js[0], "base": base, "files": files}
    return {"kind": "empty", "base": base, "files": files}


# ─────────────────────────────────────────────────────────────────────────────
def _wait_up(port: int, timeout: float = 12.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except Exception:
            time.sleep(0.3)
    return False


def stop(project_id: str):
    with _LOCK:
        srv = _SERVERS.pop(project_id, None)
    if srv and srv.get("proc"):
        try:
            srv["proc"].terminate()
            try:
                srv["proc"].wait(timeout=4)
            except Exception:
                srv["proc"].kill()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-INSTALL: find required packages and install them before running.
# ─────────────────────────────────────────────────────────────────────────────
_PY_IMPORT_RE = re.compile(r"^\s*(?:import|from)\s+([a-zA-Z0-9_]+)", re.M)
# map import-name -> pip package name where they differ
_PIP_ALIASES = {
    "flask": "flask", "fastapi": "fastapi", "uvicorn": "uvicorn",
    "django": "django", "requests": "requests", "bs4": "beautifulsoup4",
    "cv2": "opencv-python", "PIL": "pillow", "sklearn": "scikit-learn",
    "yaml": "pyyaml", "dotenv": "python-dotenv", "jwt": "pyjwt",
    "psycopg2": "psycopg2-binary", "redis": "redis", "sqlalchemy": "sqlalchemy",
    "pydantic": "pydantic", "aiohttp": "aiohttp", "httpx": "httpx",
    "numpy": "numpy", "pandas": "pandas", "openai": "openai",
}
_STDLIB = {"os", "sys", "json", "re", "time", "math", "random", "datetime",
           "subprocess", "threading", "collections", "itertools", "functools",
           "pathlib", "typing", "io", "base64", "hashlib", "uuid", "socket",
           "urllib", "http", "sqlite3", "logging", "abc", "enum", "dataclasses",
           "asyncio", "argparse", "shutil", "tempfile", "csv", "xml", "html"}


def auto_install(project_id: str, det: Dict[str, Any], log: list) -> None:
    """Detect & install missing requirements (pip / npm) so the project can run."""
    base = det["base"]
    kind = det["kind"]
    try:
        if kind in ("flask", "fastapi", "django", "script"):
            pkgs = set()
            # requirements.txt wins if present
            req = os.path.join(base, "requirements.txt")
            if os.path.exists(req):
                subprocess.run([_PY, "-m", "pip", "install", "-r", req, "--quiet"],
                               cwd=base, timeout=240,
                               capture_output=True)
                log.append("pip install -r requirements.txt")
            # also scan imports for anything still missing
            for n in det.get("files", {}):
                if n.endswith(".py"):
                    try:
                        src = open(os.path.join(base, n), encoding="utf-8",
                                   errors="ignore").read()
                    except Exception:
                        continue
                    for mod in _PY_IMPORT_RE.findall(src):
                        if mod in _STDLIB or mod.startswith("_"):
                            continue
                        if _module_installed(mod):
                            continue
                        pkgs.add(_PIP_ALIASES.get(mod, mod))
            if kind == "fastapi":
                pkgs.update({"fastapi", "uvicorn"})
            for p in pkgs:
                r = subprocess.run([_PY, "-m", "pip", "install", p, "--quiet"],
                                   timeout=180, capture_output=True, text=True)
                log.append(f"pip install {p} -> {'ok' if r.returncode==0 else 'fail'}")
        elif kind == "node":
            if os.path.exists(os.path.join(base, "package.json")) and shutil.which("npm"):
                subprocess.run(["npm", "install", "--silent"], cwd=base, timeout=240,
                               capture_output=True)
                log.append("npm install")
    except Exception as e:
        log.append(f"auto-install warning: {e}")


def _module_installed(mod: str) -> bool:
    import importlib.util
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _pip_install(pkg: str) -> bool:
    try:
        r = subprocess.run([_PY, "-m", "pip", "install", pkg, "--quiet"],
                           timeout=180, capture_output=True)
        return r.returncode == 0
    except Exception:
        return False


# Extract a missing-module name from a server's error output, for auto-fix.
_MISSING_RE = re.compile(r"No module named ['\"]([a-zA-Z0-9_]+)['\"]")


def _launch_server(project_id: str, det: Dict[str, Any]) -> Dict[str, Any]:
    """Start a real server for backend projects; return {port, kind}."""
    stop(project_id)  # one preview per project
    base = det["base"]
    port = _free_port()
    env = dict(os.environ, PORT=str(port), PYTHONUNBUFFERED="1")
    kind = det["kind"]
    cmd = None

    if kind == "flask":
        # run via flask app object if standard, else execute the file
        entry = det["entry"]
        module = entry[:-3].replace("/", ".")
        cmd = [_PY, "-c",
               f"import os;os.environ['PORT']='{port}';"
               f"import runpy;runpy.run_path(r'{os.path.join(base, entry)}',run_name='__main__')"]
        # better: try flask run if app=app exists
        cmd = [_PY, "-m", "flask", "--app", entry.replace(".py", ""), "run",
               "--port", str(port), "--host", "127.0.0.1"]
    elif kind == "fastapi":
        entry = det["entry"]
        module = entry[:-3].replace("/", ".")
        cmd = [_PY, "-m", "uvicorn", f"{module}:app",
               "--port", str(port), "--host", "127.0.0.1"]
    elif kind == "django":
        cmd = [_PY, "manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"]
    elif kind == "php":
        php = shutil.which("php")
        if not php:
            return {"error": "php not installed on the server"}
        cmd = [php, "-S", f"127.0.0.1:{port}", "-t", base]
    elif kind == "node":
        node = shutil.which("npm") or shutil.which("node")
        # install deps quietly then start
        if shutil.which("npm"):
            subprocess.run(["npm", "install", "--silent"], cwd=base, timeout=120)
            cmd = ["npm", "start"]
        else:
            cmd = ["node", det.get("entry", "index.js")]
    elif kind == "static":
        cmd = [_PY, "-m", "http.server", str(port), "--bind", "127.0.0.1"]

    if not cmd:
        return {"error": f"cannot serve kind '{kind}'"}

    try:
        proc = subprocess.Popen(cmd, cwd=base, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except FileNotFoundError as e:
        return {"error": f"runtime missing: {e}"}

    up = _wait_up(port, timeout=15)
    if not up:
        # capture early output for the error
        out = b""
        try:
            if proc.poll() is not None:
                out = proc.stdout.read(4000) if proc.stdout else b""
        except Exception:
            pass
        stop(project_id)
        err = out.decode("utf-8", "ignore")
        # AUTO-FIX: missing module -> install it and retry once
        m = _MISSING_RE.search(err)
        if m and not det.get("_retried"):
            pkg = _PIP_ALIASES.get(m.group(1), m.group(1))
            if _pip_install(pkg):
                det2 = dict(det); det2["_retried"] = True
                r = _launch_server(project_id, det2)
                if not r.get("error"):
                    r["autofixed"] = f"installed {pkg}"
                return r
        return {"error": "server did not start. " + err[-300:]}

    with _LOCK:
        _SERVERS[project_id] = {"proc": proc, "port": port, "kind": kind,
                                "started": time.time(), "last_access": time.time(),
                                "cmd": " ".join(cmd)}
    return {"port": port, "kind": kind}


# ─────────────────────────────────────────────────────────────────────────────
def start(project_id: str) -> Dict[str, Any]:
    """Public: ensure a preview is running; returns how to view it."""
    det = _detect(project_id)
    kind = det["kind"]

    if kind == "empty":
        return {"ok": False, "kind": "empty",
                "error": "Workspace is empty — build something first."}

    if kind == "static":
        # static can be served via the existing file route (no server needed)
        return {"ok": True, "kind": "static", "mode": "file",
                "entry": det.get("entry", "index.html")}

    install_log: list = []
    auto_install(project_id, det, install_log)

    if kind == "script":
        # run once, capture output (auto-fix missing module once)
        entry = det["entry"]
        lang = det["lang"]
        src = open(os.path.join(det["base"], entry), encoding="utf-8", errors="ignore").read()
        res = tools.run_code(src, lang=lang, project_id=project_id, timeout=25)
        if not res.get("ok") and lang == "python":
            m = _MISSING_RE.search(res.get("output", ""))
            if m and _pip_install(_PIP_ALIASES.get(m.group(1), m.group(1))):
                install_log.append(f"auto-installed {m.group(1)}")
                res = tools.run_code(src, lang=lang, project_id=project_id, timeout=25)
        return {"ok": True, "kind": "script", "mode": "output",
                "entry": entry, "output": res.get("output", ""),
                "success": res.get("ok"), "install_log": install_log}

    # backend server kinds
    r = _launch_server(project_id, det)
    if r.get("error"):
        return {"ok": False, "kind": kind, "error": r["error"], "install_log": install_log}
    return {"ok": True, "kind": kind, "mode": "server", "port": r["port"],
            "install_log": install_log, "autofixed": r.get("autofixed")}


def status(project_id: str) -> Dict[str, Any]:
    with _LOCK:
        srv = _SERVERS.get(project_id)
    det = _detect(project_id)
    return {"detected": det["kind"], "files": det.get("files", {}),
            "running": bool(srv), "port": srv["port"] if srv else None}


def proxy(project_id: str, path: str, method: str, headers: dict,
          body: bytes) -> Dict[str, Any]:
    """Proxy a request to the running preview server."""
    with _LOCK:
        srv = _SERVERS.get(project_id)
        if srv:
            srv["last_access"] = time.time()
    if not srv:
        return {"status": 502, "headers": {}, "body": b"Preview server not running"}
    url = f"http://127.0.0.1:{srv['port']}/{path.lstrip('/')}"
    req = urllib.request.Request(url, data=body if body else None,
                                 method=method)
    for k, v in headers.items():
        if k.lower() in ("host", "content-length", "connection"):
            continue
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            ct = r.headers.get("Content-Type", "text/html")
            return {"status": r.status, "headers": {"Content-Type": ct}, "body": data}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "headers": {"Content-Type": "text/html"},
                "body": e.read()}
    except Exception as e:
        return {"status": 502, "headers": {"Content-Type": "text/plain"},
                "body": f"Preview error: {e}".encode()}


# ── background reaper for idle servers ──
def _reaper():
    while True:
        time.sleep(60)
        now = time.time()
        dead = []
        with _LOCK:
            for pid, s in list(_SERVERS.items()):
                if now - s["last_access"] > _IDLE_TTL:
                    dead.append(pid)
        for pid in dead:
            stop(pid)


threading.Thread(target=_reaper, daemon=True).start()
