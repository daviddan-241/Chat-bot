"""
NEXUS PROJECTS — isolated per-project memory + workspace + paywall generator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each project has its OWN:
  • workspace dir (already sandboxed by tools.project_dir)
  • chat/run history, blackboard memory (held by the engine, keyed by project_id)
  • metadata (name, created, archived, tags)

Projects never share memory — exactly as requested.

PAYWALL GENERATOR:
  generate_paywall(provider, ...) returns REAL, runnable code (Stripe Checkout or
  Flutterwave) that can be dropped into an app NEXUS builds FOR OTHERS. The owner's
  own NEXUS instance has NO paywall. The generated code includes server + client
  pieces and revenue-tracking hooks.
"""

from __future__ import annotations
import json
import os
import time
import uuid
from typing import Dict, Any, List

from . import tools

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECTS_FILE = os.path.join(_DIR, "projects.json")


def _load() -> List[Dict[str, Any]]:
    if not os.path.exists(_PROJECTS_FILE):
        return []
    try:
        with open(_PROJECTS_FILE) as f:
            return json.load(f)
    except Exception:
        return []


def _save(p: List[Dict[str, Any]]):
    with open(_PROJECTS_FILE, "w") as f:
        json.dump(p, f, indent=2)


def list_projects() -> Dict[str, Any]:
    projs = _load()
    # enrich with file counts
    for p in projs:
        try:
            p["file_count"] = tools.list_files("", p["id"]).get("count", 0)
        except Exception:
            p["file_count"] = 0
    active = [p for p in projs if not p.get("archived")]
    archived = [p for p in projs if p.get("archived")]
    return {"active": active, "archived": archived}


def create_project(name: str, tags: List[str] = None) -> Dict[str, Any]:
    pid = "p_" + uuid.uuid4().hex[:10]
    proj = {"id": pid, "name": name or "Untitled Project",
            "tags": tags or [], "archived": False,
            "created_at": time.time(), "updated_at": time.time()}
    projs = _load()
    projs.insert(0, proj)
    _save(projs)
    tools.project_dir(pid)  # create isolated workspace
    return {"ok": True, "project": proj}


def update_project(pid: str, **fields) -> Dict[str, Any]:
    projs = _load()
    for p in projs:
        if p["id"] == pid:
            for k in ("name", "archived", "tags"):
                if k in fields:
                    p[k] = fields[k]
            p["updated_at"] = time.time()
            _save(projs)
            return {"ok": True, "project": p}
    return {"ok": False, "error": "not found"}


def delete_project(pid: str) -> Dict[str, Any]:
    projs = [p for p in _load() if p["id"] != pid]
    _save(projs)
    return {"ok": True}


def project_memory(pid: str) -> Dict[str, Any]:
    """Return the engine's isolated blackboard for this project."""
    from .engine import ENGINE
    bb = ENGINE.blackboards.get(pid, {})
    return {"history": bb.get("history", []),
            "last_plan": bb.get("last_plan"),
            "results_keys": list(bb.get("results", {}).keys())}


