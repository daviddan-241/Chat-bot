"""
NEXUS Module: Automated Security Test Workflow Engine
Auto-loaded from /modules/auto_workflow.py

Executes phased security assessments automatically:
  Phase 1: Asset Discovery
  Phase 2: Service Enumeration
  Phase 3: Vulnerability Identification
  Phase 4: Controlled Validation
  Phase 5: Privilege Verification
  Phase 6: Lateral Path Analysis
  Phase 7: Data Discovery
  Phase 8: Report Generation

All targets must be listed in scope.txt. Operations are logged to memory only
(not written to persistent storage). Use only on systems you own or have written
authorization to test.
"""
from __future__ import annotations
import os, re, subprocess, time, json, threading, uuid
from typing import Generator, Optional

_SCOPE_FILE = os.environ.get("SCOPE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scope.txt"))
_sessions: dict[str, dict] = {}   # RAM-only, cleared on restart
_lock = threading.Lock()


def load_scope() -> list[str]:
    """Load allowed targets from scope.txt."""
    try:
        if os.path.exists(_SCOPE_FILE):
            with open(_SCOPE_FILE) as f:
                return [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except Exception:
        pass
    return []


def in_scope(target: str) -> bool:
    """Check if a target is within the defined scope."""
    scope = load_scope()
    if not scope:
        return False
    target = target.strip().lower()
    for entry in scope:
        if entry.lower() == target or target.endswith("." + entry.lower()):
            return True
        if re.match(r"^\d+\.\d+\.\d+\.\d+/\d+$", entry):
            import ipaddress
            try:
                net = ipaddress.ip_network(entry, strict=False)
                addr = ipaddress.ip_address(target)
                if addr in net: return True
            except Exception: pass
        if entry == target: return True
    return False


def _run(cmd: str, timeout: int = 60) -> dict:
    """Run a shell command safely, return output dict."""
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return {"ok": r.returncode == 0, "output": (r.stdout + r.stderr)[:8000],
                "cmd": cmd, "returncode": r.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": f"Timeout after {timeout}s", "cmd": cmd}
    except Exception as e:
        return {"ok": False, "output": str(e), "cmd": cmd}


PHASES = [
    {
        "id": 1, "name": "Asset Discovery",
        "desc": "Identify live hosts and basic network topology",
        "cmds": [
            "ping -c 2 -W 1 {target} && echo ALIVE || echo DOWN",
            "nmap -sn {target} --open 2>&1 | head -30",
        ]
    },
    {
        "id": 2, "name": "Service Enumeration",
        "desc": "Detect open ports and running services",
        "cmds": [
            "nmap -T4 -F --open {target} 2>&1",
            "nmap -sV -p 22,80,443,8080,3306,5432,6379,27017 {target} 2>&1",
        ]
    },
    {
        "id": 3, "name": "Vulnerability Identification",
        "desc": "Run basic vulnerability checks against discovered services",
        "cmds": [
            "nmap --script=vulners -sV {target} 2>&1 | head -100",
            "curl -sI --max-time 8 http://{target} 2>&1 | head -30",
            "curl -sI --max-time 8 https://{target} 2>&1 | head -30",
        ]
    },
    {
        "id": 4, "name": "Controlled Validation",
        "desc": "Validate identified findings with safe probes",
        "cmds": [
            "nmap -sV --script=http-title,http-headers {target} 2>&1 | head -50",
            "curl -s --max-time 10 http://{target}/robots.txt 2>&1",
        ]
    },
    {
        "id": 5, "name": "SSL/TLS Assessment",
        "desc": "Check certificate validity, ciphers, and TLS configuration",
        "cmds": [
            "echo | openssl s_client -connect {target}:443 -brief 2>&1 | head -20",
            "nmap --script=ssl-cert,ssl-enum-ciphers -p 443 {target} 2>&1 | head -60",
        ]
    },
    {
        "id": 6, "name": "DNS & Infrastructure Analysis",
        "desc": "Gather DNS records and infrastructure data",
        "cmds": [
            "dig +short {target} A AAAA MX TXT 2>&1",
            "whois {target} 2>&1 | head -40",
        ]
    },
    {
        "id": 7, "name": "HTTP Security Headers Review",
        "desc": "Check for missing or misconfigured security headers",
        "cmds": [
            "curl -sI --max-time 10 http://{target} 2>&1",
            "curl -sI --max-time 10 https://{target} 2>&1",
        ]
    },
    {
        "id": 8, "name": "Report Generation",
        "desc": "Compile findings into a structured assessment report",
        "cmds": []  # Generated from results
    },
]


def generate_report(target: str, results: list[dict]) -> str:
    lines = [
        f"# Security Assessment Report",
        f"**Target:** {target}",
        f"**Date:** {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        f"**Session:** {uuid.uuid4().hex[:8].upper()}",
        f"**Phases Executed:** {len(results)}",
        "",
        "---",
        "",
    ]
    for phase in results:
        lines.append(f"## Phase {phase['id']}: {phase['name']}")
        lines.append(f"*{phase['desc']}*")
        lines.append("")
        for cmd_result in phase.get("results", []):
            lines.append(f"```\n$ {cmd_result['cmd']}\n{cmd_result['output'][:1000]}\n```")
        lines.append("")
    lines.extend([
        "---",
        "",
        "**⚠️ AUTHORISED TESTING ONLY** — This report is for internal security validation purposes.",
        "All actions were performed within defined scope with proper authorization.",
    ])
    return "\n".join(lines)


def run_workflow(target: str, session_id: str | None = None) -> Generator[dict, None, None]:
    """
    Run the full assessment workflow against target.
    Yields phase result dicts as each phase completes.
    Target MUST be in scope.txt.
    """
    if not in_scope(target):
        scope = load_scope()
        yield {
            "type": "error",
            "message": f"Target '{target}' is NOT in scope.txt. Current scope: {scope or ['(empty)']}\n\n"
                       f"Add '{target}' to scope.txt to authorise testing.",
        }
        return

    sid = session_id or uuid.uuid4().hex
    with _lock:
        _sessions[sid] = {"target": target, "started": time.time(), "phases": [], "status": "running"}

    yield {"type": "start", "session_id": sid, "target": target,
           "phases": len(PHASES),
           "warning": "⚠️ This tool is for AUTHORISED security testing only. Ensure written permission."}

    all_results = []
    for phase in PHASES:
        yield {"type": "phase_start", "phase": phase["id"], "name": phase["name"], "desc": phase["desc"]}
        phase_results = []

        if phase["id"] == 8:
            report = generate_report(target, all_results)
            yield {"type": "phase_result", "phase": 8, "name": "Report Generation",
                   "output": report, "ok": True}
            all_results.append({**phase, "results": [{"cmd": "generate_report", "output": report, "ok": True}]})
            continue

        for cmd_tmpl in phase["cmds"]:
            cmd = cmd_tmpl.format(target=target)
            yield {"type": "cmd_start", "phase": phase["id"], "cmd": cmd}
            res = _run(cmd, timeout=60)
            phase_results.append(res)
            yield {"type": "cmd_result", "phase": phase["id"], "cmd": cmd,
                   "output": res["output"], "ok": res["ok"]}
            time.sleep(0.5)   # Rate limit between commands

        all_results.append({**phase, "results": phase_results})
        with _lock:
            if sid in _sessions:
                _sessions[sid]["phases"].append({"id": phase["id"], "name": phase["name"],
                                                  "done": True, "time": time.time()})
        yield {"type": "phase_done", "phase": phase["id"], "name": phase["name"]}

    with _lock:
        if sid in _sessions:
            _sessions[sid]["status"] = "complete"
            _sessions[sid]["finished"] = time.time()

    yield {"type": "complete", "session_id": sid, "target": target,
           "phases_done": len(PHASES), "duration_s": round(time.time() - _sessions.get(sid, {}).get("started", time.time()), 1)}


def add_to_scope(target: str) -> dict:
    """Add a target to scope.txt."""
    os.makedirs(os.path.dirname(_SCOPE_FILE) if os.path.dirname(_SCOPE_FILE) else ".", exist_ok=True)
    try:
        existing = load_scope()
        if target in existing:
            return {"ok": True, "message": f"'{target}' already in scope", "scope": existing}
        with open(_SCOPE_FILE, "a") as f:
            f.write(f"\n{target}")
        return {"ok": True, "message": f"Added '{target}' to scope", "scope": load_scope()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_scope() -> list[str]:
    return load_scope()


TOOLS = {
    "run_security_workflow": lambda target: list(run_workflow(target)),
    "add_to_scope": add_to_scope,
    "get_scope": lambda: {"scope": get_scope(), "scope_file": _SCOPE_FILE},
    "check_in_scope": lambda target: {"target": target, "in_scope": in_scope(target)},
}

def on_load():
    print("[auto_workflow] Security workflow engine loaded — run_security_workflow, add_to_scope, get_scope")
