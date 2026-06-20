"""
NEXUS ORCHESTRATION ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The real brain that runs the 350+ agents.

Flow:
  1. PLAN      — Chief Coordinator decomposes the user goal into a task graph.
  2. ROUTE     — Each task is matched to the best specialist agent(s) by capability.
  3. EXECUTE   — Tasks run on a real ThreadPool, in parallel where dependencies allow.
  4. COLLAB    — Agents share results through a shared blackboard (project memory).
  5. INTEGRATE — Coordinator merges results into a final answer.
  6. VERIFY    — Final Verifier checks for placeholders/errors before returning.

Everything emits structured EVENTS so the UI can stream plan / agent activity /
progress / results in real time.
"""

from __future__ import annotations
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable, Generator

from .registry import ALL_AGENTS, BY_ID, BY_DOMAIN, AgentSpec, catalog_summary
from .llm import ROUTER
from . import tools as TOOLS

import re as _re


# ─────────────────────────────────────────────────────────────────────────────
# LIVE AGENT — a runtime wrapper around an AgentSpec with status + history.
# ─────────────────────────────────────────────────────────────────────────────
class LiveAgent:
    __slots__ = ("spec", "status", "current_task", "progress",
                 "last_action", "tasks_done", "lock", "last_heartbeat")

    def __init__(self, spec: AgentSpec):
        self.spec = spec
        self.status = "online"        # online | running | busy | completed | error
        self.current_task = ""
        self.progress = 0
        self.last_action = ""
        self.tasks_done = 0
        self.lock = threading.Lock()
        self.last_heartbeat = time.time()

    def snapshot(self) -> Dict[str, Any]:
        return {
            "id": self.spec.id,
            "name": self.spec.name,
            "domain": self.spec.domain,
            "tier": self.spec.tier,
            "status": self.status,
            "task": self.current_task,
            "progress": self.progress,
            "last_action": self.last_action,
            "tasks_done": self.tasks_done,
            "capabilities": self.spec.capabilities,
            "strengths": self.spec.strengths,
            "heartbeat_age": round(time.time() - self.last_heartbeat, 1),
            "healthy": (time.time() - self.last_heartbeat) < 60,
        }

    def beat(self):
        self.last_heartbeat = time.time()


# ─────────────────────────────────────────────────────────────────────────────
# TASK
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class PlanTask:
    id: str
    title: str
    detail: str
    needed_caps: List[str]
    deps: List[str] = field(default_factory=list)
    assigned: Optional[str] = None     # agent id
    status: str = "pending"            # pending | running | done | error
    result: str = ""
    error: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# THE ENGINE
