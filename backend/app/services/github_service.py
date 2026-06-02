"""GitHub OAuth + REST helpers (uses httpx, no external SDK)."""
from __future__ import annotations

import base64
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt, encrypt
from app.core.redis_client import get_redis
from app.models.integration import Integration, IntegrationProvider
from app.models.user import User

GITHUB_API = "https://api.github.com"
GITHUB_AUTHZ = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN = "https://github.com/login/oauth/access_token"

OAUTH_STATE_TTL = 600


async def begin_oauth(user_id: str) -> tuple[str, str]:
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_REDIRECT_URI:
        raise HTTPException(503, "GitHub OAuth not configured on this server")
    state = secrets.token_urlsafe(32)
    redis = await get_redis()
    await redis.setex(f"oauth:github:{state}", OAUTH_STATE_TTL, user_id)
    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": settings.GITHUB_REDIRECT_URI,
        "scope": settings.GITHUB_SCOPES,
        "state": state,
        "allow_signup": "true",
    }
    return f"{GITHUB_AUTHZ}?{urlencode(params)}", state


async def complete_oauth(db: AsyncSession, code: str, state: str) -> tuple[Integration, User]:
    redis = await get_redis()
    user_id = await redis.get(f"oauth:github:{state}")
    if not user_id:
        raise HTTPException(400, "Invalid or expired OAuth state")
    await redis.delete(f"oauth:github:{state}")

    async with httpx.AsyncClient(timeout=20) as client:
        token_res = await client.post(
            GITHUB_TOKEN,
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
        )
        if token_res.status_code != 200:
            raise HTTPException(400, f"GitHub token exchange failed: {token_res.text[:200]}")
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(400, f"GitHub did not return an access token: {token_data}")
        scope = token_data.get("scope")

        me = await client.get(
            f"{GITHUB_API}/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
        if me.status_code != 200:
            raise HTTPException(400, "Failed to fetch GitHub profile")
        profile = me.json()

    return await _upsert_integration(
        db,
        user_id=user_id,
        access_token=access_token,
        refresh_token=None,
        scope=scope,
        profile=profile,
    )


async def link_with_token(db: AsyncSession, user: User, token: str) -> Integration:
    """Allow linking GitHub via a personal access token (no OAuth round trip)."""
    async with httpx.AsyncClient(timeout=15) as client:
        me = await client.get(
            f"{GITHUB_API}/user",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if me.status_code != 200:
            raise HTTPException(400, "Invalid GitHub token")
        profile = me.json()
    integration, _ = await _upsert_integration(
        db,
        user_id=str(user.id),
        access_token=token,
        refresh_token=None,
        scope="pat",
        profile=profile,
    )
    return integration


async def _upsert_integration(
    db: AsyncSession,
    *,
    user_id: str,
    access_token: str,
    refresh_token: str | None,
    scope: str | None,
    profile: dict,
) -> tuple[Integration, User]:
    from uuid import UUID

    res = await db.execute(
        select(Integration).where(
            Integration.user_id == UUID(user_id),
            Integration.provider == IntegrationProvider.github,
        )
    )
    integration = res.scalar_one_or_none()
    user = (await db.execute(select(User).where(User.id == UUID(user_id)))).scalar_one()

    if integration is None:
        integration = Integration(
            user_id=user.id,
            provider=IntegrationProvider.github,
            access_token=encrypt(access_token),
            refresh_token=encrypt(refresh_token) if refresh_token else None,
            scope=scope,
            account_id=str(profile.get("id")),
            account_login=profile.get("login"),
            account_email=profile.get("email"),
            avatar_url=profile.get("avatar_url"),
            extra={"name": profile.get("name"), "html_url": profile.get("html_url")},
        )
        db.add(integration)
    else:
        integration.access_token = encrypt(access_token)
        if refresh_token:
            integration.refresh_token = encrypt(refresh_token)
        integration.scope = scope or integration.scope
        integration.account_id = str(profile.get("id"))
        integration.account_login = profile.get("login")
        integration.account_email = profile.get("email")
        integration.avatar_url = profile.get("avatar_url")
        integration.extra = {"name": profile.get("name"), "html_url": profile.get("html_url")}
    await db.commit()
    await db.refresh(integration)
    return integration, user


async def get_token(db: AsyncSession, user: User) -> str:
    res = await db.execute(
        select(Integration).where(
            Integration.user_id == user.id, Integration.provider == IntegrationProvider.github
        )
    )
    integ = res.scalar_one_or_none()
    if not integ:
        raise HTTPException(400, "GitHub not connected")
    return decrypt(integ.access_token)


async def list_repos(token: str, per_page: int = 50, page: int = 1) -> list[dict]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{GITHUB_API}/user/repos",
            params={"per_page": per_page, "page": page, "sort": "updated", "affiliation": "owner,collaborator,organization_member"},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        return res.json()


async def list_branches(token: str, repo: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{GITHUB_API}/repos/{repo}/branches",
            params={"per_page": 100},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        return [{"name": b["name"], "sha": b["commit"]["sha"], "protected": b.get("protected", False)} for b in res.json()]


async def get_repo(token: str, repo: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{GITHUB_API}/repos/{repo}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        return res.json()


async def get_tree(token: str, repo: str, sha: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{GITHUB_API}/repos/{repo}/git/trees/{sha}?recursive=1",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        return res.json()


async def get_blob(token: str, repo: str, sha: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{GITHUB_API}/repos/{repo}/git/blobs/{sha}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        body = res.json()
        data = base64.b64decode(body["content"]) if body.get("encoding") == "base64" else body["content"].encode()
        return data, body.get("encoding", "utf-8")


async def get_branch_sha(token: str, repo: str, branch: str) -> str:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{GITHUB_API}/repos/{repo}/git/refs/heads/{branch}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        )
        if res.status_code != 200:
            raise HTTPException(res.status_code, f"GitHub: {res.text[:200]}")
        return res.json()["object"]["sha"]


async def create_branch(token: str, repo: str, name: str, from_sha: str) -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            f"{GITHUB_API}/repos/{repo}/git/refs",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"ref": f"refs/heads/{name}", "sha": from_sha},
        )
        if res.status_code not in (200, 201):
            raise HTTPException(res.status_code, f"GitHub create branch: {res.text[:200]}")


async def commit_files(
    token: str,
    repo: str,
    branch: str,
    message: str,
    files: list[dict],
    base_branch: str | None = None,
) -> dict:
    """Commit multiple files in a single commit using the Git Data API."""
    async with httpx.AsyncClient(timeout=60) as client:
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

        # 1. Ensure branch exists
        try:
            head_sha = await get_branch_sha(token, repo, branch)
        except HTTPException:
            if not base_branch:
                base_branch = (await get_repo(token, repo)).get("default_branch", "main")
            base_sha = await get_branch_sha(token, repo, base_branch)
            await create_branch(token, repo, branch, base_sha)
            head_sha = base_sha

        # 2. Get base commit + tree
        commit_res = await client.get(f"{GITHUB_API}/repos/{repo}/git/commits/{head_sha}", headers=headers)
        if commit_res.status_code != 200:
            raise HTTPException(commit_res.status_code, f"GitHub: {commit_res.text[:200]}")
        base_tree = commit_res.json()["tree"]["sha"]

        # 3. Create blobs
        tree_items: list[dict[str, Any]] = []
        for f in files:
            encoding = f.get("encoding", "utf-8")
            content = f["content"]
            if encoding == "base64":
                payload = {"content": content, "encoding": "base64"}
            else:
                payload = {"content": content, "encoding": "utf-8"}
            blob = await client.post(f"{GITHUB_API}/repos/{repo}/git/blobs", headers=headers, json=payload)
            if blob.status_code not in (200, 201):
                raise HTTPException(blob.status_code, f"GitHub blob: {blob.text[:200]}")
            tree_items.append({"path": f["path"], "mode": "100644", "type": "blob", "sha": blob.json()["sha"]})

        # 4. Create tree
        tree_res = await client.post(
            f"{GITHUB_API}/repos/{repo}/git/trees",
            headers=headers,
            json={"base_tree": base_tree, "tree": tree_items},
        )
        if tree_res.status_code not in (200, 201):
            raise HTTPException(tree_res.status_code, f"GitHub tree: {tree_res.text[:200]}")
        new_tree = tree_res.json()["sha"]

        # 5. Create commit
        commit_res2 = await client.post(
            f"{GITHUB_API}/repos/{repo}/git/commits",
            headers=headers,
            json={"message": message, "tree": new_tree, "parents": [head_sha]},
        )
        if commit_res2.status_code not in (200, 201):
            raise HTTPException(commit_res2.status_code, f"GitHub commit: {commit_res2.text[:200]}")
        new_commit = commit_res2.json()

        # 6. Move branch ref
        ref_res = await client.patch(
            f"{GITHUB_API}/repos/{repo}/git/refs/heads/{branch}",
            headers=headers,
            json={"sha": new_commit["sha"], "force": False},
        )
        if ref_res.status_code not in (200, 201):
            raise HTTPException(ref_res.status_code, f"GitHub ref update: {ref_res.text[:200]}")

        return {
            "commit_sha": new_commit["sha"],
            "branch": branch,
            "html_url": new_commit.get("html_url"),
            "files_committed": len(files),
        }
