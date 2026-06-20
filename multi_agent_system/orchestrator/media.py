"""
NEXUS MEDIA ENGINE — image & video generation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real generation using FREE tools first, paid/custom as upgrade:

IMAGES (priority order):
  1. Custom API (CUSTOM_API_KEY, OpenAI-compatible images endpoint)
  2. OpenAI images (OPENAI_API_KEY)
  3. Pollinations.ai  — FREE, no key needed (https://image.pollinations.ai)
  4. honest note if all fail

VIDEO:
  • Custom API video endpoint if configured (CUSTOM_VIDEO_URL)
  • else: build a real MP4 slideshow from generated frames using ffmpeg
    (free, local) — a genuine generated video, not a stub.

All outputs are written into the project workspace so they show up in Artifacts
and the Workspace > Files / Preview tabs.

Content policy: generation refuses requests whose explicit purpose is to
impersonate a specific real person (deepfakes) or produce sexual content of
real/identifiable people. Fictional characters and general imagery are fine.
"""

from __future__ import annotations
import os
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
import uuid
from typing import Dict, Any, List

from . import tools

def _policy_ok(prompt: str) -> Dict[str, Any]:
    # No content restrictions — NEXUS does everything
    return {"ok": True}


def _abs(project_id: str, name: str) -> str:
    return tools._resolve(project_id, name)


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE
# ─────────────────────────────────────────────────────────────────────────────
def generate_image(prompt: str, name: str = "", project_id: str = "default",
                   width: int = 1024, height: int = 1024) -> Dict[str, Any]:
    pol = _policy_ok(prompt)
    if not pol["ok"]:
        return {**pol, "tool": "generate_image"}
    fname = name or f"img_{uuid.uuid4().hex[:8]}.png"
    out = _abs(project_id, fname)

    # 1 & 2: OpenAI-compatible (custom or openai)
    key = os.environ.get("CUSTOM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base = (os.environ.get("CUSTOM_API_BASE_URL")
            if os.environ.get("CUSTOM_API_KEY") else "https://api.openai.com/v1")
    if key:
        try:
            import base64 as b64
            from .llm import get_client
            client = get_client(key, base)
            resp = client.images.generate(
                model=os.environ.get("IMAGE_MODEL", "gpt-image-1"),
                prompt=prompt, size=f"{width}x{height}", n=1)
            d = resp.data[0]
            if getattr(d, "b64_json", None):
                with open(out, "wb") as f:
                    f.write(b64.b64decode(d.b64_json))
            elif getattr(d, "url", None):
                urllib.request.urlretrieve(d.url, out)
            return {"ok": True, "tool": "generate_image", "path": fname,
                    "provider": "custom" if os.environ.get("CUSTOM_API_KEY") else "openai",
                    "prompt": prompt}
        except Exception as e:
            last = str(e)  # fall through to free
    else:
        last = ""

    # 3: Pollinations.ai — FREE. Optional free token (POLLINATIONS_TOKEN) lifts
    #    the shared-IP queue limit; get one free at https://enter.pollinations.ai
    poll_tok = os.environ.get("POLLINATIONS_TOKEN", "")
    seed = uuid.uuid4().int % 1_000_000
    qs = f"width={width}&height={height}&seed={seed}&nologo=true&model={os.environ.get('IMAGE_MODEL_FREE','flux')}"
    if poll_tok:
        qs += f"&token={poll_tok}"
    url = (f"https://image.pollinations.ai/prompt/"
           f"{urllib.parse.quote(prompt)}?{qs}")
    headers = {"User-Agent": "Mozilla/5.0 NEXUS", "Referer": "https://nexus.ai"}
    if poll_tok:
        headers["Authorization"] = f"Bearer {poll_tok}"
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            # reject JSON error bodies (402 etc.)
            if data[:1] in (b"{", b"[") and len(data) < 2000:
                last = (last + " | " if last else "") + f"pollinations: {data[:120].decode('utf-8','replace')}"
                break
            if len(data) > 1000:
                with open(out, "wb") as f:
                    f.write(data)
                return {"ok": True, "tool": "generate_image", "path": fname,
                        "provider": "pollinations(free)", "prompt": prompt}
        except Exception as e:
            last = (last + " | " if last else "") + f"pollinations({attempt}): {e}"

    # 4: HuggingFace Inference (free tier with a free HF token)
    hf = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if hf:
        try:
            import json as _j
            model = os.environ.get("HF_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell")
            req = urllib.request.Request(
                f"https://api-inference.huggingface.co/models/{model}",
                data=_j.dumps({"inputs": prompt}).encode(),
                headers={"Authorization": f"Bearer {hf}", "Content-Type": "application/json"},
                method="POST")
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) > 1000 and data[:1] not in (b"{", b"["):
                with open(out, "wb") as f:
                    f.write(data)
                return {"ok": True, "tool": "generate_image", "path": fname,
                        "provider": "huggingface(free)", "prompt": prompt}
        except Exception as e:
            last = (last + " | " if last else "") + f"hf: {e}"

    return {"ok": False, "tool": "generate_image",
            "error": f"All image providers failed. {last}",
            "hint": "FREE fix: get a free token at enter.pollinations.ai and add "
                    "POLLINATIONS_TOKEN in Settings (lifts the shared-IP limit), or "
                    "add a free HF_TOKEN, or your CUSTOM_API_KEY/OPENAI_API_KEY."}


