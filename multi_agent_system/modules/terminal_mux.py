"""
NEXUS Module: Terminal Multiplexer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real-time collaborative terminal — multiple participants type commands
and see streaming output simultaneously via SSE.

Roles & permissions
───────────────────
  owner     — all commands; manage session; invite/kick participants
  exploit   — offensive security tools + shell; no destructive fs ops
  recon     — passive/active information gathering only
  reporting — read-only; view all output; cannot execute

Sessions live in RAM (Redis-backed if available). TTL: 8 hours.
"""
from __future__ import annotations
import os, subprocess, threading, time, uuid, queue as _q, secrets
from typing import Iterator, Optional

# ── Role definitions ──────────────────────────────────────────────────────────
ROLES = ("owner", "exploit", "recon", "reporting")
ROLE_COLORS = {
    "owner":     "#FF6B6B",
    "exploit":   "#FFD93D",
    "recon":     "#6BCB77",
    "reporting": "#4DA8FF",
}
ROLE_ICONS = {
    "owner": "👑", "exploit": "⚔️", "recon": "🔭", "reporting": "📝",
}

# Recon: passive/active info gathering — no shell
_RECON_ALLOW = frozenset([
    "nmap", "dig", "nslookup", "whois", "host", "ping", "traceroute",
    "tracepath", "mtr", "curl", "wget", "nc", "netcat", "openssl",
    "sslscan", "sslyze", "nikto", "gobuster", "dirb", "whatweb",
    "dnsrecon", "fierce", "theHarvester", "amass", "subfinder",
    "httpx", "ffuf", "feroxbuster", "wfuzz",
    "python3", "python",   # for one-liner scripts
    "echo", "cat", "grep", "awk", "sed", "sort", "uniq", "wc",
    "head", "tail", "cut", "tr", "base64", "xxd", "hexdump",
    "file", "strings", "objdump", "readelf",
    "date", "id", "whoami", "uname", "uptime", "df", "free",
    "ip", "ifconfig", "ss", "netstat", "arp",
])

# Exploit: everything except destructive file-system ops
_EXPLOIT_BLOCK = frozenset([
    "mkfs", "fdisk", "parted", "shred",
    "rm -rf /", "rm -rf /*",   # checked as prefix
])

_BLOCK_PREFIXES_EXPLOIT = [
    "rm -rf /", "dd if=/dev/zero of=/dev/", "mkfs.", "fdisk /dev/",
]

_BLOCK_PREFIXES_RECON: list[str] = []   # recon uses allowlist, not blocklist


def _role_allows(role: str, cmd: str) -> tuple[bool, str]:
    """Return (allowed, reason)."""
    first = cmd.strip().split()[0] if cmd.strip() else ""
    if role == "reporting":
        return False, "reporting role is read-only — cannot execute commands"
    if role == "owner":
        return True, ""
    if role == "exploit":
        for prefix in _BLOCK_PREFIXES_EXPLOIT:
            if cmd.strip().startswith(prefix):
                return False, f"Blocked: destructive operation '{prefix}…' not allowed for exploit role"
        return True, ""
    if role == "recon":
        if first in _RECON_ALLOW or first == "":
            return True, ""
        return False, (f"'{first}' is not in the recon allowlist. "
                       f"Recon role allows: {', '.join(sorted(_RECON_ALLOW)[:12])}…")
    return False, f"Unknown role: {role}"


# ── Session store ─────────────────────────────────────────────────────────────
_sessions: dict[str, dict] = {}
_lock      = threading.Lock()
_MAX_HIST  = 2000   # max output lines stored per session


def _new_token() -> str:
    return secrets.token_urlsafe(24)


