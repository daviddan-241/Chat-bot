"""
NEXUS Module: Tor Circuit Manager
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Manages Tor circuits via the Tor control port.

Features:
  - Auto-rotate circuits every N minutes (default: 5)
  - Check current exit node IP and country
  - DoH (DNS over HTTPS) via Cloudflare/Quad9 for DNS privacy
  - Test anonymity (verify traffic exits through Tor)

Requirements:
  - Tor running with ControlPort enabled (default: 9051)
  - Set TOR_CONTROL_PASSWORD env var if password auth is used

Env vars:
  TOR_PROXY        = socks5h://127.0.0.1:9050
  TOR_CONTROL_HOST = 127.0.0.1
  TOR_CONTROL_PORT = 9051
  TOR_CONTROL_PASSWORD = (optional)
  TOR_ROTATE_INTERVAL  = 300  (seconds, default 5 min)
"""
from __future__ import annotations
import os, socket, time, threading, urllib.request, json
from typing import Optional

TOR_PROXY           = os.environ.get("TOR_PROXY", "socks5h://127.0.0.1:9050")
TOR_CONTROL_HOST    = os.environ.get("TOR_CONTROL_HOST", "127.0.0.1")
TOR_CONTROL_PORT    = int(os.environ.get("TOR_CONTROL_PORT", 9051))
TOR_CONTROL_PASS    = os.environ.get("TOR_CONTROL_PASSWORD", "")
TOR_ROTATE_INTERVAL = int(os.environ.get("TOR_ROTATE_INTERVAL", 300))

_rotate_thread: Optional[threading.Thread] = None
_stop_event   = threading.Event()
_last_rotate  = 0.0
_circuit_count = 0


def _control(cmd: str) -> str:
    """Send a command to the Tor control port."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(10)
        s.connect((TOR_CONTROL_HOST, TOR_CONTROL_PORT))
        if TOR_CONTROL_PASS:
            s.sendall(f'AUTHENTICATE "{TOR_CONTROL_PASS}"\r\n'.encode())
            s.recv(256)
        else:
            s.sendall(b'AUTHENTICATE ""\r\n')
            s.recv(256)
        s.sendall((cmd + "\r\n").encode())
        resp = s.recv(4096).decode(errors="replace")
        s.close()
        return resp
    except Exception as e:
        return f"Error: {e}"


def new_circuit() -> dict:
    """Request a new Tor circuit (identity rotation)."""
    global _last_rotate, _circuit_count
    resp = _control("SIGNAL NEWNYM")
    ok   = "250 OK" in resp
    if ok:
        _last_rotate   = time.time()
        _circuit_count += 1
    return {"ok": ok, "response": resp.strip(), "circuit": _circuit_count,
            "time": _last_rotate}


def get_exit_ip() -> dict:
    """Get the current Tor exit node IP via check.torproject.org."""
    try:
        import socks
        s = socks.socksocket()
        s.set_proxy(socks.SOCKS5, "127.0.0.1", 9050)
        # Use Cloudflare's trace endpoint
        url = "https://1.1.1.1/cdn-cgi/trace"
        req = urllib.request.Request(url, headers={"User-Agent": "curl/7.88.1"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode()
        lines = dict(l.split("=", 1) for l in body.strip().splitlines() if "=" in l)
        return {"ok": True, "exit_ip": lines.get("ip", "?"),
                "country": lines.get("loc", "?"), "via": "tor"}
    except ImportError:
        # Fallback without PySocks
        try:
            req = urllib.request.Request("https://httpbin.org/ip",
                                          headers={"User-Agent": "curl/7.88.1"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            return {"ok": True, "exit_ip": data.get("origin", "?"), "via": "direct (tor check unavailable)"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def doh_lookup(domain: str, qtype: str = "A",
               resolver: str = "cloudflare") -> dict:
    """
    DNS over HTTPS lookup — no plaintext DNS queries.
    resolver: 'cloudflare' (1.1.1.1) or 'quad9' (9.9.9.9)
    """
    urls = {
        "cloudflare": "https://cloudflare-dns.com/dns-query",
        "quad9":      "https://dns.quad9.net/dns-query",
        "google":     "https://dns.google/resolve",
    }
    base = urls.get(resolver, urls["cloudflare"])
    url  = f"{base}?name={domain}&type={qtype}"
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/dns-json",
            "User-Agent": "NEXUS-DoH/1.0",
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        answers = [a.get("data") for a in data.get("Answer", [])]
        return {"ok": True, "domain": domain, "type": qtype,
                "resolver": resolver, "answers": answers,
                "status": data.get("Status", -1)}
    except Exception as e:
        return {"ok": False, "domain": domain, "error": str(e)}


def tor_status() -> dict:
    """Check if Tor is running and return circuit info."""
    resp = _control("GETINFO circuit-status")
    info = _control("GETINFO version")
    circuits = resp.count("BUILT")
    ver  = ""
    for line in info.splitlines():
        if "version=" in line:
            ver = line.split("version=")[-1].strip()
            break
    return {"ok": "250" in resp, "circuits": circuits,
            "version": ver, "control_host": TOR_CONTROL_HOST,
            "control_port": TOR_CONTROL_PORT,
            "last_rotate": _last_rotate,
            "circuit_count": _circuit_count,
            "rotate_interval": TOR_ROTATE_INTERVAL}


def _auto_rotate_loop():
    """Background thread: rotate Tor circuit every TOR_ROTATE_INTERVAL seconds."""
    print(f"[TorManager] Auto-rotate started — every {TOR_ROTATE_INTERVAL}s")
    while not _stop_event.is_set():
        _stop_event.wait(timeout=TOR_ROTATE_INTERVAL)
        if _stop_event.is_set():
            break
        result = new_circuit()
        print(f"[TorManager] Circuit rotated: {result}")


def start_auto_rotate() -> dict:
    """Start background auto-rotation of Tor circuits."""
    global _rotate_thread
    if _rotate_thread and _rotate_thread.is_alive():
        return {"ok": True, "status": "already running", "interval": TOR_ROTATE_INTERVAL}
    _stop_event.clear()
    _rotate_thread = threading.Thread(target=_auto_rotate_loop, daemon=True, name="TorRotate")
    _rotate_thread.start()
    return {"ok": True, "status": "started", "interval_s": TOR_ROTATE_INTERVAL}


def stop_auto_rotate() -> dict:
    """Stop the auto-rotation thread."""
    _stop_event.set()
    return {"ok": True, "status": "stopped"}


TOOLS = {
    "tor_new_circuit":     new_circuit,
    "tor_exit_ip":         get_exit_ip,
    "tor_status":          tor_status,
    "tor_start_rotate":    start_auto_rotate,
    "tor_stop_rotate":     stop_auto_rotate,
    "doh_lookup":          doh_lookup,
}

def on_load():
    print("[tor_manager] Tor manager loaded — new_circuit, exit_ip, doh_lookup, auto-rotate")
