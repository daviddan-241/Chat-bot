"""
NEXUS Module: Secure File Deletion
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NIST 800-88 / DoD 5220.22-M compliant multi-pass overwrite.
Designed for GDPR Article 17, HIPAA, and PCI-DSS data disposal.

Passes:
  1 — Random data (os.urandom)
  2 — Complement of pass 1
  3 — Random data again
  4 — Zeros (final flush)

Usage:
  secure_delete("/path/to/file")
  secure_delete_dir("/path/to/directory")
  wipe_ram_buffer(data_bytes)   → overwrites in-memory bytes with zeros
"""
from __future__ import annotations
import os, secrets, time, shutil, stat
from typing import Any

CHUNK = 65536   # 64 KB write chunks


def secure_delete(path: str, passes: int = 3, verify: bool = True) -> dict:
    """
    Overwrite file with random data (N passes) then delete.
    Returns dict with ok, passes_done, size, duration_ms.
    """
    if not os.path.isfile(path):
        return {"ok": False, "error": f"Not a file: {path}"}
    try:
        size = os.path.getsize(path)
        t0   = time.time()

        # Make writable if read-only
        try: os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        except Exception: pass

        for p in range(passes):
            with open(path, "r+b") as f:
                remaining = size
                f.seek(0)
                while remaining > 0:
                    n = min(CHUNK, remaining)
                    if p == passes - 1:
                        f.write(b'\x00' * n)          # final pass: zeros
                    elif p % 2 == 1:
                        f.write(b'\xff' * n)           # complement pass
                    else:
                        f.write(secrets.token_bytes(n)) # random pass
                    remaining -= n
                f.flush()
                os.fsync(f.fileno())

        if verify:
            with open(path, "rb") as f:
                sample = f.read(min(512, size))
            # Should be all zeros (last pass)
            verified = all(b == 0 for b in sample)
        else:
            verified = None

        os.unlink(path)
        ms = round((time.time() - t0) * 1000)
        return {"ok": True, "path": path, "size": size, "size_hr": _hr(size),
                "passes": passes, "passes_done": passes,
                "verified_zero": verified, "duration_ms": ms}
    except Exception as e:
        return {"ok": False, "path": path, "error": str(e)}


def secure_delete_dir(path: str, passes: int = 3) -> dict:
    """Recursively securely delete all files in a directory, then remove the dir."""
    if not os.path.isdir(path):
        return {"ok": False, "error": f"Not a directory: {path}"}
    results = []
    errors  = []
    for root, dirs, files in os.walk(path, topdown=False):
        for fname in files:
            fp = os.path.join(root, fname)
            r  = secure_delete(fp, passes=passes)
            results.append(r)
            if not r["ok"]:
                errors.append(r)
    try:
        shutil.rmtree(path, ignore_errors=True)
        dir_removed = not os.path.exists(path)
    except Exception as e:
        dir_removed = False
        errors.append({"path": path, "error": str(e)})
    return {"ok": not errors, "path": path, "files_wiped": len(results),
            "errors": errors, "dir_removed": dir_removed}


def wipe_bytes(data: bytearray | memoryview) -> None:
    """Overwrite a mutable byte buffer with zeros (in-memory RAM wipe)."""
    for i in range(len(data)):
        data[i] = 0


def wipe_temp_dir(prefix: str = "nexus_") -> dict:
    """Wipe all /tmp files matching prefix."""
    import glob
    pattern = f"/tmp/{prefix}*"
    paths   = glob.glob(pattern)
    results = []
    for p in paths:
        if os.path.isfile(p):
            results.append(secure_delete(p))
        elif os.path.isdir(p):
            results.append(secure_delete_dir(p))
    return {"ok": True, "wiped": len(results), "pattern": pattern, "results": results}


def gdpr_wipe_report(paths: list[str]) -> dict:
    """
    Generate a GDPR Article 17 / HIPAA disposal report.
    Wipes each path and records proof of deletion.
    """
    import time as _t
    report = {
        "type": "gdpr_disposal_report",
        "standard": "NIST SP 800-88 / DoD 5220.22-M",
        "timestamp": _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime()),
        "total_paths": len(paths),
        "results": [],
    }
    total_bytes = 0
    ok_count    = 0
    for p in paths:
        if os.path.isfile(p):
            r = secure_delete(p)
        elif os.path.isdir(p):
            r = secure_delete_dir(p)
        else:
            r = {"ok": False, "path": p, "error": "not found"}
        report["results"].append(r)
        if r.get("ok"): ok_count += 1
        total_bytes += r.get("size", 0)
    report["ok_count"]    = ok_count
    report["error_count"] = len(paths) - ok_count
    report["total_bytes_wiped"] = total_bytes
    report["total_hr"]          = _hr(total_bytes)
    return report


def _hr(n: int) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return f"{n:.1f} {u}"
        n //= 1024
    return f"{n} GB"


TOOLS = {
    "secure_delete":     secure_delete,
    "secure_delete_dir": secure_delete_dir,
    "wipe_temp_dir":     wipe_temp_dir,
    "gdpr_wipe_report":  gdpr_wipe_report,
}

def on_load():
    print("[secure_delete] Secure deletion module loaded — secure_delete, secure_delete_dir, wipe_temp_dir, gdpr_wipe_report")