def create_session(name: str, owner_name: str = "owner") -> dict:
    sid         = uuid.uuid4().hex
    owner_token = _new_token()
    session = {
        "id":           sid,
        "name":         name[:80],
        "created":      time.time(),
        "expires_at":   time.time() + 8 * 3600,
        "owner_token":  owner_token,
        "participants": {
            owner_token: {
                "token":       owner_token,
                "role":        "owner",
                "name":        owner_name[:30],
                "joined":      time.time(),
                "last_active": time.time(),
                "color":       ROLE_COLORS["owner"],
                "icon":        ROLE_ICONS["owner"],
            }
        },
        "history":     [],          # list of {id, ts, role, name, cmd, output, color}
        "subscribers": {},          # token → Queue
        "_lock":       threading.Lock(),
    }
    with _lock:
        _sessions[sid] = session
    _broadcast(sid, {"type": "system", "message": f"Session '{name}' created",
                     "ts": time.time()})
    return {"session_id": sid, "owner_token": owner_token,
            "join_url": f"/nexus/mux/join/{sid}"}


def join_session(sid: str, role: str, participant_name: str) -> dict:
    s = _sessions.get(sid)
    if not s:
        return {"ok": False, "error": "Session not found"}
    if s["expires_at"] < time.time():
        return {"ok": False, "error": "Session expired"}
    if role not in ROLES:
        return {"ok": False, "error": f"Invalid role. Choose: {', '.join(ROLES)}"}
    token = _new_token()
    p = {"token": token, "role": role, "name": participant_name[:30],
         "joined": time.time(), "last_active": time.time(),
         "color": ROLE_COLORS[role], "icon": ROLE_ICONS[role]}
    with s["_lock"]:
        s["participants"][token] = p
    _broadcast(sid, {"type": "join", "name": participant_name,
                     "role": role, "color": ROLE_COLORS[role], "ts": time.time()})
    # Return last 100 history lines for immediate context
    hist = s["history"][-100:]
    return {"ok": True, "token": token, "role": role, "session_id": sid,
            "session_name": s["name"], "history": hist,
            "participants": _participants_slim(s)}


def leave_session(sid: str, token: str) -> dict:
    s = _sessions.get(sid)
    if not s:
        return {"ok": False, "error": "Session not found"}
    p = s["participants"].pop(token, None)
    if p:
        _broadcast(sid, {"type": "leave", "name": p["name"], "role": p["role"], "ts": time.time()})
    # Close subscriber queue
    with s["_lock"]:
        q = s["subscribers"].pop(token, None)
        if q:
            try: q.put_nowait(None)
            except Exception: pass
    return {"ok": True}


def _broadcast(sid: str, event: dict):
    s = _sessions.get(sid)
    if not s:
        return
    with s["_lock"]:
        qs = list(s["subscribers"].values())
    for q in qs:
        try: q.put_nowait(event)
        except _q.Full: pass


def _append_history(sid: str, entry: dict):
    s = _sessions.get(sid)
    if not s:
        return
    with s["_lock"]:
        s["history"].append(entry)
        if len(s["history"]) > _MAX_HIST:
            s["history"] = s["history"][-_MAX_HIST:]


def execute_command(sid: str, token: str, cmd: str,
                    timeout: int = 60) -> Iterator[dict]:
    """
    Execute cmd in the session, streaming output events.
    Yields dicts: {type, ...} — broadcast to all subscribers.
    """
    s = _sessions.get(sid)
    if not s:
        yield {"type": "error", "message": "Session not found"}
        return
    p = s["participants"].get(token)
    if not p:
        yield {"type": "error", "message": "Not a session participant — join first"}
        return
    role  = p["role"]
    name  = p["name"]
    color = p["color"]
    allowed, reason = _role_allows(role, cmd)
    if not allowed:
        ev = {"type": "denied", "cmd": cmd, "reason": reason,
              "role": role, "name": name, "color": color, "ts": time.time()}
        _broadcast(sid, ev)
        yield ev
        return

    cmd_id = uuid.uuid4().hex[:8]
    start  = time.time()
    start_ev = {"type": "cmd_start", "id": cmd_id, "cmd": cmd,
                "role": role, "name": name, "color": color, "ts": start}
    _broadcast(sid, start_ev)
    yield start_ev

    output_lines: list[str] = []
    try:
        proc = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True,
            bufsize=1, universal_newlines=True,
        )
        p["last_active"] = time.time()
        try:
            for raw_line in proc.stdout:
                line = raw_line.rstrip("\n")
                output_lines.append(line)
                ev = {"type": "output", "id": cmd_id, "line": line,
                      "role": role, "name": name, "color": color, "ts": time.time()}
                _broadcast(sid, ev)
                yield ev
            proc.wait(timeout=max(1, timeout - int(time.time() - start)))
        except subprocess.TimeoutExpired:
            proc.kill()
            ev = {"type": "timeout", "id": cmd_id, "timeout": timeout,
                  "ts": time.time()}
            _broadcast(sid, ev)
            yield ev
        rc = proc.returncode
    except Exception as e:
        rc = -1
        ev = {"type": "error", "id": cmd_id, "message": str(e), "ts": time.time()}
        _broadcast(sid, ev)
        yield ev

    end_ev = {"type": "cmd_end", "id": cmd_id, "returncode": rc,
              "duration_ms": round((time.time() - start) * 1000),
              "role": role, "name": name, "color": color, "ts": time.time()}
    _broadcast(sid, end_ev)
    yield end_ev

    _append_history(sid, {
        "id": cmd_id, "ts": start, "role": role, "name": name,
        "cmd": cmd, "output": "\n".join(output_lines[-200:]),
        "returncode": rc, "color": color,
    })


