"""
NEXUS Module: EDR Detection Validator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generates benign test telemetry events that a properly configured
EDR/SIEM should detect and alert on.

Purpose: Purple-team validation — confirm your detection stack sees
these patterns. None of these actions harm the system.

Test categories:
  1. Process telemetry  — spawn child processes EDR should log
  2. Network telemetry  — outbound connections to test endpoints
  3. File telemetry     — create/modify/delete files in watched dirs
  4. Memory telemetry   — anonymous memory regions (memfd) on Linux
  5. Command obfuscation — base64-encoded command execution patterns

All payloads are harmless (echo/printf/date). This is the pattern that matters.
"""
from __future__ import annotations
import os, subprocess, base64, time, uuid, tempfile, platform
from typing import Iterator

_IS_LINUX   = platform.system() == "Linux"
_IS_WINDOWS = platform.system() == "Windows"

SAFE_PAYLOAD = "echo NEXUS-EDR-VALIDATION-OK"

def _run(cmd: str, timeout: int = 10) -> dict:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return {"ok": True, "cmd": cmd, "output": (r.stdout + r.stderr).strip()[:500],
                "returncode": r.returncode}
    except subprocess.TimeoutExpired:
        return {"ok": False, "cmd": cmd, "output": f"Timeout ({timeout}s)"}
    except Exception as e:
        return {"ok": False, "cmd": cmd, "output": str(e)}


def test_process_telemetry() -> dict:
    """
    Spawn child processes EDR should detect as suspicious ancestry chains.
    Pattern: shell → interpreter → network tool
    """
    results = []
    results.append(_run(SAFE_PAYLOAD))
    # Common interpreter invocation patterns EDR watches for
    results.append(_run("python3 -c 'import os; print(\"NEXUS-PROC-TEST\")'"))
    results.append(_run("perl -e 'print \"NEXUS-PROC-TEST\\n\"'" if _IS_LINUX else "cmd /c echo NEXUS-PROC-TEST"))
    results.append(_run("bash -c 'echo NEXUS-PROCESS-CHAIN'"))
    return {"test": "process_telemetry", "description": "Child process spawning patterns",
            "results": results, "detect_expected": True}


def test_network_telemetry() -> dict:
    """
    Outbound connections to well-known IP ranges — EDR should log these.
    Uses only public, benign endpoints (DNS resolvers, time servers).
    """
    results = []
    # DNS query — should appear in network logs
    results.append(_run("dig +short google.com A 2>&1 || nslookup google.com 2>&1"))
    # HTTP to a known endpoint
    results.append(_run("curl -s --max-time 5 -o /dev/null -w '%{http_code}' https://1.1.1.1"))
    # ICMP — should appear in network telemetry
    results.append(_run("ping -c 1 -W 2 8.8.8.8 2>&1"))
    return {"test": "network_telemetry", "description": "Outbound network connections (DNS, ICMP, HTTP)",
            "results": results, "detect_expected": True}


def test_file_telemetry() -> dict:
    """
    Create/modify/delete files in locations EDR monitors.
    Uses temp dir — no persistent changes.
    """
    results = []
    tmp  = tempfile.gettempdir()
    fname = os.path.join(tmp, f"nexus_edr_test_{uuid.uuid4().hex[:8]}.sh")
    # Create executable script in /tmp (watched by EDR)
    try:
        with open(fname, "w") as f:
            f.write("#!/bin/bash\necho NEXUS-FILE-TELEMETRY\n")
        os.chmod(fname, 0o755)
        results.append({"action": "create", "path": fname, "ok": True})
        r = _run(f"bash {fname}")
        results.append({**r, "action": "execute"})
    except Exception as e:
        results.append({"action": "create", "ok": False, "error": str(e)})
    finally:
        try: os.unlink(fname)
        except Exception: pass
    return {"test": "file_telemetry", "description": "Executable script create/execute/delete in /tmp",
            "results": results, "detect_expected": True}


def test_command_obfuscation() -> dict:
    """
    Execute commands via base64 encoding — tests if SIEM decodes and alerts.
    This is a standard purple-team pattern for SIEM validation.
    """
    results = []
    safe_cmd = "echo NEXUS-OBFUSCATION-VALIDATION"
    encoded  = base64.b64encode(safe_cmd.encode()).decode()
    # Standard base64 pipe pattern
    results.append(_run(f"echo {encoded} | base64 -d | sh"))
    # Bash -c with base64 decoding
    results.append(_run(f'bash -c "$(echo {encoded} | base64 -d)"'))
    return {"test": "command_obfuscation", "description": "Base64-encoded command execution (SIEM decode validation)",
            "encoded_payload": encoded,
            "decoded_payload": safe_cmd,
            "results": results, "detect_expected": True}


