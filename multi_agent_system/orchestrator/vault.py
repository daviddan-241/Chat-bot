"""
NEXUS SECRETS VAULT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stores API keys / connector credentials at rest, ENCRYPTED with Fernet
(AES-128-CBC + HMAC). The master key comes from NEXUS_VAULT_KEY; if unset, a key
is generated and stored in the vault dir (file perms 0600) so it persists.

Keys are also pushed into os.environ on load so the rest of the system (LLM
router, tools, connectors) picks them up transparently.
"""

from __future__ import annotations
import json
import os
import stat
from typing import Dict, Any, Optional

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_VAULT_FILE = os.path.join(_DIR, "vault.enc")
_KEY_FILE = os.path.join(_DIR, ".vault_key")

# Map a friendly connector/provider field -> the env var the system reads.
ENV_MAP = {
    # model providers
    "custom_api_base_url": "CUSTOM_API_BASE_URL",
    "custom_api_key": "CUSTOM_API_KEY",
    "custom_model_frontier": "CUSTOM_MODEL_FRONTIER",
    "custom_model_balanced": "CUSTOM_MODEL_BALANCED",
    "custom_model_fast": "CUSTOM_MODEL_FAST",
    "groq_api_key": "GROQ_API_KEY",
    "groq_model_balanced": "GROQ_MODEL_BALANCED",
    "groq_model_fast": "GROQ_MODEL_FAST",
    "xai_api_key": "XAI_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "openrouter_api_key": "OPENROUTER_API_KEY",
    "deepseek_api_key": "DEEPSEEK_API_KEY",
    "image_model": "IMAGE_MODEL",
    "custom_video_url": "CUSTOM_VIDEO_URL",
    "pollinations_token": "POLLINATIONS_TOKEN",
    "hf_token": "HF_TOKEN",
    "tavily_api_key": "TAVILY_API_KEY",
    # additional free-tier LLM providers
    "cerebras_api_key": "CEREBRAS_API_KEY",
    "sambanova_api_key": "SAMBANOVA_API_KEY",
    "together_api_key": "TOGETHER_API_KEY",
    "mistral_api_key": "MISTRAL_API_KEY",
    "gemini_api_key": "GEMINI_API_KEY",
    "fireworks_api_key": "FIREWORKS_API_KEY",
    "novita_api_key": "NOVITA_API_KEY",
    "cohere_api_key": "COHERE_API_KEY",
    # web search (free tier)
    "serper_api_key": "SERPER_API_KEY",
    "bing_search_api_key": "BING_SEARCH_API_KEY",
    # kali
    "kali_api_url": "KALI_API_URL",
    "kali_api_key": "KALI_API_KEY",
    # connectors
    "github_token": "GITHUB_PERSONAL_ACCESS_TOKEN",
    "gitlab_token": "GITLAB_TOKEN",
    "vercel_token": "VERCEL_TOKEN",
    "netlify_token": "NETLIFY_TOKEN",
    "railway_token": "RAILWAY_TOKEN",
    "render_api_key": "RENDER_API_KEY",
    "cloudflare_token": "CLOUDFLARE_API_TOKEN",
    "stripe_secret_key": "STRIPE_SECRET_KEY",
    "flutterwave_secret_key": "FLUTTERWAVE_SECRET_KEY",
    "supabase_url": "SUPABASE_URL",
    "supabase_key": "SUPABASE_KEY",
    "aws_access_key_id": "AWS_ACCESS_KEY_ID",
    "aws_secret_access_key": "AWS_SECRET_ACCESS_KEY",
    "tiktok_token": "TIKTOK_ACCESS_TOKEN",
    "instagram_token": "INSTAGRAM_ACCESS_TOKEN",
    "facebook_token": "FACEBOOK_ACCESS_TOKEN",
    "x_bearer_token": "X_BEARER_TOKEN",
    "linkedin_token": "LINKEDIN_ACCESS_TOKEN",
    "discord_bot_token": "DISCORD_BOT_TOKEN",
    "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
}

# Fields that should NEVER be returned in plaintext to the client.
SECRET_FIELDS = {k for k in ENV_MAP if k.endswith(("_key", "_token", "_secret_key"))} | {
    "custom_api_key", "openai_api_key", "xai_api_key", "groq_api_key",
    "openrouter_api_key", "deepseek_api_key", "hf_token"}


def _fernet():
    from cryptography.fernet import Fernet
    key = os.environ.get("NEXUS_VAULT_KEY")
    if not key:
        if os.path.exists(_KEY_FILE):
            with open(_KEY_FILE, "rb") as f:
                key = f.read().decode()
        else:
            key = Fernet.generate_key().decode()
            with open(_KEY_FILE, "wb") as f:
                f.write(key.encode())
            try:
                os.chmod(_KEY_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600
            except Exception:
                pass
    return Fernet(key.encode() if isinstance(key, str) else key)


def _read_raw() -> Dict[str, str]:
    if not os.path.exists(_VAULT_FILE):
        return {}
    try:
        with open(_VAULT_FILE, "rb") as f:
            blob = f.read()
        if not blob:
            return {}
        dec = _fernet().decrypt(blob)
        return json.loads(dec.decode())
    except Exception:
        return {}


def _write_raw(data: Dict[str, str]):
    enc = _fernet().encrypt(json.dumps(data).encode())
    with open(_VAULT_FILE, "wb") as f:
        f.write(enc)
    try:
        os.chmod(_VAULT_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except Exception:
        pass


def load_into_env():
    """Push stored secrets into os.environ so the whole system uses them."""
    data = _read_raw()
    for field, val in data.items():
        env = ENV_MAP.get(field)
        if env and val:
            os.environ[env] = val
    return list(data.keys())


def set_keys(updates: Dict[str, str]) -> Dict[str, Any]:
    data = _read_raw()
    for field, val in updates.items():
        if field not in ENV_MAP:
            continue
        if val == "" or val is None:
            data.pop(field, None)
        else:
            data[field] = str(val)
    _write_raw(data)
    load_into_env()
    return status()


def status() -> Dict[str, Any]:
    """Return which fields are SET (never the secret values). Also reflects keys
    set via env vars (Render dashboard) so they show as connected even if the
    encrypted file was wiped."""
    data = _read_raw()
    out = {}
    for field in ENV_MAP:
        env = ENV_MAP.get(field)
        envval = os.environ.get(env) if env else None
        val = data.get(field) or envval
        if field in SECRET_FIELDS:
            out[field] = {"set": bool(val),
                          "masked": ("••••" + val[-4:]) if val else ""}
        else:
            out[field] = {"set": bool(val), "value": val or ""}
    return {"fields": out}


def get(field: str) -> Optional[str]:
    """Return a saved secret. Falls back to the env var (so keys set in Render's
    dashboard still work even if the encrypted file was wiped on a free-tier restart)."""
    val = _read_raw().get(field)
    if val:
        return val
    env = ENV_MAP.get(field)
    if env:
        return os.environ.get(env) or None
    return None


# Auto-load secrets into env at import.
try:
    load_into_env()
except Exception:
    pass
