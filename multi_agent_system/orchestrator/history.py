"""
NEXUS CHAT HISTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Persistent conversation store so the user can reopen previous work.

Each conversation:
  {id, title, project_id, created_at, updated_at, messages:[{role, content, ts}]}

Stored as JSON on disk. Title is auto-generated from the first user message.
"""

from __future__ import annotations
import json
import os
import time
import uuid
from typing import Dict, Any, List

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FILE = os.path.join(_DIR, "conversations.json")


def _load() -> List[Dict[str, Any]]:
    if not os.path.exists(_FILE):
        return []
    try:
        with open(_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save(convos: List[Dict[str, Any]]):
    try:
        with open(_FILE, "w") as f:
            json.dump(convos, f)
    except Exception:
        pass


def list_conversations(project_id: str = None) -> Dict[str, Any]:
    convos = _load()
    if project_id and project_id != "all":
        convos = [c for c in convos if c.get("project_id") == project_id]
    # newest first; return lightweight previews (no full message bodies)
    convos = sorted(convos, key=lambda c: c.get("updated_at", 0), reverse=True)
    out = [{"id": c["id"], "title": c.get("title", "Untitled"),
            "project_id": c.get("project_id", "default"),
            "updated_at": c.get("updated_at", 0),
            "message_count": len(c.get("messages", []))} for c in convos]
    return {"conversations": out}


def get_conversation(cid: str) -> Dict[str, Any]:
    for c in _load():
        if c["id"] == cid:
            return {"ok": True, "conversation": c}
    return {"ok": False, "error": "not found"}


def create_conversation(project_id: str = "default", title: str = "") -> Dict[str, Any]:
    convos = _load()
    c = {"id": "c_" + uuid.uuid4().hex[:10],
         "title": title or "New Chat",
         "project_id": project_id,
         "created_at": time.time(),
         "updated_at": time.time(),
         "messages": []}
    convos.insert(0, c)
    _save(convos)
    return {"ok": True, "conversation": c}


def append_message(cid: str, role: str, content: str,
                   project_id: str = "default") -> Dict[str, Any]:
    convos = _load()
    target = None
    for c in convos:
        if c["id"] == cid:
            target = c
            break
    if target is None:
        # auto-create if missing
        target = {"id": cid or ("c_" + uuid.uuid4().hex[:10]),
                  "title": "New Chat", "project_id": project_id,
                  "created_at": time.time(), "updated_at": time.time(),
                  "messages": []}
        convos.insert(0, target)
    target.setdefault("messages", []).append(
        {"role": role, "content": content[:20000], "ts": time.time()})
    target["updated_at"] = time.time()
    # auto-title from first user message
    if (target.get("title") in ("", "New Chat")) and role == "user":
        target["title"] = content.strip().split("\n")[0][:48] or "New Chat"
    _save(convos)
    return {"ok": True, "id": target["id"], "title": target["title"]}


def rename(cid: str, title: str) -> Dict[str, Any]:
    convos = _load()
    for c in convos:
        if c["id"] == cid:
            c["title"] = title[:80]
            c["updated_at"] = time.time()
            _save(convos)
            return {"ok": True}
    return {"ok": False, "error": "not found"}


def delete(cid: str) -> Dict[str, Any]:
    convos = [c for c in _load() if c["id"] != cid]
    _save(convos)
    return {"ok": True}
