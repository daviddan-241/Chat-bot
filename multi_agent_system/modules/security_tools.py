"""
NEXUS Module: Security Tools
Extra tools auto-loaded from /modules/security_tools.py
"""
import subprocess, os, urllib.request, json, time

def port_scan(host: str, ports: str = "1-1000", timeout: int = 30) -> dict:
    """Run nmap port scan on host. Requires nmap installed."""
    try:
        cmd = ["nmap", "-T4", "--open", "-p", ports, host]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"ok": True, "tool": "port_scan", "host": host, "ports": ports,
                "output": r.stdout + r.stderr, "returncode": r.returncode}
    except FileNotFoundError:
        return {"ok": False, "tool": "port_scan", "error": "nmap not installed. Run: apt install nmap"}
    except Exception as e:
        return {"ok": False, "tool": "port_scan", "error": str(e)}

def whois_lookup(domain: str) -> dict:
    """WHOIS lookup for a domain."""
    try:
        r = subprocess.run(["whois", domain], capture_output=True, text=True, timeout=20)
        return {"ok": True, "tool": "whois", "domain": domain, "output": r.stdout[:4000]}
    except Exception as e:
        return {"ok": False, "tool": "whois", "domain": domain, "error": str(e)}

def dns_lookup(host: str, record: str = "A") -> dict:
    """DNS lookup using dig."""
    try:
        r = subprocess.run(["dig", "+short", host, record], capture_output=True, text=True, timeout=10)
        return {"ok": True, "tool": "dns_lookup", "host": host, "record": record,
                "result": r.stdout.strip(), "raw": r.stdout}
    except Exception as e:
        return {"ok": False, "tool": "dns_lookup", "error": str(e)}

def http_headers(url: str) -> dict:
    """Fetch HTTP headers from a URL."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "NEXUS-Security/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            hdrs = dict(r.headers)
        return {"ok": True, "tool": "http_headers", "url": url, "status": r.status, "headers": hdrs}
    except Exception as e:
        return {"ok": False, "tool": "http_headers", "url": url, "error": str(e)}

def extract_archive(path: str, dest: str = "/tmp/nexus_extracted") -> dict:
    """Extract ZIP/TAR/GZ archives."""
    import zipfile, tarfile, os
    os.makedirs(dest, exist_ok=True)
    try:
        if path.endswith(".zip"):
            with zipfile.ZipFile(path, "r") as z:
                z.extractall(dest)
                names = z.namelist()
        elif path.endswith((".tar.gz", ".tgz", ".tar.bz2", ".tar")):
            with tarfile.open(path, "r:*") as t:
                t.extractall(dest)
                names = t.getnames()
        else:
            r = subprocess.run(["7z", "x", path, f"-o{dest}", "-y"],
                               capture_output=True, text=True, timeout=30)
            names = [dest]
        return {"ok": True, "tool": "extract_archive", "path": path, "dest": dest, "files": names[:50]}
    except Exception as e:
        return {"ok": False, "tool": "extract_archive", "path": path, "error": str(e)}

TOOLS = {
    "port_scan": port_scan,
    "whois_lookup": whois_lookup,
    "dns_lookup": dns_lookup,
    "http_headers": http_headers,
    "extract_archive": extract_archive,
}

def on_load():
    print("[security_tools] Security tools module loaded — port_scan, whois, dns, http_headers, extract_archive")