# ─────────────────────────────────────────────────────────────────────────────
# PAYWALL GENERATOR — real, runnable code for client projects
# ─────────────────────────────────────────────────────────────────────────────
def generate_paywall(provider: str, project_id: str = "default",
                     price_label: str = "Pro Plan",
                     amount: int = 1000, currency: str = "usd",
                     success_url: str = "https://yourapp.com/success",
                     cancel_url: str = "https://yourapp.com/cancel") -> Dict[str, Any]:
    """Writes paywall files into the project workspace and returns them."""
    provider = (provider or "stripe").lower()
    files: Dict[str, str] = {}

    if provider == "stripe":
        files["paywall/server_stripe.py"] = f'''"""
Stripe paywall — Flask. Set STRIPE_SECRET_KEY in env. Tracks revenue in revenue.json.
Run: pip install flask stripe ; python paywall/server_stripe.py
"""
import json, os, time, stripe
from flask import Flask, request, jsonify, redirect

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
app = Flask(__name__)
REV = os.path.join(os.path.dirname(__file__), "revenue.json")

def _track(amount, currency):
    data = []
    if os.path.exists(REV):
        data = json.load(open(REV))
    data.append({{"amount": amount, "currency": currency, "ts": time.time()}})
    json.dump(data, open(REV, "w"))

@app.route("/create-checkout", methods=["POST"])
def create_checkout():
    sess = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{{"price_data": {{"currency": "{currency}",
            "product_data": {{"name": "{price_label}"}},
            "unit_amount": {amount}}}, "quantity": 1}}],
        success_url="{success_url}",
        cancel_url="{cancel_url}")
    return jsonify({{"url": sess.url}})

@app.route("/webhook", methods=["POST"])
def webhook():
    event = json.loads(request.data)
    if event.get("type") == "checkout.session.completed":
        s = event["data"]["object"]
        _track(s.get("amount_total", {amount}), s.get("currency", "{currency}"))
    return "", 200

@app.route("/revenue")
def revenue():
    data = json.load(open(REV)) if os.path.exists(REV) else []
    total = sum(x["amount"] for x in data)
    return jsonify({{"total_cents": total, "count": len(data), "events": data}})

if __name__ == "__main__":
    app.run(port=4242)
'''
        files["paywall/checkout.html"] = f'''<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{price_label}</title></head><body style="font-family:system-ui;text-align:center;padding:60px">
<h1>{price_label}</h1><p>${amount/100:.2f} {currency.upper()}</p>
<button id="buy" style="padding:14px 28px;font-size:16px;border-radius:10px;background:#635bff;color:#fff;border:none">
Subscribe</button>
<script>
document.getElementById("buy").onclick = async () => {{
  const r = await fetch("/create-checkout", {{method:"POST"}});
  const {{url}} = await r.json(); location.href = url;
}};
</script></body></html>'''

    elif provider == "flutterwave":
        files["paywall/server_flutterwave.py"] = f'''"""
Flutterwave paywall — Flask. Set FLUTTERWAVE_SECRET_KEY in env. Tracks revenue.
Run: pip install flask requests ; python paywall/server_flutterwave.py
"""
import json, os, time, uuid, requests
from flask import Flask, request, jsonify

SECRET = os.environ["FLUTTERWAVE_SECRET_KEY"]
app = Flask(__name__)
REV = os.path.join(os.path.dirname(__file__), "revenue.json")

def _track(amount, currency):
    data = json.load(open(REV)) if os.path.exists(REV) else []
    data.append({{"amount": amount, "currency": currency, "ts": time.time()}})
    json.dump(data, open(REV, "w"))

@app.route("/create-payment", methods=["POST"])
def create_payment():
    body = request.get_json(force=True) or {{}}
    payload = {{
        "tx_ref": "nexus-" + uuid.uuid4().hex,
        "amount": {amount/100:.2f}, "currency": "{currency.upper()}",
        "redirect_url": "{success_url}",
        "customer": {{"email": body.get("email", "customer@example.com")}},
        "customizations": {{"title": "{price_label}"}},
    }}
    r = requests.post("https://api.flutterwave.com/v3/payments",
        json=payload, headers={{"Authorization": f"Bearer {{SECRET}}"}})
    return jsonify(r.json())

@app.route("/verify/<tx_id>")
def verify(tx_id):
    r = requests.get(f"https://api.flutterwave.com/v3/transactions/{{tx_id}}/verify",
        headers={{"Authorization": f"Bearer {{SECRET}}"}}).json()
    if r.get("status") == "success":
        d = r["data"]; _track(int(d["amount"]*100), d["currency"])
    return jsonify(r)

@app.route("/revenue")
def revenue():
    data = json.load(open(REV)) if os.path.exists(REV) else []
    return jsonify({{"total_cents": sum(x["amount"] for x in data), "count": len(data)}})

if __name__ == "__main__":
    app.run(port=4243)
'''
    else:
        return {"ok": False, "error": f"unknown paywall provider '{provider}'"}

    written = []
    for path, content in files.items():
        tools.write_file(path, content, project_id=project_id)
        written.append(path)
    return {"ok": True, "provider": provider, "files": written,
            "note": "Real paywall code written to this project's workspace. "
                    "Set the provider secret key in the deployed app's env. "
                    "Revenue is tracked per-project in paywall/revenue.json."}
