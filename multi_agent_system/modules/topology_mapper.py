"""
NEXUS Module: Network Topology Mapper
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Parses nmap/scan output into a graph data structure.
Frontend renders it as a live force-directed canvas graph.

Node types:
  host    — discovered IP or hostname
  port    — open port on a host
  service — identified service (e.g. nginx, openssh)

Edge types:
  has_port  — host → port
  runs      — port → service
"""
from __future__ import annotations
import re, time
from typing import Optional

_sessions: dict[str, dict] = {}   # topology_id → graph


def _new_graph(target: str) -> dict:
    return {
        "id":      target,
        "target":  target,
        "created": time.time(),
        "updated": time.time(),
        "nodes":   [],
        "edges":   [],
        "_nids":   set(),
        "_eids":   set(),
    }


def get_or_create(target: str) -> dict:
    if target not in _sessions:
        _sessions[target] = _new_graph(target)
    return _sessions[target]


def get(target: str) -> Optional[dict]:
    return _sessions.get(target)


def clear(target: str):
    if target in _sessions:
        _sessions[target] = _new_graph(target)


def _add_node(g: dict, nid: str, label: str, ntype: str, **meta) -> bool:
    if nid not in g["_nids"]:
        g["nodes"].append({"id": nid, "label": label, "type": ntype,
                            "ts": time.time(), **meta})
        g["_nids"].add(nid)
        g["updated"] = time.time()
        return True
    return False


def _add_edge(g: dict, src: str, dst: str, etype: str) -> bool:
    eid = f"{src}→{dst}"
    if eid not in g["_eids"]:
        g["edges"].append({"id": eid, "src": src, "dst": dst, "type": etype,
                            "ts": time.time()})
        g["_eids"].add(eid)
        g["updated"] = time.time()
        return True
    return False


# ── Parsers ───────────────────────────────────────────────────────────────────

_IP_RE      = re.compile(r'\b(\d{1,3}(?:\.\d{1,3}){3})\b')
_PORT_RE    = re.compile(r'(\d{1,5})/(\w+)\s+(\w+)\s+([\w/?.-]+)\s*(.*)')
_HOST_RE    = re.compile(r'Nmap scan report for (.+)')
_LATENCY_RE = re.compile(r'Host is up \(([^)]+)\)')

def parse_nmap(target: str, nmap_output: str) -> dict:
    """Parse nmap -sV output and update the topology graph."""
    g = get_or_create(target)
    current_host = None
    current_ip   = None

    for line in nmap_output.splitlines():
        line = line.strip()

        # Host line: "Nmap scan report for 192.168.1.1" or "Nmap scan report for host (192.168.1.1)"
        m = _HOST_RE.search(line)
        if m:
            host_str = m.group(1).strip()
            ips      = _IP_RE.findall(host_str)
            if ips:
                current_ip   = ips[0]
                current_host = host_str.split('(')[0].strip() or current_ip
            else:
                current_host = host_str
                current_ip   = host_str
            nid = f"host:{current_ip}"
            _add_node(g, nid, current_host, "host", ip=current_ip)
            continue

        # Port line: "80/tcp   open  http    nginx 1.24.0"
        m = _PORT_RE.match(line)
        if m and current_ip:
            port, proto, state, svc, version = m.groups()
            if state == "open":
                host_nid = f"host:{current_ip}"
                port_nid = f"port:{current_ip}:{port}/{proto}"
                _add_node(g, port_nid, f"{port}/{proto}", "port",
                          port=int(port), proto=proto, state=state,
                          service=svc.strip(), version=version.strip()[:60])
                _add_edge(g, host_nid, port_nid, "has_port")
                if svc and svc != "unknown":
                    svc_nid = f"svc:{svc.strip()}"
                    _add_node(g, svc_nid, svc.strip(), "service", version=version.strip()[:60])
                    _add_edge(g, port_nid, svc_nid, "runs")
            continue

    return _graph_slim(g)


def parse_generic(target: str, tool: str, output: str) -> dict:
    """
    Generic IP extractor — pull any IPs mentioned in output and add as host nodes.
    Used for tools other than nmap (ping, traceroute, dns, etc.)
    """
    g = get_or_create(target)
    for ip in set(_IP_RE.findall(output)):
        nid = f"host:{ip}"
        _add_node(g, nid, ip, "host", ip=ip, discovered_by=tool)
    return _graph_slim(g)


def ingest_workflow_event(target: str, event: dict) -> Optional[dict]:
    """
    Ingest a workflow streaming event.
    Called from the workflow SSE stream to auto-update topology.
    Returns updated graph if changed, None otherwise.
    """
    phase = event.get("phase", 0)
    cmd   = event.get("cmd", "").lower()
    out   = event.get("output", "")
    if not out:
        return None
    if "nmap" in cmd:
        return parse_nmap(target, out)
    if any(t in cmd for t in ["ping", "dig", "nslookup", "host ", "traceroute"]):
        return parse_generic(target, cmd.split()[0], out)
    # Try to extract IPs from any output
    ips = _IP_RE.findall(out)
    if ips:
        return parse_generic(target, event.get("tool", "scan"), out)
    return None


def _graph_slim(g: dict) -> dict:
    return {
        "id":      g["id"],
        "target":  g["target"],
        "updated": g["updated"],
        "nodes":   g["nodes"],
        "edges":   g["edges"],
        "stats":   {
            "hosts":    sum(1 for n in g["nodes"] if n["type"] == "host"),
            "ports":    sum(1 for n in g["nodes"] if n["type"] == "port"),
            "services": sum(1 for n in g["nodes"] if n["type"] == "service"),
        },
    }


def list_graphs() -> list[dict]:
    return [{"id": g["id"], "target": g["target"], "updated": g["updated"],
             "nodes": len(g["nodes"]), "edges": len(g["edges"])}
            for g in _sessions.values()]


TOOLS = {
    "topology_get":     get,
    "topology_create":  get_or_create,
    "topology_parse_nmap": parse_nmap,
    "topology_list":    list_graphs,
    "topology_clear":   clear,
}

def on_load():
    print("[topology_mapper] Network topology mapper loaded — real-time graph from nmap/scan output")