def test_memory_telemetry() -> dict:
    """
    Create anonymous memory-mapped files (Linux memfd_create) and named pipes.
    Validates that your kernel telemetry captures fileless execution patterns.
    Payload: benign echo command.
    """
    if not _IS_LINUX:
        return {"test": "memory_telemetry", "skipped": True, "reason": "Linux only"}
    results = []
    # Test memfd-style execution using Python ctypes (safe, prints to stdout only)
    py_script = (
        "import ctypes, os\n"
        "libc = ctypes.CDLL(None)\n"
        "fd = libc.memfd_create(b'nexus_edr_test', 0)\n"
        "if fd >= 0:\n"
        "    os.write(fd, b'#!/bin/sh\\necho NEXUS-MEMFD-TELEMETRY\\n')\n"
        "    os.lseek(fd, 0, 0)\n"
        "    import subprocess\n"
        "    r = subprocess.run([f'/proc/self/fd/{fd}'], capture_output=True, text=True, timeout=5)\n"
        "    print(r.stdout.strip())\n"
        "    os.close(fd)\n"
        "else:\n"
        "    print('memfd_create not available')\n"
    )
    results.append(_run(f"python3 -c '{py_script}'", timeout=10))
    return {"test": "memory_telemetry",
            "description": "Anonymous memory fd (memfd_create) — fileless pattern for kernel telemetry validation",
            "results": results, "detect_expected": True,
            "note": "If your EDR logs /proc/self/fd/* executions, this test was detected"}


def test_jitter_simulation() -> dict:
    """
    Make network requests with randomised delays and user-agent spoofing.
    Validates that your SIEM traffic analysis detects beaconing-with-jitter patterns.
    """
    import random, urllib.request
    results = []
    agents = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "curl/7.88.1",
    ]
    for i in range(3):
        jitter = round(random.uniform(0.5, 2.5), 2)
        time.sleep(jitter)
        agent = random.choice(agents)
        try:
            req = urllib.request.Request("https://1.1.1.1/cdn-cgi/trace",
                                          headers={"User-Agent": agent})
            with urllib.request.urlopen(req, timeout=5) as r:
                body = r.read(200).decode()
            results.append({"ok": True, "jitter_s": jitter, "agent": agent[:40], "status": r.status})
        except Exception as e:
            results.append({"ok": False, "jitter_s": jitter, "agent": agent[:40], "error": str(e)})
    return {"test": "jitter_simulation",
            "description": "Randomised delay + UA spoofing — validates SIEM beaconing detection",
            "results": results, "detect_expected": True}


def run_all_tests() -> Iterator[dict]:
    """Run all EDR validation tests sequentially, yielding results."""
    tests = [
        ("Process Telemetry",     test_process_telemetry),
        ("Network Telemetry",     test_network_telemetry),
        ("File Telemetry",        test_file_telemetry),
        ("Command Obfuscation",   test_command_obfuscation),
        ("Memory Telemetry",      test_memory_telemetry),
        ("Jitter Simulation",     test_jitter_simulation),
    ]
    session_id = uuid.uuid4().hex[:8].upper()
    yield {"type": "start", "session": session_id, "tests": len(tests),
           "warning": "All payloads are benign. Review EDR/SIEM alerts after running."}
    for name, fn in tests:
        yield {"type": "test_start", "name": name}
        try:
            result = fn()
        except Exception as e:
            result = {"test": name, "ok": False, "error": str(e)}
        yield {"type": "test_result", "name": name, **result}
    yield {"type": "complete", "session": session_id,
           "summary": "Compare these events against your EDR/SIEM alert log to identify detection gaps."}


TOOLS = {
    "edr_test_process":     test_process_telemetry,
    "edr_test_network":     test_network_telemetry,
    "edr_test_file":        test_file_telemetry,
    "edr_test_obfuscation": test_command_obfuscation,
    "edr_test_memory":      test_memory_telemetry,
    "edr_test_jitter":      test_jitter_simulation,
    "edr_run_all":          lambda: list(run_all_tests()),
}

def on_load():
    print("[edr_validator] EDR validation module loaded — 7 test tools")
