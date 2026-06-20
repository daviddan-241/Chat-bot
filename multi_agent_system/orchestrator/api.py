"""
NEXUS ORCHESTRATOR — Flask Blueprint
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REST + SSE endpoints that expose the 350+ agent engine to the UI.

  GET  /api/orchestrator/fleet        -> full fleet snapshot (all agents + status)
  GET  /api/orchestrator/domains      -> agents grouped by domain (dashboard grid)
  GET  /api/orchestrator/summary      -> counts + llm provider status
  POST /api/orchestrator/run          -> {goal, project_id} -> SSE stream of events
  GET  /api/orchestrator/llm          -> live LLM provider status
  POST /api/orchestrator/refresh-llm  -> re-read provider keys after Settings change
"""

from __future__ import annotations
import json
import os
from flask import Blueprint, request, Response, jsonify, stream_with_context

from .engine import ENGINE
from .llm import ROUTER
from .registry import catalog_summary
from . import vault, connectors as conn, deploy as DEP, skills as SK, tools as TOOLS
from . import projects as PROJ, media as MEDIA, instructions as INS, inspector as INSP
from . import history as HIST
from . import uptime as UP

bp = Blueprint("orchestrator", __name__, url_prefix="/api/orchestrator")


def _sse(data: str) -> str:
    return f"data: {data}\n\n"


@bp.route("/summary")
def summary():
    return jsonify({"catalog": catalog_summary(), "llm": ROUTER.status()})


@bp.route("/fleet")
def fleet():
    return jsonify(ENGINE.fleet_snapshot())


@bp.route("/health")
def fleet_health():
    return jsonify(ENGINE.health())


@bp.route("/domains")
def domains():
    return jsonify(ENGINE.domains())


@bp.route("/llm")
def llm():
    return jsonify(ROUTER.status())


@bp.route("/refresh-llm", methods=["POST"])
def refresh_llm():
    ROUTER.refresh()
    return jsonify(ROUTER.status())


@bp.route("/llm/test", methods=["POST"])
def llm_test():
    """Real diagnostic: actually call the active model and report success/failure."""
    import time as _t
    import threading as _th
    from .llm import ROUTER as R, LLMError
    R.refresh()
    st = R.status()
    if st["demo_mode"]:
        return jsonify({"ok": False, "demo_mode": True,
                        "error": "No provider configured. Add an API key in Settings "
                                 "(Groq is free — grab one at console.groq.com)."})
    t0 = _t.time()
    result_box = [None]
    error_box  = [None]

    def _do():
        try:
            result_box[0] = R.complete(
                "fast",
                [{"role": "user", "content": "Reply with exactly: NEXUS_OK"}],
                max_tokens=20, temperature=0
            )
        except LLMError as e:
            error_box[0] = str(e)
        except Exception as e:
            error_box[0] = str(e)

    t = _th.Thread(target=_do, daemon=True)
    t.start()
    t.join(timeout=18)  # hard 18s cap — never hang the browser

    ms = int((_t.time() - t0) * 1000)
    if t.is_alive():
        return jsonify({"ok": False, "provider": st["active"], "latency_ms": ms,
                        "error": "Request timed out (18s). Check your base URL and key.",
                        "hint": "Base URL must end with /v1. Key must match the provider."})
    if error_box[0]:
        return jsonify({"ok": False, "provider": st["active"], "latency_ms": ms,
                        "error": error_box[0],
                        "hint": "Check the base URL ends with /v1, the model names "
                                "in Settings match what your API serves, and the key is valid."})
    reply = result_box[0] or ""
    ok = len(reply.strip()) > 0
    return jsonify({"ok": ok, "provider": st["active"], "latency_ms": ms,
                    "model_reply": reply[:120],
                    "note": "Model responded." if ok else "Empty reply."})


@bp.route("/run", methods=["POST"])
def run():
    body = request.get_json(force=True) or {}
    goal = (body.get("goal") or body.get("message") or "").strip()
    project_id = body.get("project_id", "default")
    image_b64 = body.get("image_b64")  # data URL or base64 for vision
    conv_id = body.get("conv_id")      # optional: load this conversation's history
    if not goal:
        return jsonify({"error": "No goal provided"}), 400

    # Load persistent conversation history for this chat session
    conversation: list = []
    if conv_id:
        try:
            result = HIST.get_conversation(conv_id)
            if result.get("ok"):
                conversation = result["conversation"].get("messages", [])
        except Exception:
            pass

    def generate():
        try:
            for ev in ENGINE.run(goal, project_id=project_id, image_b64=image_b64,
                                 conversation=conversation):
                yield _sse(json.dumps(ev))
        except Exception as e:
            yield _sse(json.dumps({"type": "error", "data": {"message": str(e)}}))
        yield _sse(json.dumps({"type": "done", "data": {}}))
        yield _sse("[DONE]")

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no",
                             "Connection": "keep-alive"})


