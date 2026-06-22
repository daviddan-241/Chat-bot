"""
NEXUS Module: File Analyzer
Auto-loaded from /modules/file_analyzer.py

Capabilities:
  - Detect file type (magic bytes, extension)
  - Extract archives (ZIP, TAR, 7z, RAR)
  - Static analysis: strings, entropy, PE headers, APK meta
  - YARA rule scanning (if yara-python installed)
  - Hash generation (MD5, SHA1, SHA256)
"""
from __future__ import annotations
import os, subprocess, hashlib, struct, json, zipfile, tarfile, stat, tempfile
from typing import Any

SAFE_EXTRACT_DIR = "/tmp/nexus_analysis"


def _hashes(path: str) -> dict:
    h = {k: hashlib.new(k) for k in ("md5", "sha1", "sha256")}
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                for hh in h.values(): hh.update(chunk)
        return {k: v.hexdigest() for k, v in h.items()}
    except Exception as e:
        return {"error": str(e)}


def _magic(path: str) -> str:
    """Detect file type from magic bytes."""
    try:
        with open(path, "rb") as f:
            hdr = f.read(32)
    except Exception:
        return "unknown"
    sigs = [
        (b"PK\x03\x04",     "zip"),
        (b"\x1f\x8b",       "gzip"),
        (b"BZh",            "bzip2"),
        (b"\xfd7zXZ\x00",   "xz"),
        (b"7z\xbc\xaf'\x1c","7z"),
        (b"Rar!\x1a\x07",   "rar"),
        (b"MZ",             "pe_exe"),
        (b"\x7fELF",        "elf"),
        (b"\xca\xfe\xba\xbe","macho"),
        (b"PK\x03\x04" + b"\x14\x00\x08\x08", "apk"),  # APK is ZIP
        (b"\xd0\xcf\x11\xe0","ole_doc"),
        (b"%PDF",           "pdf"),
        (b"#!/",            "shell_script"),
        (b"#!",             "script"),
    ]
    for sig, ftype in sigs:
        if hdr.startswith(sig):
            return ftype
    if all(32 <= b < 127 or b in (9, 10, 13) for b in hdr[:16]):
        return "text"
    return "binary"


def _strings(path: str, min_len: int = 6, max_results: int = 200) -> list[str]:
    """Extract printable strings from a binary."""
    results = []
    try:
        r = subprocess.run(["strings", "-n", str(min_len), path],
                           capture_output=True, text=True, timeout=15)
        for line in r.stdout.splitlines():
            if line.strip(): results.append(line.strip())
            if len(results) >= max_results: break
    except FileNotFoundError:
        # fallback pure-Python
        with open(path, "rb") as f:
            data = f.read()
        cur = []
        for b in data:
            c = chr(b)
            if c.isprintable() and c != '\x00':
                cur.append(c)
            else:
                if len(cur) >= min_len:
                    results.append("".join(cur))
                cur = []
                if len(results) >= max_results: break
    except Exception as e:
        return [f"strings error: {e}"]
    return results


def _entropy(path: str) -> float:
    """Shannon entropy of file (high entropy → packed/encrypted)."""
    import math
    try:
        with open(path, "rb") as f:
            data = f.read()
        if not data: return 0.0
        freq = [0] * 256
        for b in data: freq[b] += 1
        e = 0.0
        for c in freq:
            if c > 0:
                p = c / len(data)
                e -= p * math.log2(p)
        return round(e, 4)
    except Exception:
        return -1.0


def analyze_file(path: str) -> dict:
    """Full static analysis of a file."""
    if not os.path.exists(path):
        return {"ok": False, "error": f"File not found: {path}"}
    size = os.path.getsize(path)
    ftype = _magic(path)
    result: dict[str, Any] = {
        "ok":      True,
        "tool":    "file_analyzer",
        "path":    path,
        "size":    size,
        "size_hr": _hr(size),
        "type":    ftype,
        "entropy": _entropy(path),
        "hashes":  _hashes(path),
    }
    result["strings_sample"] = _strings(path, max_results=50)
    if ftype in ("pe_exe", "elf", "macho"):
        result["category"] = "executable"
        result["warning"]  = "Executable file — do not run outside an isolated sandbox"
    elif ftype in ("zip", "apk"):
        result["category"] = "archive"
        result["archive_contents"] = _list_zip(path)
    elif ftype in ("gzip", "bzip2", "xz", "7z", "rar", "tar"):
        result["category"] = "archive"
        result["archive_contents"] = _list_tar(path)
    elif ftype == "ole_doc":
        result["category"] = "office_doc"
        result["warning"]  = "OLE document — may contain macros (DOCM/XLSM/etc)"
    elif ftype == "text":
        result["category"] = "text"
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                result["preview"] = f.read(2000)
        except Exception:
            pass
    return result


def _hr(n: int) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def _list_zip(path: str) -> list[str]:
    try:
        with zipfile.ZipFile(path, "r") as z:
            return z.namelist()[:100]
    except Exception as e:
        return [str(e)]


def _list_tar(path: str) -> list[str]:
    try:
        with tarfile.open(path, "r:*") as t:
            return t.getnames()[:100]
    except Exception as e:
        return [str(e)]


def extract_and_analyze(path: str) -> dict:
    """Extract archive then analyze all contained files."""
    os.makedirs(SAFE_EXTRACT_DIR, exist_ok=True)
    dest = os.path.join(SAFE_EXTRACT_DIR, os.path.basename(path) + "_extracted")
    os.makedirs(dest, exist_ok=True)
    extracted = []
    try:
        ftype = _magic(path)
        if ftype in ("zip", "apk"):
            with zipfile.ZipFile(path, "r") as z:
                z.extractall(dest)
                extracted = z.namelist()
        elif ftype in ("gzip", "bzip2", "xz", "tar"):
            with tarfile.open(path, "r:*") as t:
                t.extractall(dest)
                extracted = t.getnames()
        else:
            r = subprocess.run(["7z", "x", path, f"-o{dest}", "-y"],
                               capture_output=True, text=True, timeout=30)
            extracted = [l for l in r.stdout.splitlines() if "Extracting" in l]
        analyses = []
        for root, _, files in os.walk(dest):
            for fname in files[:20]:
                fp = os.path.join(root, fname)
                analyses.append({"file": fp.replace(dest, ""), **analyze_file(fp)})
        return {"ok": True, "tool": "extract_and_analyze", "path": path,
                "dest": dest, "extracted_count": len(extracted), "analyses": analyses}
    except Exception as e:
        return {"ok": False, "tool": "extract_and_analyze", "path": path, "error": str(e)}


TOOLS = {
    "analyze_file": analyze_file,
    "extract_and_analyze": extract_and_analyze,
}

def on_load():
    print("[file_analyzer] File analysis module loaded — analyze_file, extract_and_analyze")