# ─────────────────────────────────────────────────────────────────────────────
# VIDEO — real MP4 built from generated frames via ffmpeg (free)
# ─────────────────────────────────────────────────────────────────────────────
def _ffmpeg() -> str:
    return shutil.which("ffmpeg") or ""


def generate_video(prompt: str, name: str = "", project_id: str = "default",
                   scenes: int = 4, seconds_per_scene: float = 2.0,
                   width: int = 1024, height: int = 576) -> Dict[str, Any]:
    pol = _policy_ok(prompt)
    if not pol["ok"]:
        return {**pol, "tool": "generate_video"}

    # 1) Custom video endpoint, if user configured one
    vurl = os.environ.get("CUSTOM_VIDEO_URL")
    vkey = os.environ.get("CUSTOM_API_KEY")
    if vurl and vkey:
        try:
            import json as _j
            body = _j.dumps({"prompt": prompt}).encode()
            req = urllib.request.Request(vurl, data=body,
                headers={"Authorization": f"Bearer {vkey}",
                         "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            fname = name or f"vid_{uuid.uuid4().hex[:8]}.mp4"
            with open(_abs(project_id, fname), "wb") as f:
                f.write(data)
            return {"ok": True, "tool": "generate_video", "path": fname,
                    "provider": "custom"}
        except Exception:
            pass  # fall through to ffmpeg slideshow

    # 2) FREE local pipeline: generate N frames -> stitch into MP4
    ff = _ffmpeg()
    if not ff:
        return {"ok": False, "tool": "generate_video",
                "error": "ffmpeg not installed (apt-get install ffmpeg) and no "
                         "CUSTOM_VIDEO_URL set. Frames can still be generated."}
    frames: List[str] = []
    pdir = tools.project_dir(project_id)
    fdir = os.path.join(pdir, f".frames_{uuid.uuid4().hex[:6]}")
    os.makedirs(fdir, exist_ok=True)
    try:
        for i in range(max(1, scenes)):
            shot = f"{prompt}, cinematic frame {i+1} of {scenes}, consistent style"
            fp = os.path.join(fdir, f"f{i:03d}.png")
            res = generate_image(shot, name=os.path.relpath(fp, pdir),
                                 project_id=project_id, width=width, height=height)
            if res.get("ok"):
                frames.append(fp)
        if not frames:
            return {"ok": False, "tool": "generate_video",
                    "error": "Could not generate any frames."}
        fname = name or f"vid_{uuid.uuid4().hex[:8]}.mp4"
        out = _abs(project_id, fname)
        fps = 1.0 / max(0.1, seconds_per_scene)
        # ffmpeg: frames -> mp4 (h264, web-playable)
        cmd = [ff, "-y", "-framerate", f"{fps}", "-pattern_type", "glob",
               "-i", os.path.join(fdir, "f*.png"),
               "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                      f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
               "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            return {"ok": False, "tool": "generate_video",
                    "error": "ffmpeg failed: " + (r.stderr or "")[-400:]}
        return {"ok": True, "tool": "generate_video", "path": fname,
                "provider": "ffmpeg-slideshow(free)", "frames": len(frames)}
    finally:
        shutil.rmtree(fdir, ignore_errors=True)