# ── SETTINGS / KEY VAULT ──
@bp.route("/keys", methods=["GET"])
def keys_status():
    return jsonify(vault.status())


@bp.route("/keys", methods=["POST"])
def keys_set():
    body = request.get_json(force=True) or {}
    result = vault.set_keys(body)
    ROUTER.refresh()  # pick up new model provider keys immediately
    try:
        from agents.coordinator_agent import refresh_clients
        refresh_clients()  # also rebuild the module-level OpenAI clients
    except Exception:
        pass
    return jsonify(result)


# ── CONNECTORS ──
@bp.route("/connectors", methods=["GET"])
def connectors_list():
    return jsonify(conn.list_connectors())


@bp.route("/connectors/<cid>/test", methods=["POST"])
def connectors_test(cid):
    return jsonify(conn.test_connector(cid))


@bp.route("/connectors/<cid>/action/<action>", methods=["POST"])
def connectors_action(cid, action):
    body = request.get_json(force=True) or {}
    return jsonify(conn.run_action(cid, action, body))


# ── WORKSPACE (artifacts produced by agents) ──
@bp.route("/workspace/<project_id>/files", methods=["GET"])
def workspace_files(project_id):
    from . import tools as T
    return jsonify(T.list_files("", project_id))


@bp.route("/workspace/<project_id>/file", methods=["GET"])
def workspace_read(project_id):
    from . import tools as T
    path = request.args.get("path", "")
    return jsonify(T.read_file(path, project_id))


# ── DEPLOYMENTS ──
@bp.route("/deploy/<target>", methods=["POST"])
def deploy_target(target):
    body = request.get_json(force=True) or {}
    project_id = body.pop("project_id", "default")
    return jsonify(DEP.deploy(target, project_id, **body))


# ── SKILLS LIBRARY ──
@bp.route("/skills", methods=["GET"])
def skills_list():
    pid = request.args.get("project_id", "global")
    return jsonify(SK.list_skills(pid))


@bp.route("/skills/upload", methods=["POST"])
def skills_upload():
    pid = request.form.get("project_id", "global")
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "no file uploaded"}), 400
    raw = f.read()
    try:
        return jsonify(SK.add_skill(f.filename, raw, pid))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.route("/skills/<sid>", methods=["DELETE"])
def skills_delete(sid):
    return jsonify(SK.delete_skill(sid))


# ── WORKSPACE FILE WRITE (manual edits from the workspace panel) ──
@bp.route("/workspace/<project_id>/write", methods=["POST"])
def workspace_write(project_id):
    body = request.get_json(force=True) or {}
    return jsonify(TOOLS.write_file(body.get("path", ""), body.get("content", ""),
                                    project_id=project_id))


@bp.route("/workspace/<project_id>/exec", methods=["POST"])
def workspace_exec(project_id):
    body = request.get_json(force=True) or {}
    cmd = body.get("cmd", "")
    if body.get("kali"):
        return jsonify(TOOLS.kali_exec(cmd))
    return jsonify(TOOLS.run_shell(cmd, project_id=project_id))


# ── LIVE PREVIEW of a workspace HTML file ──
@bp.route("/preview/<project_id>")
@bp.route("/preview/<project_id>/<path:fname>")
def workspace_preview(project_id, fname="index.html"):
    res = TOOLS.read_file(fname, project_id=project_id)
    if not res.get("ok"):
        return f"<h3 style='font-family:sans-serif'>No {fname} in this workspace yet.</h3>", 404
    return Response(res["content"], mimetype="text/html")


# ── LIVE PREVIEW (frontend AND backend: html/python/php/node…) ──
@bp.route("/livepreview/<project_id>/start", methods=["POST"])
def livepreview_start(project_id):
    from . import preview as PV
    return jsonify(PV.start(project_id))


@bp.route("/livepreview/<project_id>/status", methods=["GET"])
def livepreview_status(project_id):
    from . import preview as PV
    return jsonify(PV.status(project_id))


@bp.route("/livepreview/<project_id>/stop", methods=["POST"])
def livepreview_stop(project_id):
    from . import preview as PV
    PV.stop(project_id)
    return jsonify({"ok": True})


