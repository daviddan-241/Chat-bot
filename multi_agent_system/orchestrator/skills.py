"""
NEXUS SKILLS LIBRARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Upload a file (PDF / TXT / MD / DOCX / ZIP / image / audio / video). NEXUS
extracts the text, then the Skill Extractor agent distills it into reusable
knowledge: methods, techniques, frameworks, workflows, best practices.

Extracted skills are stored per-project (and globally) and are AUTOMATICALLY
injected into the engine's context, so when agents work on anything they can
draw on the skill — exactly as requested.

Real extraction:
  • .txt/.md/.json/.csv/.py/.js... -> read directly
  • .pdf  -> pdfplumber / PyPDF2 if available, else honest note
  • .docx -> python-docx if available, else unzip document.xml text
  • .zip  -> extract & read all text files inside
  • images/audio/video -> filename + type noted; transcription/vision happens via
    the Vision/Transcriber agents at use-time if a provider is configured.
"""

from __future__ import annotations
import io
import json
import os
import time
import uuid
import zipfile
from typing import Dict, Any, List

from .llm import ROUTER
from .registry import BY_ID

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SKILLS_FILE = os.path.join(_DIR, "skills.json")

TEXT_EXT = {".txt", ".md", ".markdown", ".json", ".csv", ".py", ".js", ".ts",
            ".html", ".css", ".java", ".go", ".rs", ".c", ".cpp", ".sh",
            ".yml", ".yaml", ".xml", ".rb", ".php", ".sql", ".log", ".ini", ".toml"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def _load() -> List[Dict[str, Any]]:
    if not os.path.exists(_SKILLS_FILE):
        return []
    try:
        with open(_SKILLS_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save(skills: List[Dict[str, Any]]):
    with open(_SKILLS_FILE, "w") as f:
        json.dump(skills, f, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# TEXT EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────
def extract_text(filename: str, raw: bytes) -> Dict[str, Any]:
    ext = os.path.splitext(filename)[1].lower()
    if ext in TEXT_EXT:
        return {"kind": "text", "text": raw.decode("utf-8", errors="replace")}
    if ext == ".pdf":
        return {"kind": "pdf", "text": _pdf_text(raw)}
    if ext == ".docx":
        return {"kind": "docx", "text": _docx_text(raw)}
    if ext == ".zip":
        return {"kind": "zip", "text": _zip_text(raw)}
    if ext in IMAGE_EXT:
        return {"kind": "image", "text": f"[Image file: {filename}] — vision analysis "
                "available at use-time when an image-capable model is configured."}
    if ext in AUDIO_EXT:
        return {"kind": "audio", "text": f"[Audio file: {filename}] — transcription "
                "available at use-time when a transcription provider is configured."}
    if ext in VIDEO_EXT:
        return {"kind": "video", "text": f"[Video file: {filename}] — frame+audio "
                "analysis available at use-time when providers are configured."}
    # try as text anyway
    try:
        return {"kind": "text", "text": raw.decode("utf-8")}
    except Exception:
        return {"kind": "binary", "text": f"[Binary file: {filename}]"}


def _pdf_text(raw: bytes) -> str:
    try:
        import pdfplumber
        out = []
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            for p in pdf.pages[:50]:
                out.append(p.extract_text() or "")
        return "\n".join(out)
    except Exception:
        pass
    try:
        from PyPDF2 import PdfReader
        r = PdfReader(io.BytesIO(raw))
        return "\n".join((pg.extract_text() or "") for pg in r.pages[:50])
    except Exception as e:
        return f"[PDF extraction unavailable: install pdfplumber or PyPDF2 ({e})]"


def _docx_text(raw: bytes) -> str:
    try:
        import docx
        d = docx.Document(io.BytesIO(raw))
        return "\n".join(p.text for p in d.paragraphs)
    except Exception:
        pass
    # fallback: unzip and pull text from document.xml
    try:
        import re
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        text = re.sub(r"<[^>]+>", " ", xml)
        return re.sub(r"\s+", " ", text).strip()
    except Exception as e:
        return f"[DOCX extraction failed: {e}]"


def _zip_text(raw: bytes) -> str:
    out = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for name in z.namelist()[:200]:
                ext = os.path.splitext(name)[1].lower()
                if ext in TEXT_EXT:
                    try:
                        out.append(f"=== {name} ===\n" +
                                   z.read(name).decode("utf-8", errors="replace")[:5000])
                    except Exception:
                        pass
    except Exception as e:
        return f"[ZIP extraction failed: {e}]"
    return "\n\n".join(out) if out else "[ZIP contained no readable text files]"


# ─────────────────────────────────────────────────────────────────────────────
# DISTILL into a reusable skill via the Skill Extractor agent
# ─────────────────────────────────────────────────────────────────────────────
def distill(filename: str, text: str) -> Dict[str, Any]:
    agent = BY_ID.get("kno-skillextract")
    sys = (agent.system if agent else "You extract reusable knowledge.") + (
        "\n\nReturn ONLY JSON: {\"title\": str, \"summary\": str, "
        "\"methods\": [str], \"techniques\": [str], \"frameworks\": [str], "
        "\"workflows\": [str], \"best_practices\": [str]}. Be concrete and useful.")
    raw = ROUTER.complete("frontier",
                          [{"role": "system", "content": sys},
                           {"role": "user", "content":
                            f"SOURCE: {filename}\n\nCONTENT:\n{text[:12000]}"}],
                          temperature=0.2, max_tokens=1800)
    try:
        s = raw.find("{"); e = raw.rfind("}")
        data = json.loads(raw[s:e + 1])
    except Exception:
        data = {"title": filename, "summary": raw[:800], "methods": [],
                "techniques": [], "frameworks": [], "workflows": [],
                "best_practices": []}
    return data


def add_skill(filename: str, raw: bytes, project_id: str = "global") -> Dict[str, Any]:
    ext = extract_text(filename, raw)
    distilled = distill(filename, ext["text"])
    skill = {
        "id": uuid.uuid4().hex[:10],
        "filename": filename,
        "kind": ext["kind"],
        "project_id": project_id,
        "created_at": time.time(),
        "raw_excerpt": ext["text"][:1500],
        **distilled,
    }
    skills = _load()
    skills.insert(0, skill)
    _save(skills)
    return {"ok": True, "skill": _public(skill)}


def _public(s: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in s.items() if k != "raw_excerpt"}


def list_skills(project_id: str = None) -> Dict[str, Any]:
    skills = _load()
    if project_id and project_id != "global":
        skills = [s for s in skills if s.get("project_id") in (project_id, "global")]
    return {"skills": [_public(s) for s in skills]}


def delete_skill(skill_id: str) -> Dict[str, Any]:
    skills = _load()
    skills = [s for s in skills if s.get("id") != skill_id]
    _save(skills)
    return {"ok": True}


def context_for(project_id: str = "global", limit: int = 5) -> str:
    """Compact skill context the engine injects into every run."""
    skills = _load()
    rel = [s for s in skills if s.get("project_id") in (project_id, "global")][:limit]
    if not rel:
        return ""
    parts = []
    for s in rel:
        bp = "; ".join(s.get("best_practices", [])[:4])
        mt = "; ".join((s.get("methods", []) + s.get("techniques", []))[:4])
        parts.append(f"• {s.get('title','skill')}: {s.get('summary','')[:200]}"
                     + (f" | methods: {mt}" if mt else "")
                     + (f" | best-practices: {bp}" if bp else ""))
    return "LEARNED SKILLS (apply where relevant):\n" + "\n".join(parts)