def subscribe(sid: str, token: str) -> tuple[Optional[_q.Queue], str]:
    """Register an SSE subscriber. Returns (queue, error)."""
    s = _sessions.get(sid)
    if not s:
        return None, "Session not found"
    if token not in s["participants"]:
        return None, "Invalid token — join the session first"
    q = _q.Queue(maxsize=2000)
    with s["_lock"]:
        s["subscribers"][token] = q
    return q, ""


def unsubscribe(sid: str, token: str):
    s = _sessions.get(sid)
    if not s:
        return
    with s["_lock"]:
        s["subscribers"].pop(token, None)


def list_sessions() -> list[dict]:
    now = time.time()
    return [
        {"id": s["id"], "name": s["name"], "created": s["created"],
         "expires_at": s["expires_at"], "expired": s["expires_at"] < now,
         "participants": len(s["participants"]),
         "history_lines": len(s["history"])}
        for s in _sessions.values()
    ]


def get_session(sid: str) -> Optional[dict]:
    s = _sessions.get(sid)
    if not s:
        return None
    return {"id": s["id"], "name": s["name"], "created": s["created"],
            "expires_at": s["expires_at"],
            "participants": _participants_slim(s),
            "history_count": len(s["history"])}


def session_history(sid: str, limit: int = 200) -> list[dict]:
    s = _sessions.get(sid)
    if not s:
        return []
    return s["history"][-limit:]


def _participants_slim(s: dict) -> list[dict]:
    return [{"name": p["name"], "role": p["role"], "color": p["color"],
             "icon": p["icon"], "joined": p["joined"]}
            for p in s["participants"].values()]


def close_session(sid: str, owner_token: str) -> dict:
    s = _sessions.get(sid)
    if not s:
        return {"ok": False, "error": "Not found"}
    if s["owner_token"] != owner_token:
        return {"ok": False, "error": "Only the owner can close a session"}
    _broadcast(sid, {"type": "session_closed", "ts": time.time()})
    # Drain all subscriber queues
    with s["_lock"]:
        for q in s["subscribers"].values():
            try: q.put_nowait(None)
            except Exception: pass
    _sessions.pop(sid, None)
    return {"ok": True}


# Purge expired sessions every 10 min
def _cleanup_loop():
    while True:
        time.sleep(600)
        now   = time.time()
        dead  = [sid for sid, s in list(_sessions.items()) if s["expires_at"] < now]
        for sid in dead:
            _sessions.pop(sid, None)

threading.Thread(target=_cleanup_loop, daemon=True, name="MuxCleanup").start()


TOOLS = {
    "mux_create":          create_session,
    "mux_join":            join_session,
    "mux_execute":         lambda sid, token, cmd: list(execute_command(sid, token, cmd)),
    "mux_sessions":        list_sessions,
    "mux_history":         session_history,
    "mux_role_allows":     _role_allows,
}

def on_load():
    print("[terminal_mux] Terminal multiplexer loaded — create/join/execute/stream with role-gating")