# proxy ALL methods/paths to the running backend preview server
@bp.route("/live/<project_id>/", defaults={"path": ""},
          methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
@bp.route("/live/<project_id>/<path:path>",
          methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
def livepreview_proxy(project_id, path):
    from . import preview as PV
    body = request.get_data()
    r = PV.proxy(project_id, path, request.method, dict(request.headers), body)
    resp = Response(r["body"], status=r["status"])
    for k, v in r.get("headers", {}).items():
        resp.headers[k] = v
    return resp


# ── AI-DETECTION INSPECTOR (humanizer) ──
@bp.route("/inspect", methods=["POST"])
def inspect_text():
    b = request.get_json(force=True) or {}
    return jsonify(INSP.score(b.get("text", "")))


@bp.route("/humanize", methods=["POST"])
def humanize_text():
    b = request.get_json(force=True) or {}
    if b.get("auto"):
        return jsonify(INSP.inspect_and_fix(b.get("text", ""),
                                            threshold=b.get("threshold", 40)))
    return jsonify(INSP.humanize(b.get("text", ""), tone=b.get("tone", "natural, direct, conversational")))


@bp.route("/inspector/toggle", methods=["POST"])
def inspector_toggle():
    b = request.get_json(force=True) or {}
    ENGINE.humanize_enabled = bool(b.get("enabled", True))
    return jsonify({"ok": True, "enabled": ENGINE.humanize_enabled})


@bp.route("/inspector/status", methods=["GET"])
def inspector_status():
    return jsonify({"enabled": getattr(ENGINE, "humanize_enabled", True)})


# ── MASTER INSTRUCTIONS (global system prompt that overrides defaults) ──
@bp.route("/instructions", methods=["GET"])
def instructions_get():
    scope = request.args.get("scope", "global")
    return jsonify({"scope": scope, "text": INS.get(scope),
                    "floor": INS.SAFETY_FLOOR.strip()})


@bp.route("/instructions", methods=["POST"])
def instructions_set():
    b = request.get_json(force=True) or {}
    return jsonify(INS.set_instructions(b.get("text", ""), b.get("scope", "global")))


# ── PROJECTS (isolated memory) ──
@bp.route("/projects", methods=["GET"])
def projects_list():
    return jsonify(PROJ.list_projects())


@bp.route("/projects", methods=["POST"])
def projects_create():
    b = request.get_json(force=True) or {}
    return jsonify(PROJ.create_project(b.get("name", ""), b.get("tags")))


@bp.route("/projects/<pid>", methods=["PATCH"])
def projects_update(pid):
    return jsonify(PROJ.update_project(pid, **(request.get_json(force=True) or {})))


@bp.route("/projects/<pid>", methods=["DELETE"])
def projects_delete(pid):
    return jsonify(PROJ.delete_project(pid))


@bp.route("/projects/<pid>/memory", methods=["GET"])
def projects_memory(pid):
    return jsonify(PROJ.project_memory(pid))


# ── ONE-CLICK GITHUB PUSH of the NEXUS app itself ──
@bp.route("/git/push-self", methods=["POST"])
def git_push_self():
    """Push the whole NEXUS repo to a target GitHub repo using the vault token."""
    import subprocess, os
    b = request.get_json(force=True) or {}
    repo = (b.get("repo") or "").strip()  # owner/name
    branch = b.get("branch", "main")
    token = vault.get("github_token")
    if not token:
        return jsonify({"ok": False, "error": "Add a GitHub token in Settings → API Keys first."}), 400
    if "/" not in repo:
        return jsonify({"ok": False, "error": "repo must be 'owner/name'"}), 400
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    log = []
    # Prevent git from ever prompting interactively (would hang the request)
    git_env = {**os.environ,
               "GIT_TERMINAL_PROMPT": "0",
               "GIT_ASKPASS": "echo",
               "GCM_INTERACTIVE": "never",
               "GITHUB_TOKEN": token}

    def run(*cmd, timeout=60):
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True,
                           timeout=timeout, env=git_env)
        log.append((" ".join(cmd[:3]) + "…", r.returncode,
                    (r.stdout + r.stderr)[-300:]))
        return r

    # Validate the token works against GitHub API before attempting push
    try:
        import urllib.request as _ureq, json as _json
        req = _ureq.Request(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {token}",
                     "User-Agent": "NEXUS-push/1.0",
                     "Accept": "application/vnd.github+json"})
        with _ureq.urlopen(req, timeout=10) as resp:
            gh_user = _json.loads(resp.read()).get("login", "")
        log.append(("github api check…", 0, f"authenticated as: {gh_user}"))
    except Exception as ve:
        err = str(ve)
        hint = ""
        if "401" in err or "Bad credentials" in err:
            hint = "Token is invalid or expired. Go to github.com/settings/tokens and create a new Classic PAT with 'repo' scope."
        elif "403" in err:
            hint = "Token doesn't have 'repo' scope. Edit your token at github.com/settings/tokens."
        return jsonify({"ok": False,
                        "error": f"GitHub token rejected: {err[:120]}",
                        "hint": hint or "Update your GitHub Token in Settings with a Classic PAT (repo scope)."})

    # Build credential URL — classic PAT used as password (most compatible format)
    url = f"https://{gh_user}:{token}@github.com/{repo}.git"
    try:
        if not os.path.isdir(os.path.join(root, ".git")):
            run("git", "init")
        run("git", "config", "user.email", b.get("email", "nexus@nexus.ai"))
        run("git", "config", "user.name", b.get("name", "NEXUS"))
        run("git", "add", "-A")
        run("git", "commit", "-m", b.get("message", "Deploy via NEXUS"))
        run("git", "branch", "-M", branch)
        run("git", "remote", "remove", "origin")
        run("git", "remote", "add", "origin", url)
        push = run("git", "push", "-u", "origin", branch, "--force", timeout=90)
        ok = push.returncode == 0
        safe_log = [(c, rc, out.replace(token, "***")) for c, rc, out in log]
        push_err = (push.stdout + push.stderr)[-200:].replace(token, "***")
        return jsonify({"ok": ok, "repo": f"https://github.com/{repo}",
                        "branch": branch, "log": safe_log,
                        "error": None if ok else push_err})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e).replace(token, "***")}), 500


