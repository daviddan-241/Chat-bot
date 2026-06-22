"""
NEXUS Module Auto-Loader
━━━━━━━━━━━━━━━━━━━━━━━
Watches /modules/ for .py files and loads them dynamically.
Each module can export:
  - TOOLS: dict of {name: fn}  → added to TOOL_FUNCS
  - AGENTS: list of agent dicts
  - on_load() → called after import

Background thread polls every 3600s (1 hour) for new/changed modules.
"""
from __future__ import annotations
import os, sys, importlib.util, threading, time, traceback, hashlib
from typing import Dict, Any, Callable

MODULES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "modules")
_loaded: Dict[str, dict] = {}   # path → {mod, mtime, hash}
_extra_tools: Dict[str, Callable] = {}
_lock = threading.Lock()
_poll_interval = int(os.environ.get("MODULE_RELOAD_INTERVAL", 3600))


def _file_hash(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()
    except Exception:
        return ""


def _load_module(path: str) -> dict | None:
    name = os.path.splitext(os.path.basename(path))[0]
    try:
        spec = importlib.util.spec_from_file_location(f"nexus_module_{name}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        tools = getattr(mod, "TOOLS", {})
        agents = getattr(mod, "AGENTS", [])
        on_load = getattr(mod, "on_load", None)
        if callable(on_load):
            try: on_load()
            except Exception as e: print(f"[ModuleLoader] {name}.on_load() error: {e}")
        print(f"[ModuleLoader] Loaded: {name}  tools={list(tools.keys())}  agents={len(agents)}")
        return {"mod": mod, "tools": tools, "agents": agents,
                "name": name, "path": path,
                "mtime": os.path.getmtime(path), "hash": _file_hash(path)}
    except Exception as e:
        print(f"[ModuleLoader] Failed to load {path}: {e}")
        traceback.print_exc()
        return None


def reload_all() -> Dict[str, Any]:
    """Scan modules dir, load new or changed modules, unload deleted ones."""
    os.makedirs(MODULES_DIR, exist_ok=True)
    current_paths = set()
    loaded_names = []
    errors = []

    for fname in sorted(os.listdir(MODULES_DIR)):
        if not fname.endswith(".py") or fname.startswith("_"):
            continue
        path = os.path.join(MODULES_DIR, fname)
        current_paths.add(path)
        cur_hash = _file_hash(path)
        prev = _loaded.get(path)
        if prev and prev["hash"] == cur_hash:
            continue  # unchanged
        rec = _load_module(path)
        if rec:
            with _lock:
                _loaded[path] = rec
                _extra_tools.update(rec["tools"])
            loaded_names.append(rec["name"])
        else:
            errors.append(fname)

    # Unload deleted modules
    for path in list(_loaded.keys()):
        if path not in current_paths:
            with _lock:
                rec = _loaded.pop(path, {})
                for k in rec.get("tools", {}):
                    _extra_tools.pop(k, None)
            print(f"[ModuleLoader] Unloaded: {rec.get('name','?')}")

    return {"loaded": loaded_names, "errors": errors,
            "total": len(_loaded), "tools": list(_extra_tools.keys())}


def get_extra_tools() -> Dict[str, Callable]:
    with _lock:
        return dict(_extra_tools)


def get_module_list() -> list:
    with _lock:
        return [
            {"name": r["name"], "path": r["path"],
             "tools": list(r.get("tools", {}).keys()),
             "agents": len(r.get("agents", []))}
            for r in _loaded.values()
        ]


def _poll_loop():
    """Background thread: reload modules every _poll_interval seconds."""
    while True:
        time.sleep(_poll_interval)
        try:
            result = reload_all()
            if result["loaded"]:
                print(f"[ModuleLoader] Auto-reloaded: {result['loaded']}")
        except Exception as e:
            print(f"[ModuleLoader] Poll error: {e}")


def start_background_watcher():
    """Start the background module watcher (call once at app startup)."""
    os.makedirs(MODULES_DIR, exist_ok=True)
    # Initial load
    try:
        reload_all()
    except Exception as e:
        print(f"[ModuleLoader] Initial load error: {e}")
    t = threading.Thread(target=_poll_loop, daemon=True, name="ModuleLoader")
    t.start()
    print(f"[ModuleLoader] Watcher started — polling every {_poll_interval}s")
