"""
NEXUS UPTIME MONITOR + SELF-PING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Keeps deployed projects (and NEXUS itself) awake and monitored.

  • add(url)            -> register a URL to monitor + keep alive
  • A background pinger hits every registered URL every PING_INTERVAL seconds
    (default 240s — under Render free's 15-min sleep), recording status/latency.
  • list()             -> current monitors with last status/uptime%
  • Self-ping: NEXUS pings its own /health so the instance never sleeps.

Stored on disk so monitors survive restarts.
"""

from __future__ import annotations
import json
import os
import threading
import time
import urllib.request
from typing import Dict, Any, List

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FILE = os.path.join(_DIR, "uptime.json")
_LOCK = threading.Lock()
PING_INTERVAL = int(os.environ.get("UPTIME_PING_INTERVAL", "240"))


def _load() -> List[Dict[str, Any]]:
    if not os.path.exists(_FILE):
        return []
    try:
        with open(_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save(mons: List[Dict[str, Any]]):
    try:
        with open(_FILE, "w") as f:
            json.dump(mons, f)
    except Exception:
        pass


def add(url: str, name: str = "") -> Dict[str, Any]:
    if not url.startswith("http"):
        url = "https://" + url
    with _LOCK:
        mons = _load()
        for m in mons:
            if m["url"] == url:
                return {"ok": True, "already": True, "monitor": m}
        m = {"url": url, "name": name or url, "added": time.time(),
             "checks": 0, "up": 0, "last_status": None, "last_ms": None,
             "last_check": None}
        mons.append(m)
        _save(mons)
    return {"ok": True, "monitor": m}


def remove(url: str) -> Dict[str, Any]:
    with _LOCK:
        mons = [m for m in _load() if m["url"] != url]
        _save(mons)
    return {"ok": True}


def list_monitors() -> Dict[str, Any]:
    mons = _load()
    for m in mons:
        m["uptime_pct"] = round(100 * m["up"] / m["checks"], 1) if m["checks"] else None
    return {"monitors": mons, "ping_interval": PING_INTERVAL}


def _ping_one(url: str) -> Dict[str, Any]:
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "NEXUS-Uptime/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception:
        status = 0
    return {"status": status, "ms": int((time.time() - t0) * 1000)}


def check_now(url: str) -> Dict[str, Any]:
    res = _ping_one(url)
    with _LOCK:
        mons = _load()
        for m in mons:
            if m["url"] == url:
                m["checks"] += 1
                if 200 <= (res["status"] or 0) < 400:
                    m["up"] += 1
                m["last_status"] = res["status"]
                m["last_ms"] = res["ms"]
                m["last_check"] = time.time()
        _save(mons)
    return {"ok": True, **res}


# ── background pinger ──
def _pinger():
    while True:
        try:
            mons = _load()
            for m in mons:
                check_now(m["url"])
            # self-ping to keep the NEXUS instance awake
            self_url = os.environ.get("SELF_URL") or os.environ.get("RENDER_EXTERNAL_URL")
            if self_url:
                _ping_one(self_url.rstrip("/") + "/health")
        except Exception:
            pass
        time.sleep(PING_INTERVAL)


_started = False


def start_pinger():
    global _started
    if _started:
        return
    _started = True
    try:
        threading.Thread(target=_pinger, daemon=True).start()
    except Exception:
        pass


try:
    start_pinger()
except Exception:
    pass