# ── PAYWALL GENERATOR (for client projects) ──
@bp.route("/paywall/<provider>", methods=["POST"])
def paywall_gen(provider):
    b = request.get_json(force=True) or {}
    return jsonify(PROJ.generate_paywall(provider, **b))


# ── MEDIA GENERATION (free tools) ──
@bp.route("/media/image", methods=["POST"])
def media_image():
    b = request.get_json(force=True) or {}
    return jsonify(MEDIA.generate_image(b.get("prompt", ""), name=b.get("name", ""),
                                        project_id=b.get("project_id", "default")))


@bp.route("/media/video", methods=["POST"])
def media_video():
    b = request.get_json(force=True) or {}
    return jsonify(MEDIA.generate_video(b.get("prompt", ""), name=b.get("name", ""),
                                        project_id=b.get("project_id", "default")))


# ── serve a workspace media file (image/video) ──
@bp.route("/file/<project_id>/<path:fname>")
def serve_media(project_id, fname):
    import mimetypes
    from flask import send_file
    try:
        full = TOOLS._resolve(project_id, fname)
        if not os.path.exists(full):
            return jsonify({"error": "not found"}), 404
        mt = mimetypes.guess_type(full)[0] or "application/octet-stream"
        return send_file(full, mimetype=mt)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── CHAT HISTORY ──
@bp.route("/conversations", methods=["GET"])
def conv_list():
    return jsonify(HIST.list_conversations(request.args.get("project_id")))


@bp.route("/conversations", methods=["POST"])
def conv_create():
    b = request.get_json(force=True) or {}
    return jsonify(HIST.create_conversation(b.get("project_id", "default"),
                                            b.get("title", "")))


@bp.route("/conversations/<cid>", methods=["GET"])
def conv_get(cid):
    return jsonify(HIST.get_conversation(cid))


@bp.route("/conversations/<cid>/message", methods=["POST"])
def conv_msg(cid):
    b = request.get_json(force=True) or {}
    return jsonify(HIST.append_message(cid, b.get("role", "user"),
                                       b.get("content", ""),
                                       b.get("project_id", "default")))


@bp.route("/conversations/<cid>/rename", methods=["POST"])
def conv_rename(cid):
    b = request.get_json(force=True) or {}
    return jsonify(HIST.rename(cid, b.get("title", "")))


@bp.route("/conversations/<cid>", methods=["DELETE"])
def conv_delete(cid):
    return jsonify(HIST.delete(cid))


# ── UPTIME MONITOR / SELF-PING ──
@bp.route("/uptime", methods=["GET"])
def uptime_list():
    return jsonify(UP.list_monitors())


@bp.route("/uptime", methods=["POST"])
def uptime_add():
    b = request.get_json(force=True) or {}
    return jsonify(UP.add(b.get("url", ""), b.get("name", "")))


@bp.route("/uptime/check", methods=["POST"])
def uptime_check():
    b = request.get_json(force=True) or {}
    return jsonify(UP.check_now(b.get("url", "")))


@bp.route("/uptime", methods=["DELETE"])
def uptime_remove():
    b = request.get_json(force=True) or {}
    return jsonify(UP.remove(b.get("url", "")))


def register(app):
    """Attach the blueprint to the main Flask app (idempotent)."""
    if "orchestrator" not in app.blueprints:
        app.register_blueprint(bp)
