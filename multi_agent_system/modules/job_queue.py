"""
NEXUS Module: Persistent Job Queue
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Background job queue backed by Redis (or in-memory fallback).
Jobs continue running even if user disconnects.

Features:
  - Submit jobs with name, function, args
  - Poll job status (pending/running/done/failed)
  - Stream job output via /api/jobs/<id>/stream
  - Auto-cleanup of completed jobs after 1 hour
  - Offline command queue: commands queued while offline execute on reconnect

Env:
  REDIS_URL = redis://localhost:6379/0   (optional)
"""
from __future__ import annotations
import json, os, time, threading, uuid, queue as _queue
from typing import Callable, Any, Iterator

_jobs: dict[str, dict] = {}   # RAM fallback
_output_queues: dict[str, _queue.Queue] = {}
_lock = threading.Lock()


def _get_redis():
    try:
        import redis as _redis
        url = os.environ.get("REDIS_URL", "")
        if not url:
            return None
        r = _redis.from_url(url, decode_responses=True)
        r.ping()
        return r
    except Exception:
        return None


def submit(name: str, fn: Callable, args: tuple = (), kwargs: dict | None = None,
           timeout: int = 3600) -> dict:
    """Submit a job. Returns {ok, job_id}."""
    job_id = uuid.uuid4().hex
    kwargs = kwargs or {}
    job = {"id": job_id, "name": name, "status": "pending",
           "created": time.time(), "timeout": timeout,
           "output": [], "error": None, "result": None}
    with _lock:
        _jobs[job_id] = job
        _output_queues[job_id] = _queue.Queue()

    # Store in Redis if available
    r = _get_redis()
    if r:
        try: r.setex(f"nexus:job:{job_id}", timeout, json.dumps({k: v for k,v in job.items() if k != "output"}))
        except Exception: pass

    def _worker():
        with _lock:
            _jobs[job_id]["status"] = "running"
            _jobs[job_id]["started"] = time.time()
        try:
            result = fn(*args, **kwargs)
            with _lock:
                _jobs[job_id]["status"]   = "done"
                _jobs[job_id]["result"]   = result
                _jobs[job_id]["finished"] = time.time()
                if _output_queues.get(job_id):
                    _output_queues[job_id].put(None)  # sentinel
        except Exception as e:
            with _lock:
                _jobs[job_id]["status"]   = "failed"
                _jobs[job_id]["error"]    = str(e)
                _jobs[job_id]["finished"] = time.time()
                if _output_queues.get(job_id):
                    _output_queues[job_id].put(None)

    t = threading.Thread(target=_worker, daemon=True, name=f"Job-{job_id[:8]}")
    t.start()
    return {"ok": True, "job_id": job_id, "name": name, "status": "pending"}


def get_status(job_id: str) -> dict:
    with _lock:
        job = _jobs.get(job_id)
    if job:
        return {"ok": True, **{k: v for k,v in job.items() if k not in ("output",)}}
    # Try Redis
    r = _get_redis()
    if r:
        try:
            raw = r.get(f"nexus:job:{job_id}")
            if raw:
                return {"ok": True, **json.loads(raw)}
        except Exception:
            pass
    return {"ok": False, "error": f"Job {job_id} not found"}


def list_jobs(limit: int = 50) -> list[dict]:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.get("created", 0), reverse=True)
    return [{k: v for k,v in j.items() if k not in ("output",)} for j in jobs[:limit]]


def cancel_job(job_id: str) -> dict:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job["status"] = "cancelled"
            return {"ok": True}
    return {"ok": False, "error": "not found"}


def push_output(job_id: str, line: str):
    """Push a line of output to the job's stream queue."""
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].setdefault("output", []).append(line)
        if job_id in _output_queues:
            _output_queues[job_id].put(line)


def stream_output(job_id: str, timeout: int = 3600) -> Iterator[str]:
    """Generator that yields output lines as they arrive."""
    q = _output_queues.get(job_id)
    if not q:
        # Return any stored output
        with _lock:
            job = _jobs.get(job_id, {})
        for line in job.get("output", []):
            yield line
        return
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            item = q.get(timeout=5)
            if item is None:  # sentinel = done
                break
            yield item
        except _queue.Empty:
            # Check if job is still running
            with _lock:
                status = _jobs.get(job_id, {}).get("status", "unknown")
            if status not in ("running", "pending"):
                break


# ── Offline command queue ─────────────────────────────────────────────────────
_offline_queue: list[dict] = []
_offline_lock  = threading.Lock()


def queue_offline_command(command: str, metadata: dict | None = None) -> dict:
    """Queue a command that will execute when connectivity resumes."""
    entry = {"id": uuid.uuid4().hex[:8], "command": command,
             "queued": time.time(), "metadata": metadata or {}}
    with _offline_lock:
        _offline_queue.append(entry)
    return {"ok": True, "queued_id": entry["id"], "queue_size": len(_offline_queue)}


def flush_offline_queue() -> list[dict]:
    """Execute all queued offline commands. Returns results."""
    with _offline_lock:
        items = list(_offline_queue)
        _offline_queue.clear()
    results = []
    for item in items:
        import subprocess
        try:
            r = subprocess.run(item["command"], shell=True, capture_output=True, text=True, timeout=60)
            results.append({**item, "ok": True, "output": (r.stdout + r.stderr)[:1000]})
        except Exception as e:
            results.append({**item, "ok": False, "error": str(e)})
    return results


def get_offline_queue() -> list[dict]:
    with _offline_lock:
        return list(_offline_queue)


TOOLS = {
    "job_submit":              lambda name, cmd: submit(name, __import__("subprocess").run, (cmd,), {"shell":True,"capture_output":True,"text":True,"timeout":300}),
    "job_status":              get_status,
    "job_list":                list_jobs,
    "job_cancel":              cancel_job,
    "queue_offline_command":   queue_offline_command,
    "flush_offline_queue":     flush_offline_queue,
    "get_offline_queue":       get_offline_queue,
}

def on_load():
    print("[job_queue] Job queue loaded — submit, status, list, cancel, offline_queue")