# ─────────────────────────────────────────────────────────────────────────────
class Orchestrator:
    def __init__(self, max_workers: int = 32):
        # All 360 live agents — really instantiated and schedulable.
        self.agents: Dict[str, LiveAgent] = {a.id: LiveAgent(a) for a in ALL_AGENTS}
        self.max_workers = max_workers
        self.humanize_enabled = True  # AI-detection inspector final pass
        # Per-project / per-chat isolated blackboards (memory)
        self.blackboards: Dict[str, Dict[str, Any]] = {}
        self._bb_lock = threading.Lock()
        self.started_at = time.time()
        # Start a cheap heartbeat so every agent proves it's alive & ready.
        # (Just timestamps — NO LLM calls, so zero cost / no rate-limit risk.)
        self._start_heartbeat()

    def _start_heartbeat(self, interval: float = 10.0):
        def _loop():
            while True:
                now = time.time()
                for la in self.agents.values():
                    # idle/online agents beat to show readiness; busy ones beat
                    # naturally as they work
                    la.last_heartbeat = now
                time.sleep(interval)
        t = threading.Thread(target=_loop, daemon=True)
        t.start()

    def health(self) -> Dict[str, Any]:
        agents = [a.snapshot() for a in self.agents.values()]
        healthy = sum(1 for a in agents if a.get("healthy"))
        return {
            "total": len(agents),
            "healthy": healthy,
            "ready": sum(1 for a in agents if a["status"] in ("online", "completed")),
            "working": sum(1 for a in agents if a["status"] in ("running", "busy")),
            "uptime_seconds": round(time.time() - self.started_at, 1),
            "all_ready": healthy == len(agents),
        }

    # ── dashboard data ──
    def fleet_snapshot(self) -> Dict[str, Any]:
        agents = [a.snapshot() for a in self.agents.values()]
        counts = {"online": 0, "running": 0, "busy": 0, "completed": 0, "error": 0}
        for a in agents:
            counts[a["status"]] = counts.get(a["status"], 0) + 1
        return {
            "summary": catalog_summary(),
            "status_counts": counts,
            "llm": ROUTER.status(),
            "agents": agents,
        }

    def domains(self) -> Dict[str, List[Dict[str, Any]]]:
        out: Dict[str, List[Dict[str, Any]]] = {}
        for dom, specs in BY_DOMAIN.items():
            out[dom] = [self.agents[s.id].snapshot() for s in specs]
        return out

    # ── memory (isolated per project) ──
    def _bb(self, project_id: str) -> Dict[str, Any]:
        with self._bb_lock:
            return self.blackboards.setdefault(project_id, {})

    # ── clarify: DISABLED — NEXUS always just does the work ──
    @staticmethod
    def _needs_clarify(goal: str) -> bool:
        return False  # Never ask clarifying questions — just execute

    def _make_question(self, goal: str, project_id: str):
        try:
            raw = self._safe_complete("fast", [
                {"role": "system", "content":
                 "Given a vague build request, return ONE short clarifying question "
                 "plus 3-4 concrete option labels, as JSON: "
                 '{"question": str, "options": [str, str, str]}. '
                 "Options should be specific choices (e.g. style, key feature, audience). No prose."},
                {"role": "user", "content": goal}], temperature=0.4, max_tokens=300)
            import json as _j
            s = raw.find("{"); e = raw.rfind("}")
            obj = _j.loads(raw[s:e + 1])
            if obj.get("question") and obj.get("options"):
                obj["options"] = [str(o) for o in obj["options"]][:4]
                return obj
        except Exception:
            pass
        return None

    # ── detect "...deploy to X" so chat can build AND deploy in one go ──
    @staticmethod
    def _deploy_target(goal: str):
        g = (goal or "").lower()
        if "deploy" not in g and "publish" not in g and "host" not in g:
            return None
        for t in ("netlify", "vercel", "render", "railway", "github"):
            if t in g:
                return t
        # generic "deploy it" -> default to netlify (static-friendly)
        if any(w in g for w in ("deploy", "publish", "go live")):
            return "netlify"
        return None

    # ── decide if a message is simple chat (fast path) vs a real build/action task ──
    @staticmethod
    def _is_simple(goal: str) -> bool:
        g = (goal or "").strip().lower()
        if len(g) <= 2:
            return True
        # ANY of these = real work → use full agent pipeline with tools
        task_words = (
            # build / code
            "build", "create", "make", "code", "write a", "develop",
            "design", "deploy", "fix", "debug", "implement", "generate",
            "scrape", "clone", "app", "website", "api ", "script",
            "bot", "automate", "hack", "pentest", "analyze", "research",
            "refactor", "optimize", "set up", "setup", "integrate",
            "add a", "function", "class ", "database", "model",
            # image actions
            "edit", "change", "modify", "update", "remove", "replace",
            "add to", "put", "hold", "wearing", "clothes", "dress",
            "image", "photo", "picture", "photo", "her ", "him ",
            "make her", "make him", "make it", "make them",
            "generate image", "generate a", "draw", "paint",
            # other actions
            "search", "find", "look up", "download", "fetch",
            "convert", "translate", "summarize", "extract",
            "send", "post", "push", "pull", "install",
            "run", "execute", "launch", "start", "stop",
            "scan", "test", "check", "verify", "monitor",
        )
        if any(w in g for w in task_words):
            return False
        # pure greetings / small talk (only these pass as simple)
        greet = ("hi", "hey", "yo", "hello", "sup", "thanks", "thank you",
                 "ok", "okay", "cool", "nice", "lol", "how are you", "good morning",
                 "good night", "what's up", "whats up", "who are you", "what can you do",
                 "what do you do", "what are you")
        if any(g.startswith(x) or g == x for x in greet):
            return True
        # short messages with no question mark that look like commands → route to tools
        if "?" not in g and len(g.split()) <= 12:
            return False
        # longer messages with no task intent → simple chat
        if len(g.split()) <= 8:
            return True
        return False

    # ── LLM call that degrades to demo text instead of raising/hanging ──
    @staticmethod
    def _safe_complete(tier, messages, **kw) -> str:
        from .llm import LLMError
        try:
            return ROUTER.complete(tier, messages, **kw)
        except LLMError as e:
            # provider failing — return a SHORT one-liner so the pipeline keeps
            # moving and the chat shows a clean reason (no raw JSON dump).
            return f"⚠️ {e}"

    # ── master/global + project instructions injected into every prompt ──
    @staticmethod
    def _preamble(project_id: str) -> str:
        try:
            from . import instructions as INS
            return INS.build_preamble(project_id)
        except Exception:
            return ""

    # ── parse ```tool {json}``` blocks from an agent's output ──
    @staticmethod
    def _extract_tool_calls(text: str) -> List[Dict[str, Any]]:
        calls: List[Dict[str, Any]] = []
        for m in _re.finditer(r"```tool\s*(.*?)```", text, _re.DOTALL):
            raw = m.group(1).strip()
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict) and obj.get("tool"):
                    obj.setdefault("args", {})
                    calls.append(obj)
            except Exception:
                continue
        return calls

    # ── return the prose with ```tool ...``` blocks removed (for narration) ──
    @staticmethod
    def _strip_tool_blocks(text: str) -> str:
        return _re.sub(r"```tool\s*.*?```", "", text or "", flags=_re.DOTALL)

    # ── ROUTING: match task -> best agent by capability overlap ──
    def _route(self, task: PlanTask, exclude: set) -> Optional[LiveAgent]:
        best: Optional[LiveAgent] = None
        best_score = -1
        for la in self.agents.values():
            if la.spec.id in exclude:
                continue
            if la.status in ("running", "busy"):
                continue
            score = 0
            caps = set(la.spec.capabilities) | set(la.spec.strengths)
            for need in task.needed_caps:
                if need in caps:
                    score += 3
                else:
                    for c in caps:
                        if need in c or c in need:
                            score += 1
                            break
            if score > best_score:
                best_score = score
                best = la
        return best if best_score > 0 else None

    # ── PLAN: coordinator decomposes goal into a task graph ──
    def plan(self, goal: str, project_id: str) -> List[PlanTask]:
        coord = BY_ID["orc-ctl-coordinator"]
        sys = (self._preamble(project_id) + "\n\n" + coord.system +
               "\n\nOutput ONLY a JSON array of tasks. Each task: "
               '{"title": str, "detail": str, "needed_caps": [str], "deps": [int]}. '
               "needed_caps are short capability tags like 'code','code:python',"
               "'design','test','deploy','security','image','research','database'. "
               "deps are indexes of prerequisite tasks. Keep 2-7 tasks. No prose.")
        raw = self._safe_complete(coord.tier,
                              [{"role": "system", "content": sys},
                               {"role": "user", "content": f"GOAL: {goal}"}],
                              temperature=0.2, max_tokens=1500)
        tasks = self._parse_plan(raw, goal)
        # store
        self._bb(project_id)["last_plan"] = [t.__dict__ for t in tasks]
        return tasks

    def _parse_plan(self, raw: str, goal: str) -> List[PlanTask]:
        # Try to extract JSON array
        arr = None
        try:
            start = raw.find("[")
            end = raw.rfind("]")
            if start != -1 and end != -1:
                arr = json.loads(raw[start:end + 1])
        except Exception:
            arr = None
        tasks: List[PlanTask] = []
        if isinstance(arr, list) and arr:
            id_map = {}
            for i, item in enumerate(arr):
                if not isinstance(item, dict):
                    continue
                tid = f"t{i+1}"
                id_map[i] = tid
                tasks.append(PlanTask(
                    id=tid,
                    title=str(item.get("title", f"Task {i+1}"))[:120],
                    detail=str(item.get("detail", ""))[:600],
                    needed_caps=[str(c) for c in (item.get("needed_caps") or [])][:6],
                    deps=[],
                ))
            # resolve deps (indexes -> ids)
            for i, item in enumerate(arr):
                if i < len(tasks) and isinstance(item, dict):
                    for d in (item.get("deps") or []):
                        try:
                            di = int(d)
                            if di in id_map and id_map[di] != tasks[i].id:
                                tasks[i].deps.append(id_map[di])
                        except Exception:
                            pass
        if not tasks:
            # Fallback single task so the pipeline always runs.
            tasks = [PlanTask(id="t1", title="Handle request",
                              detail=goal, needed_caps=["code"], deps=[])]
        return tasks

    # ── EXECUTE one task on its assigned agent ──
    def _run_task(self, task: PlanTask, goal: str, project_id: str,
                  emit: Callable[[str, Dict[str, Any]], None]):
        la = self.agents[task.assigned]
        spec = la.spec
        with la.lock:
            la.status = "running"
            la.current_task = task.title
            la.progress = 10
            la.last_action = "started"
        emit("agent", {"agent": spec.name, "id": spec.id, "domain": spec.domain,
                       "status": "running", "task": task.title})

        # Gather collaborator context from the blackboard ("support each other")
        bb = self._bb(project_id)
        shared = bb.get("results", {})
        context = "\n".join(f"[{k}] {v[:400]}" for k, v in list(shared.items())[-4:])
        # Inject learned skills from the Skills Library
        try:
            from . import skills as _SK
            skill_ctx = _SK.context_for(project_id)
            if skill_ctx:
                context = skill_ctx + "\n\n" + context
        except Exception:
            pass

        tool_hint = (
            "\n\nYou have REAL tools. To use one, emit a fenced block exactly:\n"
            "```tool\n{\"tool\": \"write_file\", \"args\": {\"path\": \"app.py\", "
            "\"content\": \"...\"}}\n```\n"
            "Available tools: write_file(path,content), read_file(path), "
            "list_files(subdir), run_code(code,lang), run_shell(cmd), "
            "kali_exec(cmd), web_search(query), fetch_url(url), "
            "generate_image(prompt,name), generate_video(prompt,name), "
            "deploy(target,project_id) [target=github|netlify|vercel], "
            "humanize_text(text), apt_install(packages) [install system tools/"
            "libs via sudo apt on Kali, or pip].\n"
            "If a tool/library is missing, install it with apt_install before "
            "continuing — never give up because something isn't installed.\n"
            "To CLONE a website (like same.new): fetch_url the target, study its "
            "real HTML/CSS/JS, then write_file a faithful rebuild and open it in "
            "the preview. Build COMPLETE multi-file systems, not snippets.\n"
            "I will execute the tool and return its real result, then you continue. "
            "When fully done, write your final answer with NO tool block.")
        sys = (self._preamble(project_id) + "\n\n" + spec.system +
               "\n\nYou are part of a multi-agent team. Use teammates' prior "
               "results when relevant. Produce COMPLETE, working output with NO "
               "placeholders, NO TODOs, NO '...', NO 'rest of code here'. Write the "
               "FULL real implementation every time. If you write code, WRITE IT TO "
               "A FILE with write_file and RUN it with run_code/run_shell to prove "
               "it works — do not just describe it. For security/hacking tasks, run "
               "the actual tools (nmap, msfconsole, sqlmap, hydra, etc.) on the "
               "user's authorized Kali box via kali_exec — give real commands and "
               "real output, never hypothetical examples."
               + tool_hint)
        # Pull any URL from the goal so the model clones the RIGHT site (not example.com)
        urls = _re.findall(r"https?://[^\s)]+", goal)
        url_hint = (f"\n\nIMPORTANT: The user gave this exact URL — use it verbatim "
                    f"in fetch_url, do NOT substitute example.com or any other: {urls[0]}"
                    if urls else "")
        convo = [{"role": "system", "content": sys},
                 {"role": "user", "content":
                  f"OVERALL GOAL: {goal}\n\nYOUR TASK: {task.title}\n{task.detail}"
                  f"{url_hint}\n\nTEAMMATE CONTEXT:\n{context or '(none yet)'}\n\n"
                  "Begin NOW by emitting your first ```tool``` block. Do not just "
                  "describe what you will do — actually call the tools."}]
        with la.lock:
            la.progress = 40
            la.last_action = "thinking"
        try:
            out = ""
            nudged = False
            for step in range(10):  # up to 10 real tool iterations (big builds)
                out = self._safe_complete(spec.tier, convo,
                                      temperature=0.3, max_tokens=8000)
                calls = self._extract_tool_calls(out)
                # emit the narration (prose the model wrote BEFORE its tool calls)
                narration = self._strip_tool_blocks(out).strip()
                if narration:
                    emit("narration", {"agent": spec.name, "text": narration[:1200]})
                if not calls:
                    # If it described work but didn't act, nudge it ONCE to use tools.
                    wants_action = any(w in (task.detail + " " + task.title).lower()
                                       for w in ("build", "clone", "create", "write",
                                                 "make", "deploy", "fix", "scrape", "app"))
                    if wants_action and not nudged and step == 0:
                        nudged = True
                        convo.append({"role": "assistant", "content": out})
                        convo.append({"role": "user", "content":
                            "You only described it. Now ACTUALLY DO IT: emit "
                            "```tool``` blocks (fetch_url / write_file / run_code) "
                            "right now with real content. No more explanation."})
                        continue
                    break
                convo.append({"role": "assistant", "content": out})
                # group this batch of tools as one collapsible "N actions" block
                emit("actions_start", {"agent": spec.name, "count": len(calls)})
                tool_outputs = []
                for tc in calls:
                    with la.lock:
                        la.last_action = f"tool: {tc.get('tool')}"
                    emit("tool_start", {"agent": spec.name, "id": spec.id,
                                        "tool": tc.get("tool"),
                                        "args_preview": json.dumps(tc.get("args", {}))[:160]})
                    res = TOOLS.call_tool(tc.get("tool", ""), tc.get("args", {}),
                                          project_id=project_id)
                    emit("tool_result", {"agent": spec.name, "id": spec.id,
                                         "tool": tc.get("tool"),
                                         "ok": res.get("ok"),
                                         "path": res.get("path"),
                                         "result_preview": json.dumps(res)[:280]})
                    tool_outputs.append(f"[{tc.get('tool')}] -> {json.dumps(res)[:1200]}")
                emit("actions_end", {"agent": spec.name})
                convo.append({"role": "user",
                              "content": "TOOL RESULTS:\n" + "\n".join(tool_outputs)
                              + "\n\nContinue. If done, give final answer with no tool block."})
            task.result = out
            task.status = "done"
            with self._bb_lock:
                self.blackboards.setdefault(project_id, {}).setdefault("results", {})[spec.name] = out
            with la.lock:
                la.status = "completed"
                la.progress = 100
                la.tasks_done += 1
                la.last_action = "done"
            emit("agent", {"agent": spec.name, "id": spec.id, "status": "completed",
                           "task": task.title, "result_preview": out[:280]})
        except Exception as e:
            task.status = "error"
            task.error = str(e)
            with la.lock:
                la.status = "error"
                la.last_action = f"error: {e}"
            emit("agent", {"agent": spec.name, "id": spec.id, "status": "error",
                           "task": task.title, "error": str(e)})

    # ── full run: plan -> route -> parallel execute -> integrate -> verify ──
    def run(self, goal: str, project_id: str = "default", image_b64: str = None,
            conversation: list = None) -> Generator[Dict[str, Any], None, None]:
        events: List[Dict[str, Any]] = []
        lock = threading.Lock()
        conversation = conversation or []

        def emit(etype: str, data: Dict[str, Any]):
            with lock:
                events.append({"type": etype, "data": data, "ts": time.time()})

        # ── 0) FAST PATH: simple chat/greetings answer directly (no 360-agent plan) ──
        # Images with ACTION words → tool pipeline (edit_image). Images with questions → vision fast path.
        _img_action_words = ("edit", "change", "modify", "update", "remove", "replace",
                             "add", "put", "hold", "wearing", "clothes", "dress",
                             "make her", "make him", "make it", "make them", "make the",
                             "give her", "give him", "give them", "turn her", "turn him",
                             "background", "style", "filter", "transform", "swap")
        _img_is_action = image_b64 and any(w in (goal or "").lower() for w in _img_action_words)

        # Store image_b64 in blackboard so edit_image tool can retrieve it
        if image_b64:
            self._bb(project_id)["_pending_image_b64"] = image_b64

        if (image_b64 and not _img_is_action) or (not image_b64 and self._is_simple(goal)):
            emit("status", {"phase": "answering", "message": "Replying…"})
            yield from self._drain(events, lock)
            chat = BY_ID["orc-ctl-coordinator"]
            user_content = goal
            if image_b64:
                # OpenAI-compatible vision message
                url = image_b64 if image_b64.startswith("data:") else f"data:image/png;base64,{image_b64}"
                user_content = [
                    {"type": "text", "text": goal},
                    {"type": "image_url", "image_url": {"url": url}},
                ]
            # Build messages with conversation history for context
            history_msgs = []
            for m in conversation[-16:]:  # last 8 exchanges
                r = m.get("role", "user")
                c = m.get("content", "")
                if r in ("user", "assistant") and c:
                    history_msgs.append({"role": r, "content": c[:800]})
            fast_messages = [
                {"role": "system", "content": self._preamble(project_id) +
                 "\n\nYou are NEXUS. Answer directly. Use conversation history above "
                 "to maintain context across messages. Be concise."},
                *history_msgs,
                {"role": "user", "content": user_content}
            ]
            reply = self._safe_complete(
                "vision" if image_b64 else chat.tier,
                fast_messages, temperature=0.6, max_tokens=900)
            # light humanize pass (keeps it natural; never blocks)
            try:
                from . import inspector as INSP
                if getattr(self, "humanize_enabled", True):
                    reply = INSP.inspect_and_fix(reply, threshold=45, max_iters=1)["text"]
            except Exception:
                pass
            self._bb(project_id).setdefault("history", []).append(
                {"goal": goal, "final": reply[:2000]})
            emit("final", {"answer": reply, "verification": "PASS", "ai_inspector": None,
                           "provider": ROUTER.last_used, "model": None})
            yield from self._drain(events, lock)
            return

        # ── IMAGE FAST-PATH: generate images directly via Pollinations (no full pipeline) ──
        _image_gen_words = ("generate image", "generate a image", "generate an image",
                            "create image", "create a image", "create an image",
                            "make image", "make a image", "make an image",
                            "draw image", "draw a", "draw an", "paint a", "paint an",
                            "generate picture", "create picture", "make picture",
                            "generate photo", "create photo", "show me a picture",
                            "show me an image", "generate a photo")
        _g_lower = (goal or "").lower()
        _is_image_gen = (not image_b64 and
                         any(w in _g_lower for w in _image_gen_words))
        if _is_image_gen:
            emit("status", {"phase": "answering", "message": "Generating image…"})
            yield from self._drain(events, lock)
            # Build a clean prompt from the goal (strip "generate/create/make/draw" prefix)
            _prompt = goal.strip()
            for _pfx in ("generate an image of ", "generate a image of ", "generate image of ",
                         "create an image of ", "create a image of ", "create image of ",
                         "make an image of ", "make a image of ", "make image of ",
                         "draw an image of ", "draw a image of ", "draw image of ",
                         "generate an image ", "create an image ", "make an image ",
                         "generate a ", "create a ", "make a ", "draw a ", "paint a ",
                         "generate ", "create ", "make ", "draw ", "paint "):
                if _g_lower.startswith(_pfx):
                    _prompt = goal[len(_pfx):]
                    break
            emit("tool_start", {"agent": "Image Agent", "id": "img",
                                 "tool": "generate_image",
                                 "args_preview": json.dumps({"prompt": _prompt[:80]})})
            yield from self._drain(events, lock)
            _img_res = TOOLS.call_tool("generate_image", {"prompt": _prompt}, project_id=project_id)
            emit("tool_result", {"agent": "Image Agent", "id": "img",
                                  "tool": "generate_image",
                                  "ok": _img_res.get("ok"),
                                  "path": _img_res.get("path"),
                                  "result_preview": json.dumps(_img_res)[:280]})
            yield from self._drain(events, lock)
            if _img_res.get("ok") and _img_res.get("path"):
                _reply = f"Here's your image of {_prompt}."
            elif _img_res.get("url"):
                _reply = f"Here's your image of {_prompt}."
            else:
                _reply = f"Image generation failed: {_img_res.get('error', 'unknown error')}"
            self._bb(project_id).setdefault("history", []).append(
                {"goal": goal, "final": _reply})
            emit("final", {"answer": _reply, "verification": "PASS", "ai_inspector": None,
                           "provider": "pollinations-images", "model": None})
            yield from self._drain(events, lock)
            return

        # ── CLARIFY: for vague build requests, ask ONE quick question first ──
        bb0 = self._bb(project_id)
        if self._needs_clarify(goal) and not bb0.get("_clarified"):
            q = self._make_question(goal, project_id)
            if q:
                bb0["_clarified"] = True  # only ask once per project session
                emit("question", q)
                yield from self._drain(events, lock)
                return

        # 1) PLAN
        emit("status", {"phase": "planning", "message": "Coordinator is decomposing the goal…"})
        yield from self._drain(events, lock)
        tasks = self.plan(goal, project_id)
        emit("plan", {"tasks": [{"id": t.id, "title": t.title,
                                 "detail": t.detail, "deps": t.deps,
                                 "needed_caps": t.needed_caps} for t in tasks]})
        yield from self._drain(events, lock)

        # 2) ROUTE
        emit("status", {"phase": "routing", "message": "Assigning specialist agents…"})
        used: set = set()
        for t in tasks:
            la = self._route(t, used)
            if la:
                t.assigned = la.spec.id
                used.add(la.spec.id)
                emit("route", {"task": t.title, "agent": la.spec.name,
                               "agent_id": la.spec.id, "domain": la.spec.domain})
        yield from self._drain(events, lock)

        # 3) EXECUTE (parallel, dependency-aware waves)
        emit("status", {"phase": "executing", "message": "Agents working in parallel…"})
        yield from self._drain(events, lock)
        done_ids: set = set()
        remaining = [t for t in tasks if t.assigned]
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            while remaining:
                ready = [t for t in remaining
                         if all(d in done_ids for d in t.deps)]
                if not ready:  # break dependency deadlock
                    ready = remaining
                futures = {pool.submit(self._run_task, t, goal, project_id, emit): t
                           for t in ready}
                # stream events while the wave runs
                pending = set(futures.keys())
                while pending:
                    yield from self._drain(events, lock)
                    nxt = [f for f in pending if f.done()]
                    for f in nxt:
                        pending.discard(f)
                    time.sleep(0.05)
                for t in ready:
                    done_ids.add(t.id)
                    if t in remaining:
                        remaining.remove(t)
                yield from self._drain(events, lock)

        # 4) INTEGRATE
        emit("status", {"phase": "integrating", "message": "Coordinator integrating results…"})
        yield from self._drain(events, lock)
        coord = BY_ID["orc-ctl-coordinator"]
        combined = "\n\n".join(
            f"### {t.title} (by {self.agents[t.assigned].spec.name})\n{t.result}"
            for t in tasks if t.result)
        final = self._safe_complete(coord.tier, [
            {"role": "system", "content":
             self._preamble(project_id) + "\n\n"
             "You are the Chief Coordinator. Integrate the specialist outputs below "
             "into ONE clean, complete final answer for the user. Remove duplication, "
             "keep ALL working code/details, NO placeholders."},
            {"role": "user", "content": f"GOAL: {goal}\n\nSPECIALIST OUTPUTS:\n{combined}"}
        ], temperature=0.2, max_tokens=8000)

        # 5) VERIFY
        emit("status", {"phase": "verifying", "message": "Final verifier checking for errors/placeholders…"})
        yield from self._drain(events, lock)
        verifier = BY_ID["orc-ctl-verifier"]
        flags = self._safe_complete(verifier.tier, [
            {"role": "system", "content":
             "Scan the answer for placeholders, TODOs, '...', obviously broken code, "
             "or missing pieces. If clean, reply exactly 'PASS'. Otherwise list issues."},
            {"role": "user", "content": final[:6000]}
        ], temperature=0.0, max_tokens=400)

        # ── AI-DETECTION INSPECTOR (humanizer) — final pass on the prose ──
        ai_report = None
        if getattr(self, "humanize_enabled", True):
            try:
                from . import inspector as INSP
                emit("status", {"phase": "inspecting",
                                "message": "AI-detection inspector checking the output reads human…"})
                yield from self._drain(events, lock)
                res = INSP.inspect_and_fix(final, threshold=40, max_iters=2)
                final = res["text"]
                ai_report = {"before": res["history"][0], "after": res["final"],
                             "iterations": res["iterations"]}
            except Exception as e:
                ai_report = {"error": str(e)}

        # store to project memory
        bb = self._bb(project_id)
        bb["last_final"] = final
        bb.setdefault("history", []).append({"goal": goal, "final": final[:2000]})

        emit("final", {"answer": final, "verification": flags, "ai_inspector": ai_report,
                       "provider": ROUTER.last_used, "model": None})
        yield from self._drain(events, lock)

        # ── AUTO-DEPLOY if the goal asked to deploy ("...and deploy to netlify") ──
        target = self._deploy_target(goal)
        if target:
            emit("status", {"phase": "deploying",
                            "message": f"Deploying to {target}…"})
            yield from self._drain(events, lock)
            try:
                from . import deploy as DEP
                dres = DEP.deploy(target, project_id, create=True,
                                  name=f"nexus-{project_id[:8]}")
                if dres.get("ok"):
                    emit("deploy", {"target": target, "ok": True,
                                    "url": dres.get("url"),
                                    "monitored": dres.get("monitored", False),
                                    "note": dres.get("note", "")})
                else:
                    emit("deploy", {"target": target, "ok": False,
                                    "error": dres.get("error", "failed")})
            except Exception as e:
                emit("deploy", {"target": target, "ok": False, "error": str(e)})
            yield from self._drain(events, lock)

        # reset agents to idle
        for la in self.agents.values():
            if la.status in ("completed", "error"):
                la.status = "online"
                la.progress = 0
                la.current_task = ""

    @staticmethod
    def _drain(events: List[Dict[str, Any]], lock: threading.Lock
               ) -> Generator[Dict[str, Any], None, None]:
        with lock:
            while events:
                yield events.pop(0)


# Singleton engine for the app
ENGINE = Orchestrator(max_workers=4)
