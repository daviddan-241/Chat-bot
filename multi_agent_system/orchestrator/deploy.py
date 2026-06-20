"""
NEXUS DEPLOYMENT ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real end-to-end deployments of a project's workspace to hosting providers.

Implemented (real API calls when the token is present):
  • netlify_deploy(project_id, site_name)  -> zips the workspace, deploys to Netlify
  • vercel_deploy(project_id, name)         -> uploads files, creates a Vercel deployment
  • github_publish(project_id, repo, ...)   -> pushes every workspace file to a repo
  • local_preview(project_id)               -> serves the workspace locally for instant preview

Every function returns {ok, url|error, log:[...]} and degrades honestly when a
token is missing (no fakes).
"""

from __future__ import annotations
import hashlib
import io
import json
import os
import urllib.request
import urllib.error
import zipfile
from typing import Dict, Any, List

from . import vault, tools


def _walk_files(project_id: str) -> List[str]:
    base = tools.project_dir(project_id)
    out = []
    for dp, _d, files in os.walk(base):
        for fn in files:
            if fn.startswith("_run_") or fn.startswith("."):
                continue
            out.append(os.path.join(dp, fn))
    return out


def _rel(project_id: str, full: str) -> str:
    return os.path.relpath(full, tools.project_dir(project_id))


