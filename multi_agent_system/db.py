"""
NEXUS Database Layer
━━━━━━━━━━━━━━━━━━━
PostgreSQL (primary) + Redis (cache/queue) with JSON file fallback.

PostgreSQL: DATABASE_URL env var
Redis:      REDIS_URL env var
"""
from __future__ import annotations
import json, os, time, threading
from typing import Any

DATABASE_URL = os.environ.get("DATABASE_URL", "")
REDIS_URL    = os.environ.get("REDIS_URL", "")

_pg_pool = None
_redis   = None
_lock    = threading.Lock()


def get_pg():
    global _pg_pool
    if _pg_pool or not DATABASE_URL:
        return _pg_pool
    with _lock:
        if _pg_pool:
            return _pg_pool
        try:
            import psycopg2
            from psycopg2 import pool
            _pg_pool = pool.ThreadedConnectionPool(1, 10, DATABASE_URL)
            _init_schema(_pg_pool)
            print("[DB] PostgreSQL connected")
        except ImportError:
            print("[DB] psycopg2 not installed — pip install psycopg2-binary")
        except Exception as e:
            print(f"[DB] PostgreSQL error: {e}")
    return _pg_pool


def get_redis():
    global _redis
    if _redis or not REDIS_URL:
        return _redis
    with _lock:
        if _redis:
            return _redis
        try:
            import redis
            _redis = redis.from_url(REDIS_URL, decode_responses=True)
            _redis.ping()
            print("[DB] Redis connected")
        except ImportError:
            print("[DB] redis-py not installed — pip install redis")
        except Exception as e:
            print(f"[DB] Redis error: {e}")
    return _redis


def _init_schema(pool):
    """Create tables if they don't exist."""
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS nexus_rules (
                    id SERIAL PRIMARY KEY,
                    key TEXT UNIQUE NOT NULL,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS nexus_sessions (
                    id TEXT PRIMARY KEY,
                    owner TEXT,
                    data JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    expires_at TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS nexus_skills (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    content TEXT,
                    tags JSONB,
                    meta JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS nexus_tasks (
                    id TEXT PRIMARY KEY,
                    message TEXT,
                    status TEXT DEFAULT 'pending',
                    result JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            conn.commit()
    finally:
        pool.putconn(conn)


class KVStore:
    """Simple key-value store backed by PostgreSQL or a JSON file fallback."""
    def __init__(self, namespace: str):
        self.ns   = namespace
        self._path = os.path.join(os.path.dirname(__file__), f".{namespace}_store.json")
        self._mem: dict = {}
        self._load_local()

    def _load_local(self):
        try:
            if os.path.exists(self._path):
                with open(self._path) as f:
                    self._mem = json.load(f)
        except Exception:
            self._mem = {}

    def _save_local(self):
        try:
            with open(self._path, "w") as f:
                json.dump(self._mem, f, indent=2)
        except Exception:
            pass

    def get(self, key: str, default: Any = None) -> Any:
        pool = get_pg()
        if pool:
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT value FROM nexus_rules WHERE key=%s", (f"{self.ns}:{key}",))
                    row = cur.fetchone()
                    return row[0] if row else default
            except Exception:
                pass
            finally:
                pool.putconn(conn)
        return self._mem.get(key, default)

    def set(self, key: str, value: Any):
        self._mem[key] = value
        self._save_local()
        pool = get_pg()
        if pool:
            conn = pool.getconn()
            try:
                import psycopg2.extras
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO nexus_rules (key, value) VALUES (%s, %s)
                        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
                    """, (f"{self.ns}:{key}", json.dumps(value)))
                    conn.commit()
            except Exception:
                pass
            finally:
                pool.putconn(conn)

    def delete(self, key: str):
        self._mem.pop(key, None)
        self._save_local()

    def all(self) -> dict:
        return dict(self._mem)


_rules_store = KVStore("rules")


def get_rules_store() -> KVStore:
    return _rules_store


def cache_get(key: str, default: Any = None) -> Any:
    r = get_redis()
    if r:
        try:
            val = r.get(key)
            return json.loads(val) if val is not None else default
        except Exception:
            pass
    return default


def cache_set(key: str, value: Any, ttl: int = 300):
    r = get_redis()
    if r:
        try:
            r.setex(key, ttl, json.dumps(value))
        except Exception:
            pass


def cache_delete(key: str):
    r = get_redis()
    if r:
        try: r.delete(key)
        except Exception: pass


def health() -> dict:
    return {
        "postgres": get_pg() is not None,
        "redis":    get_redis() is not None,
        "mode": "postgresql+redis" if (get_pg() and get_redis()) else
                "postgresql" if get_pg() else
                "redis" if get_redis() else "local_json",
    }
