"""Lightweight semantic memory: hash-based embeddings + cosine similarity.

We avoid an external embedding API dependency to keep things runnable out of the
box. The hash embedder is deterministic and surprisingly effective for the small
corpora typical of per-user memory. The interface is identical to a real
embedding service — drop in OpenAI/Voyage/etc. by swapping `embed_text`.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import UserMemory
from app.models.preferences import MemoryEmbedding, ProjectMemory

DIM = 256


def embed_text(text: str) -> list[float]:
    tokens = _tokenize(text)
    if not tokens:
        return [0.0] * DIM
    vec = [0.0] * DIM
    for tok in tokens:
        h = hashlib.sha1(tok.encode("utf-8")).digest()
        # Use 4 bytes per hashed sub-token to spread signal
        for i in range(0, len(h), 4):
            idx = int.from_bytes(h[i:i + 4], "big") % DIM
            sign = 1 if (h[i] & 1) else -1
            vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _tokenize(text: str) -> list[str]:
    text = text.lower()
    words = re.findall(r"[a-z0-9]{2,}", text)
    bigrams = [f"{a}_{b}" for a, b in zip(words, words[1:])]
    return words + bigrams


def cosine(a: list[float], b: list[float]) -> float:
    s = 0.0
    for x, y in zip(a, b):
        s += x * y
    return s


async def upsert_embedding(
    db: AsyncSession,
    *,
    user_id: UUID,
    scope: str,
    ref_id: UUID,
    project_id: UUID | None,
    text: str,
) -> MemoryEmbedding:
    res = await db.execute(
        select(MemoryEmbedding).where(MemoryEmbedding.scope == scope, MemoryEmbedding.ref_id == ref_id)
    )
    emb = res.scalar_one_or_none()
    vec = embed_text(text)
    if emb is None:
        emb = MemoryEmbedding(
            user_id=user_id,
            scope=scope,
            ref_id=ref_id,
            project_id=project_id,
            text=text,
            embedding=vec,
            dim=DIM,
            model="hash-256",
        )
        db.add(emb)
    else:
        emb.text = text
        emb.embedding = vec
        emb.project_id = project_id
        emb.dim = DIM
    await db.commit()
    await db.refresh(emb)
    return emb


async def delete_embedding(db: AsyncSession, scope: str, ref_id: UUID) -> None:
    res = await db.execute(
        select(MemoryEmbedding).where(MemoryEmbedding.scope == scope, MemoryEmbedding.ref_id == ref_id)
    )
    emb = res.scalar_one_or_none()
    if emb:
        await db.delete(emb)
        await db.commit()


async def search(
    db: AsyncSession,
    user_id: UUID,
    query: str,
    project_id: UUID | None,
    limit: int = 8,
) -> list[tuple[MemoryEmbedding, float]]:
    if not query.strip():
        return []
    q = embed_text(query)
    stmt = select(MemoryEmbedding).where(MemoryEmbedding.user_id == user_id)
    if project_id is not None:
        stmt = stmt.where((MemoryEmbedding.project_id == project_id) | (MemoryEmbedding.project_id.is_(None)))
    res = await db.execute(stmt)
    rows = list(res.scalars().all())
    scored = [(r, cosine(q, r.embedding)) for r in rows]
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:limit]


async def reindex_for_user(db: AsyncSession, user_id: UUID) -> int:
    """(Re)build embeddings for every user_memory + project_memory row owned by the user."""
    count = 0
    res = await db.execute(select(UserMemory).where(UserMemory.user_id == user_id))
    for m in res.scalars().all():
        await upsert_embedding(
            db,
            user_id=user_id,
            scope="user",
            ref_id=m.id,
            project_id=m.workspace_id and None,
            text=f"{m.key}: {m.value}",
        )
        count += 1
    res2 = await db.execute(select(ProjectMemory).where(ProjectMemory.user_id == user_id))
    for m in res2.scalars().all():
        await upsert_embedding(
            db,
            user_id=user_id,
            scope="project",
            ref_id=m.id,
            project_id=m.project_id,
            text=f"{m.key}: {m.value}",
        )
        count += 1
    return count