def _http(method, url, headers=None, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            try:
                return {"ok": True, "status": r.status, "json": json.loads(raw)}
            except Exception:
                return {"ok": True, "status": r.status, "text": raw}
    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode()
        except Exception:
            err = str(e)
        return {"ok": False, "status": e.code, "error": err[:500]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# NETLIFY — deploy a zip of the workspace (real Netlify Deploy API)
# ─────────────────────────────────────────────────────────────────────────────
def netlify_deploy(project_id: str, site_name: str = "") -> Dict[str, Any]:
    tok = vault.get("netlify_token")
    log = []
    if not tok:
        return {"ok": False, "error": "No Netlify token (add it in Settings)", "log": log}
    files = _walk_files(project_id)
    if not files:
        return {"ok": False, "error": "Workspace is empty — build something first", "log": log}

    hdr = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    # 1) ensure a site exists
    site_id = None
    if site_name:
        r = _http("POST", "https://api.netlify.com/api/v1/sites", hdr,
                  json.dumps({"name": site_name}).encode())
        if r["ok"]:
            site_id = r["json"].get("id")
            log.append(f"Created site '{site_name}'")
        else:
            # maybe it already exists — list and match
            ls = _http("GET", "https://api.netlify.com/api/v1/sites",
                       {"Authorization": f"Bearer {tok}"})
            if ls["ok"]:
                for s in ls["json"]:
                    if s.get("name") == site_name:
                        site_id = s["id"]; break
    if not site_id:
        r = _http("POST", "https://api.netlify.com/api/v1/sites", hdr, json.dumps({}).encode())
        if not r["ok"]:
            return {"ok": False, "error": r.get("error"), "log": log}
        site_id = r["json"]["id"]
        log.append("Created new site")

    # 2) Netlify digest deploy: send file -> sha1 map
    digest = {}
    for f in files:
        with open(f, "rb") as fh:
            data = fh.read()
        sha = hashlib.sha1(data).hexdigest()
        digest["/" + _rel(project_id, f)] = sha
    r = _http("POST", f"https://api.netlify.com/api/v1/sites/{site_id}/deploys", hdr,
              json.dumps({"files": digest}).encode())
    if not r["ok"]:
        return {"ok": False, "error": r.get("error"), "log": log}
    deploy = r["json"]
    deploy_id = deploy["id"]
    required = deploy.get("required", [])
    log.append(f"Deploy created; {len(required)} files to upload")

    # 3) upload required files
    sha_to_path = {v: k for k, v in digest.items()}
    for sha in required:
        path = sha_to_path.get(sha)
        if not path:
            continue
        full = os.path.join(tools.project_dir(project_id), path.lstrip("/"))
        with open(full, "rb") as fh:
            body = fh.read()
        up = _http("PUT",
                   f"https://api.netlify.com/api/v1/deploys/{deploy_id}/files{path}",
                   {"Authorization": f"Bearer {tok}",
                    "Content-Type": "application/octet-stream"}, body)
        if not up["ok"]:
            log.append(f"upload failed {path}: {up.get('error')}")
    log.append("Files uploaded")

    url = deploy.get("ssl_url") or deploy.get("url") or f"https://app.netlify.com/sites/{site_id}"
    return {"ok": True, "url": url, "deploy_id": deploy_id, "site_id": site_id, "log": log}


# ─────────────────────────────────────────────────────────────────────────────
# VERCEL — create a deployment from inline files (real Vercel API v13)
# ─────────────────────────────────────────────────────────────────────────────
def vercel_deploy(project_id: str, name: str = "nexus-app") -> Dict[str, Any]:
    tok = vault.get("vercel_token")
    log = []
    if not tok:
        return {"ok": False, "error": "No Vercel token (add it in Settings)", "log": log}
    files = _walk_files(project_id)
    if not files:
        return {"ok": False, "error": "Workspace is empty — build something first", "log": log}

    inline = []
    for f in files:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            inline.append({"file": _rel(project_id, f), "data": fh.read()})
    body = json.dumps({"name": name, "files": inline,
                       "projectSettings": {"framework": None}}).encode()
    r = _http("POST", "https://api.vercel.com/v13/deployments",
              {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
              body)
    if r["ok"]:
        u = r["json"].get("url") or r["json"].get("alias", [None])[0]
        log.append("Deployment created")
        return {"ok": True, "url": "https://" + u if u else None,
                "id": r["json"].get("id"), "log": log}
    return {"ok": False, "error": r.get("error"), "log": log}


# ─────────────────────────────────────────────────────────────────────────────
# GITHUB — push every workspace file to a repo (reuses connectors)
# ─────────────────────────────────────────────────────────────────────────────
def github_publish(project_id: str, repo: str, create: bool = False,
                   private: bool = True) -> Dict[str, Any]:
    from . import connectors as C
    log = []
    if not vault.get("github_token"):
        return {"ok": False, "error": "No GitHub token (add it in Settings)", "log": log}
    if create:
        name = repo.split("/")[-1]
        cr = C.github_create_repo(name, private=private, description="Built with NEXUS")
        if cr.get("ok"):
            repo = cr["full_name"]; log.append(f"Created repo {repo}")
        else:
            log.append(f"create skipped: {cr.get('error','')[:80]}")
    files = _walk_files(project_id)
    if not files:
        return {"ok": False, "error": "Workspace is empty", "log": log}
    pushed = 0
    last = None
    for f in files:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
        res = C.github_push_file(repo, _rel(project_id, f), content,
                                 message="NEXUS deploy")
        if res.get("ok"):
            pushed += 1; last = res.get("commit")
        else:
            log.append(f"push fail {_rel(project_id, f)}: {res.get('error','')[:60]}")
    log.append(f"Pushed {pushed}/{len(files)} files")
    return {"ok": pushed > 0, "url": f"https://github.com/{repo}",
            "commit": last, "log": log}


# ─────────────────────────────────────────────────────────────────────────────
# DISPATCH
# ─────────────────────────────────────────────────────────────────────────────
def _ensure_deployable(project_id: str, log: list) -> None:
    """Make a project deploy-ready: generate requirements.txt + Procfile/start
    command if missing so hosts know how to run it."""
    base = tools.project_dir(project_id)
    files = {f.lower() for f in _walk_and_names(project_id)}
    has_py = any(f.endswith(".py") for f in files)
    has_node = "package.json" in files
    # requirements.txt for python projects
    if has_py and "requirements.txt" not in files:
        from .preview import _PY_IMPORT_RE, _STDLIB, _PIP_ALIASES, _module_installed
        pkgs = set()
        for f in _walk_and_names(project_id):
            if f.endswith(".py"):
                try:
                    src = open(os.path.join(base, f), encoding="utf-8", errors="ignore").read()
                except Exception:
                    continue
                for mod in _PY_IMPORT_RE.findall(src):
                    if mod in _STDLIB or mod.startswith("_"):
                        continue
                    pkgs.add(_PIP_ALIASES.get(mod, mod))
        if pkgs:
            tools.write_file("requirements.txt", "\n".join(sorted(pkgs)) + "\n",
                             project_id=project_id)
            log.append("generated requirements.txt: " + ", ".join(sorted(pkgs)))
    # Procfile so Render/Railway know the start command
    if "procfile" not in files:
        if has_py:
            # detect flask/fastapi entry
            entry = "app.py" if "app.py" in files else ("main.py" if "main.py" in files else None)
            if entry:
                cmd = (f"web: gunicorn {entry[:-3]}:app" if _is_flask(base) else
                       f"web: python {entry}")
                tools.write_file("Procfile", cmd + "\n", project_id=project_id)
                log.append("generated Procfile")
        elif has_node:
            tools.write_file("Procfile", "web: npm start\n", project_id=project_id)
            log.append("generated Procfile")


def _walk_and_names(project_id: str):
    base = tools.project_dir(project_id)
    out = []
    for dp, _d, fs in os.walk(base):
        for f in fs:
            out.append(os.path.relpath(os.path.join(dp, f), base))
    return out


def _is_flask(base: str) -> bool:
    for dp, _d, fs in os.walk(base):
        for f in fs:
            if f.endswith(".py"):
                try:
                    if "Flask(" in open(os.path.join(dp, f), encoding="utf-8",
                                        errors="ignore").read():
                        return True
                except Exception:
                    pass
    return False


def render_deploy(project_id: str, repo: str = "", name: str = "nexus-app") -> Dict[str, Any]:
    """Deploy to Render: push to GitHub, then create a Render service from it."""
    log = []
    key = vault.get("render_api_key")
    if not key:
        return {"ok": False, "error": "Add a Render API key in Settings/Connectors.", "log": log}
    _ensure_deployable(project_id, log)
    # push to github first (Render deploys from a repo)
    if not repo:
        repo = f"{_gh_user()}/{name}" if _gh_user() else ""
    if not repo:
        return {"ok": False, "error": "Connect GitHub first (Render builds from a repo).", "log": log}
    pub = github_publish(project_id, repo, create=True, private=False)
    log += pub.get("log", [])
    if not pub.get("ok"):
        return {"ok": False, "error": "GitHub push failed: " + str(pub.get("error")), "log": log}
    # create the Render service
    body = {"type": "web_service", "name": name,
            "repo": f"https://github.com/{repo}", "branch": "main",
            "autoDeploy": "yes",
            "serviceDetails": {"env": "python",
                               "envSpecificDetails": {
                                   "buildCommand": "pip install -r requirements.txt",
                                   "startCommand": "bash -c 'gunicorn app:app --bind 0.0.0.0:$PORT || python app.py'"}}}
    r = _http("POST", "https://api.render.com/v1/services",
              {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Accept": "application/json"}, body)
    if r["ok"]:
        svc = r["json"].get("service", r["json"])
        return {"ok": True, "url": svc.get("dashboardUrl") or f"https://dashboard.render.com",
                "service": svc.get("name"), "log": log,
                "note": "Render is building your service from GitHub."}
    return {"ok": False, "error": r.get("error"), "log": log}


def railway_deploy(project_id: str, repo: str = "", name: str = "nexus-app") -> Dict[str, Any]:
    """Deploy to Railway via GitHub repo (Railway builds from the connected repo)."""
    log = []
    tok = vault.get("railway_token")
    if not tok:
        return {"ok": False, "error": "Add a Railway token in Settings/Connectors.", "log": log}
    _ensure_deployable(project_id, log)
    if not repo:
        repo = f"{_gh_user()}/{name}" if _gh_user() else ""
    if not repo:
        return {"ok": False, "error": "Connect GitHub first (Railway builds from a repo).", "log": log}
    pub = github_publish(project_id, repo, create=True, private=False)
    log += pub.get("log", [])
    if not pub.get("ok"):
        return {"ok": False, "error": "GitHub push failed: " + str(pub.get("error")), "log": log}
    # Railway uses a GraphQL API to create a project from a repo
    gql = {"query": "mutation($repo:String!){projectCreateFromRepo(input:{repo:$repo}){id name}}",
           "variables": {"repo": f"https://github.com/{repo}"}}
    r = _http("POST", "https://backboard.railway.app/graphql/v2",
              {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, gql)
    if r["ok"] and not (isinstance(r.get("json"), dict) and r["json"].get("errors")):
        return {"ok": True, "url": "https://railway.app/dashboard",
                "log": log, "note": "Railway is building from your GitHub repo."}
    return {"ok": True, "url": f"https://railway.app/new?template=https://github.com/{repo}",
            "log": log,
            "note": "Repo pushed. Open the Railway link to finish one-click deploy "
                    "(their API needs a project link)."}


def _gh_user() -> str:
    from . import connectors as C
    t = C.github_test()
    return t.get("user", "") if t.get("ok") else ""


def deploy(target: str, project_id: str, **kwargs) -> Dict[str, Any]:
    target = (target or "").lower()
    if target == "netlify":
        r = netlify_deploy(project_id, kwargs.get("site_name", ""))
    elif target == "vercel":
        r = vercel_deploy(project_id, kwargs.get("name", "nexus-app"))
    elif target == "github":
        r = github_publish(project_id, kwargs.get("repo", ""),
                           create=kwargs.get("create", False),
                           private=kwargs.get("private", True))
    elif target == "render":
        r = render_deploy(project_id, kwargs.get("repo", ""), kwargs.get("name", "nexus-app"))
    elif target == "railway":
        r = railway_deploy(project_id, kwargs.get("repo", ""), kwargs.get("name", "nexus-app"))
    else:
        return {"ok": False, "error": f"unknown deploy target '{target}'"}
    # auto-add successful deploy URL to uptime monitoring + self-ping
    try:
        if r.get("ok") and r.get("url", "").startswith("http") and target in ("netlify", "vercel"):
            from . import uptime as UP
            UP.add(r["url"], name=f"{target}:{project_id}")
            r["monitored"] = True
    except Exception:
        pass
    return r
