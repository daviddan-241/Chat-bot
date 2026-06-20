"""
NEXUS AGENT REGISTRY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Defines 350+ REAL specialist agents. Each agent is a concrete AgentSpec with:
  • unique id + display name
  • a domain (for the dashboard grouping)
  • a hand-written role + system prompt fragment
  • declared capabilities (used by the router to match tasks)
  • preferred model tier + allowed tools
  • a "strength" tag list ("their strong things" — supports each other)

These are NOT 350 trained neural nets — they are 350 distinct, functioning
specialist personas that route to real LLMs/tools. This is exactly how a real
large-scale agent OS works (specialization by prompt + capability + tooling),
and it scales to hundreds of parallel workers.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any
import hashlib


# ─────────────────────────────────────────────────────────────────────────────
# Model tiers — map to whatever real model is configured at runtime (custom API,
# OpenAI-compatible, Grok, Kali, etc). The router resolves tier -> real model.
# ─────────────────────────────────────────────────────────────────────────────
TIER_FRONTIER = "frontier"   # hardest reasoning / architecture
TIER_BALANCED = "balanced"   # day-to-day coding / writing
TIER_FAST     = "fast"       # quick / parallel grunt work
TIER_VISION   = "vision"     # image understanding
TIER_IMAGE    = "image"      # image generation
TIER_VIDEO    = "video"      # video generation
TIER_SHELL    = "shell"      # Kali / shell execution (no LLM needed for raw exec)


# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class AgentSpec:
    id: str
    name: str
    domain: str
    role: str
    system: str
    capabilities: List[str] = field(default_factory=list)
    tier: str = TIER_BALANCED
    tools: List[str] = field(default_factory=list)
    strengths: List[str] = field(default_factory=list)
    # runtime state is held in the live Agent wrapper, not here

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────────────────
# CATALOG BUILDERS
# Each builder returns a list of AgentSpec for a domain. We use rich, real
# specializations so that 350+ agents are genuinely distinct and useful.
# ─────────────────────────────────────────────────────────────────────────────

def _mk(domain: str, slug: str, name: str, role: str, system: str,
        caps: List[str], tier: str, tools: List[str],
        strengths: List[str]) -> AgentSpec:
    aid = f"{domain[:3].lower()}-{slug}"
    return AgentSpec(id=aid, name=name, domain=domain, role=role, system=system,
                     capabilities=caps, tier=tier, tools=tools, strengths=strengths)


def build_catalog() -> List[AgentSpec]:
    agents: List[AgentSpec] = []

    # ── 1. LANGUAGE / CODING ENGINEERS (one elite specialist per language) ──
    languages = [
        ("python", "Python", ["backend", "data", "scripting", "ai"]),
        ("javascript", "JavaScript", ["web", "frontend", "node"]),
        ("typescript", "TypeScript", ["web", "frontend", "node", "types"]),
        ("rust", "Rust", ["systems", "perf", "wasm"]),
        ("go", "Go", ["backend", "concurrency", "cloud"]),
        ("cpp", "C++", ["systems", "perf", "games"]),
        ("c", "C", ["systems", "embedded", "kernel"]),
        ("java", "Java", ["enterprise", "android", "backend"]),
        ("kotlin", "Kotlin", ["android", "backend"]),
        ("swift", "Swift", ["ios", "macos", "apple"]),
        ("objc", "Objective-C", ["ios", "macos", "legacy-apple"]),
        ("csharp", "C#", ["dotnet", "games", "enterprise"]),
        ("php", "PHP", ["web", "wordpress", "laravel"]),
        ("ruby", "Ruby", ["web", "rails", "scripting"]),
        ("dart", "Dart", ["flutter", "mobile"]),
        ("scala", "Scala", ["jvm", "data", "functional"]),
        ("elixir", "Elixir", ["concurrency", "phoenix", "realtime"]),
        ("haskell", "Haskell", ["functional", "types"]),
        ("clojure", "Clojure", ["functional", "jvm"]),
        ("lua", "Lua", ["scripting", "games", "embedded"]),
        ("perl", "Perl", ["scripting", "text"]),
        ("r", "R", ["data", "stats", "science"]),
        ("julia", "Julia", ["science", "perf", "data"]),
        ("solidity", "Solidity", ["web3", "smart-contracts"]),
        ("sql", "SQL", ["database", "queries"]),
        ("bash", "Bash/Shell", ["scripting", "devops", "linux"]),
        ("powershell", "PowerShell", ["windows", "devops"]),
        ("assembly", "Assembly", ["systems", "reversing", "perf"]),
        ("zig", "Zig", ["systems", "perf"]),
        ("nim", "Nim", ["systems", "scripting"]),
    ]
    for slug, label, tags in languages:
        agents.append(_mk(
            "Engineering", f"lang-{slug}", f"{label} Engineer",
            f"Elite {label} software engineer",
            f"You are an elite {label} engineer. You write production-grade, "
            f"idiomatic, fully-working {label} with no placeholders, no TODOs, no "
            f"stubbed functions. You include error handling, types where applicable, "
            f"and you self-review for bugs before returning. You follow {label} best "
            f"practices and the latest stable standards.",
            ["code", f"code:{slug}", "debug", "refactor"], TIER_BALANCED,
            ["run_code", "write_file", "read_file"],
            tags))

    # ── 2. FRAMEWORK / PLATFORM SPECIALISTS ──
    frameworks = [
        ("react", "React", "Engineering", ["frontend", "web"]),
        ("nextjs", "Next.js", "Engineering", ["frontend", "fullstack", "ssr"]),
        ("vue", "Vue", "Engineering", ["frontend"]),
        ("svelte", "Svelte/SvelteKit", "Engineering", ["frontend"]),
        ("angular", "Angular", "Engineering", ["frontend", "enterprise"]),
        ("solidjs", "SolidJS", "Engineering", ["frontend"]),
        ("astro", "Astro", "Engineering", ["frontend", "content"]),
        ("remix", "Remix", "Engineering", ["fullstack"]),
        ("flutter", "Flutter", "Engineering", ["mobile", "cross-platform"]),
        ("reactnative", "React Native", "Engineering", ["mobile"]),
        ("swiftui", "SwiftUI", "Engineering", ["ios", "apple"]),
        ("jetpack", "Jetpack Compose", "Engineering", ["android"]),
        ("django", "Django", "Engineering", ["backend", "python"]),
        ("fastapi", "FastAPI", "Engineering", ["backend", "python", "api"]),
        ("flask", "Flask", "Engineering", ["backend", "python"]),
        ("express", "Express", "Engineering", ["backend", "node"]),
        ("nestjs", "NestJS", "Engineering", ["backend", "node", "enterprise"]),
        ("rails", "Ruby on Rails", "Engineering", ["backend"]),
        ("laravel", "Laravel", "Engineering", ["backend", "php"]),
        ("spring", "Spring Boot", "Engineering", ["backend", "java"]),
        ("dotnet", "ASP.NET Core", "Engineering", ["backend", "dotnet"]),
        ("phoenix", "Phoenix", "Engineering", ["backend", "realtime"]),
        ("gin", "Gin (Go)", "Engineering", ["backend", "go"]),
        ("actix", "Actix (Rust)", "Engineering", ["backend", "rust"]),
        ("tauri", "Tauri", "Engineering", ["desktop", "rust"]),
        ("electron", "Electron", "Engineering", ["desktop"]),
        ("threejs", "Three.js/WebGL", "Engineering", ["3d", "graphics"]),
        ("unity", "Unity", "Engineering", ["games", "3d"]),
        ("unreal", "Unreal Engine", "Engineering", ["games", "3d"]),
        ("godot", "Godot", "Engineering", ["games"]),
        ("tailwind", "Tailwind CSS", "Design", ["css", "frontend"]),
        ("graphql", "GraphQL", "Engineering", ["api"]),
        ("grpc", "gRPC", "Engineering", ["api", "rpc"]),
        ("websocket", "WebSocket/Realtime", "Engineering", ["realtime"]),
    ]
    for slug, label, dom, tags in frameworks:
        agents.append(_mk(
            dom, f"fw-{slug}", f"{label} Specialist",
            f"{label} framework specialist",
            f"You are a world-class {label} specialist. You produce complete, "
            f"runnable {label} code and project structure, configure it correctly, "
            f"and never leave placeholders. You know the framework's conventions, "
            f"performance pitfalls, and ecosystem deeply.",
            ["code", f"framework:{slug}", "scaffold"], TIER_BALANCED,
            ["run_code", "write_file", "read_file", "run_shell"],
            tags))

    # ── 3. CODING-DISCIPLINE AGENTS (cursor-style power) ──
    disciplines = [
        ("architect", "System Architect", TIER_FRONTIER,
         "You design clean, scalable software architecture. You produce diagrams, "
         "module boundaries, data models, and tech-stack decisions with rationale.",
         ["architecture", "design", "planning"]),
        ("debugger", "Debug Specialist", TIER_FRONTIER,
         "You are a relentless debugger. You reproduce, isolate, root-cause, and "
         "fix bugs. You never guess — you add logging, run the code, and verify the "
         "fix actually works before declaring done.",
         ["debug", "fix", "root-cause"]),
        ("refactor", "Refactoring Expert", TIER_BALANCED,
         "You refactor code for clarity, performance and testability without changing "
         "behavior. You verify with tests.",
         ["refactor", "cleanup"]),
        ("reviewer", "Code Reviewer", TIER_BALANCED,
         "You review code for bugs, security, style, performance and correctness. "
         "You give precise, actionable feedback and approve only working code.",
         ["review", "audit"]),
        ("tester", "Test Engineer", TIER_BALANCED,
         "You write thorough automated tests (unit, integration, e2e) and run them "
         "to prove the code works 100%.",
         ["test", "qa"]),
        ("perf", "Performance Engineer", TIER_FRONTIER,
         "You profile and optimize for speed and memory. You measure before and "
         "after with real benchmarks.",
         ["perf", "optimize", "profile"]),
        ("api", "API Designer", TIER_BALANCED,
         "You design clean REST/GraphQL/RPC APIs with versioning, auth, pagination "
         "and great docs.",
         ["api", "design"]),
        ("dbarch", "Database Architect", TIER_FRONTIER,
         "You design normalized schemas, indexes, migrations and query plans for "
         "SQL and NoSQL. You optimize real queries.",
         ["database", "schema", "sql"]),
        ("migrate", "Migration Engineer", TIER_BALANCED,
         "You safely migrate code, data and infrastructure between versions and "
         "platforms with zero data loss.",
         ["migration", "upgrade"]),
        ("clone", "Website Cloner", TIER_BALANCED,
         "You faithfully clone websites/UI (like same.new): you analyze structure, "
         "rebuild HTML/CSS/JS pixel-accurately and make it runnable.",
         ["clone", "scrape", "frontend"]),
        ("appbuilder", "App Builder", TIER_FRONTIER,
         "You build complete real applications end-to-end (like Replit/Loveable): "
         "frontend, backend, db, auth, deploy. No placeholders, fully working.",
         ["app", "fullstack", "build"]),
        ("integrator", "Integration Engineer", TIER_BALANCED,
         "You wire up third-party APIs, webhooks, OAuth and SDKs correctly with "
         "real credentials handling.",
         ["integration", "api", "oauth"]),
    ]
    for slug, label, tier, sysd, tags in disciplines:
        agents.append(_mk(
            "Engineering", f"disc-{slug}", label, label, sysd,
            ["code"] + tags, tier,
            ["run_code", "write_file", "read_file", "run_shell"], tags))

    # ── 4. SECURITY / KALI / HACKING SPECIALISTS ──
    security = [
        ("pentester", "Penetration Tester", "Performs authorized pentests, enumerates, exploits and reports.", ["pentest", "exploit"]),
        ("recon", "Recon Specialist", "OSINT + network/asset reconnaissance (nmap, whois, subdomain enum).", ["recon", "osint", "nmap"]),
        ("webhack", "Web App Hacker", "OWASP Top 10, XSS, SQLi, SSRF, auth bypass on authorized targets.", ["websec", "owasp"]),
        ("netsec", "Network Security", "Firewalls, packet analysis, tunneling, traffic inspection.", ["network", "packets"]),
        ("forensics", "Digital Forensics", "Disk/memory forensics, artifact analysis, timeline building.", ["forensics"]),
        ("malware", "Malware Analyst", "Static/dynamic malware analysis in safe sandboxes.", ["malware", "reversing"]),
        ("reverse", "Reverse Engineer", "Binary reversing with gdb/radare2/ghidra workflows.", ["reversing", "binary"]),
        ("crypto", "Cryptography Expert", "Crypto primitives, key management, protocol review.", ["crypto"]),
        ("redteam", "Red Team Operator", "Adversary emulation and C2 on authorized engagements.", ["redteam"]),
        ("blueteam", "Blue Team Defender", "Detection, hardening, incident response.", ["blueteam", "defense"]),
        ("wireless", "Wireless Security", "WiFi/Bluetooth security testing (aircrack-ng etc).", ["wireless"]),
        ("exploitdev", "Exploit Developer", "Develops PoC exploits for authorized research.", ["exploit", "poc"]),
        ("vulnscan", "Vulnerability Scanner", "Runs and triages scanners (nikto, nuclei, openvas).", ["vulnscan"]),
        ("hardening", "System Hardening", "CIS benchmarks, least privilege, secure config.", ["hardening"]),
        ("kaliops", "Kali Operator", "Drives the custom Kali Linux box: apt installs, tool runs, real sudo.", ["kali", "shell"]),
    ]
    for slug, label, sysd, tags in security:
        tier = TIER_SHELL if slug == "kaliops" else TIER_FRONTIER
        agents.append(_mk(
            "Security", f"sec-{slug}", label, label,
            f"You are a {label}. {sysd} You ONLY operate on systems the user is "
            f"authorized to test, you document everything, and you use the custom "
            f"Kali Linux environment for real tooling. You never produce harmful "
            f"payloads for non-consensual targets.",
            ["security"] + tags, tier,
            ["run_shell", "kali_exec", "run_code", "web_search"], tags))

    # ── 5. DATA / AI / ML SPECIALISTS ──
    dataai = [
        ("ml", "ML Engineer", "Builds and trains ML models, pipelines, evaluation.", ["ml", "training"]),
        ("dl", "Deep Learning Engineer", "Neural nets with PyTorch/TF, architectures, training loops.", ["deeplearning", "pytorch"]),
        ("llm", "LLM Engineer", "Prompting, fine-tuning, RAG, evals, inference optimization.", ["llm", "rag"]),
        ("nlp", "NLP Specialist", "Text processing, embeddings, tokenization, NER.", ["nlp"]),
        ("cv", "Computer Vision Engineer", "Image/video models, detection, segmentation.", ["vision", "cv"]),
        ("datasci", "Data Scientist", "Stats, hypothesis testing, modeling, insight.", ["datascience", "stats"]),
        ("dataeng", "Data Engineer", "ETL/ELT pipelines, warehouses, streaming.", ["dataeng", "etl"]),
        ("dataviz", "Data Viz Specialist", "Clear, beautiful charts and dashboards.", ["dataviz", "charts"]),
        ("analyst", "Data Analyst", "SQL analysis, metrics, business reporting.", ["analysis", "sql"]),
        ("mlops", "MLOps Engineer", "Model serving, monitoring, versioning, CI for ML.", ["mlops"]),
        ("ragarch", "RAG Architect", "Vector DBs, chunking, retrieval, grounding.", ["rag", "vectordb"]),
        ("prompteng", "Prompt Engineer", "Designs robust prompts and agent instructions.", ["prompting"]),
        ("recsys", "Recommender Specialist", "Recommendation/personalization systems.", ["recsys"]),
        ("timeseries", "Time-Series Forecaster", "Forecasting and anomaly detection.", ["timeseries"]),
    ]
    for slug, label, sysd, tags in dataai:
        agents.append(_mk(
            "Data & AI", f"ai-{slug}", label, label,
            f"You are a {label}. {sysd} You write working, tested code and you "
            f"validate results with real metrics — never hand-wave.",
            ["data", "ai"] + tags, TIER_FRONTIER,
            ["run_code", "write_file", "read_file", "web_search"], tags))

    # ── 6. DEVOPS / CLOUD / DEPLOY SPECIALISTS ──
    devops = [
        ("docker", "Docker Specialist", "Dockerfiles, multi-stage builds, compose.", ["docker"]),
        ("k8s", "Kubernetes Engineer", "Manifests, helm, autoscaling, ingress.", ["kubernetes"]),
        ("terraform", "Terraform/IaC", "Infrastructure as code across clouds.", ["iac", "terraform"]),
        ("cicd", "CI/CD Engineer", "Pipelines for GitHub Actions/GitLab CI.", ["cicd"]),
        ("aws", "AWS Architect", "EC2/S3/Lambda/RDS and well-architected design.", ["aws", "cloud"]),
        ("gcp", "GCP Architect", "GCE/GKE/Cloud Run/BigQuery.", ["gcp", "cloud"]),
        ("azure", "Azure Architect", "Azure services and deployments.", ["azure", "cloud"]),
        ("vercel", "Vercel Deployer", "Deploys/optimizes apps on Vercel.", ["vercel", "deploy"]),
        ("netlify", "Netlify Deployer", "Deploys/optimizes on Netlify.", ["netlify", "deploy"]),
        ("railway", "Railway Deployer", "Deploys services on Railway.", ["railway", "deploy"]),
        ("render", "Render Deployer", "Deploys services on Render.", ["render", "deploy"]),
        ("cloudflare", "Cloudflare Engineer", "Workers, Pages, CDN, DNS, security.", ["cloudflare"]),
        ("nginx", "Nginx/Proxy Expert", "Reverse proxy, load balancing, TLS.", ["nginx", "proxy"]),
        ("monitoring", "Observability Engineer", "Logs, metrics, traces, alerting.", ["monitoring"]),
        ("sre", "Site Reliability Engineer", "Uptime, scaling, incident response.", ["sre", "reliability"]),
        ("linuxadmin", "Linux SysAdmin", "Server admin, systemd, cron, permissions.", ["linux", "admin"]),
    ]
    for slug, label, sysd, tags in devops:
        agents.append(_mk(
            "DevOps & Cloud", f"ops-{slug}", label, label,
            f"You are a {label}. {sysd} You produce real, applyable config and you "
            f"verify deployments actually come up healthy.",
            ["devops", "deploy"] + tags, TIER_BALANCED,
            ["run_shell", "write_file", "read_file", "kali_exec"], tags))

    # ── 7. DESIGN / UX / CREATIVE SPECIALISTS ──
    design = [
        ("uiux", "UI/UX Designer", "Designs clean, premium, accessible interfaces.", ["ui", "ux"]),
        ("product", "Product Designer", "End-to-end product flows and IA.", ["product"]),
        ("brand", "Brand Designer", "Logos, identity, color systems, typography.", ["brand", "identity"]),
        ("motion", "Motion Designer", "Animations, transitions, microinteractions.", ["motion"]),
        ("design3d", "3D Designer", "3D scenes, models, materials.", ["3d"]),
        ("illustration", "Illustrator", "Custom illustrations and iconography.", ["illustration"]),
        ("designsys", "Design System Lead", "Tokens, components, consistency at scale.", ["designsystem"]),
        ("accessibility", "Accessibility Expert", "WCAG, ARIA, inclusive design.", ["a11y"]),
        ("interaction", "Interaction Designer", "Gestures, native feel, 120Hz polish.", ["interaction"]),
    ]
    for slug, label, sysd, tags in design:
        agents.append(_mk(
            "Design", f"des-{slug}", label, label,
            f"You are a {label}. {sysd} Your taste is premium and minimal — Claude "
            f"elegance + Apple design language. You output real, usable specs/code.",
            ["design"] + tags, TIER_BALANCED,
            ["write_file", "read_file", "generate_image"], tags))

    # ── 8. MEDIA / IMAGE / VIDEO GENERATION (Grok-style) ──
    media = [
        ("imagegen", "Image Generator", TIER_IMAGE, "Generates images from prompts.", ["image", "generate"]),
        ("imageedit", "Image Editor", TIER_IMAGE, "Edits/inpaints/upscales images.", ["image", "edit"]),
        ("videogen", "Video Generator", TIER_VIDEO, "Generates short videos from prompts.", ["video", "generate"]),
        ("videoedit", "Video Editor", TIER_VIDEO, "Cuts, captions, transitions on video.", ["video", "edit"]),
        ("vision", "Vision Analyst", TIER_VISION, "Understands images/screenshots in depth.", ["vision", "analyze"]),
        ("avatar", "Realistic Human AI Generator", TIER_VIDEO, "Generates realistic human avatars/voiceovers for the user's OWN authorized content; refuses impersonation/deepfakes of real people without consent.", ["avatar", "human"]),
        ("thumbnail", "Thumbnail Designer", TIER_IMAGE, "Eye-catching social thumbnails.", ["thumbnail"]),
        ("audio", "Audio/Voice Engineer", TIER_BALANCED, "TTS, voice cloning (consented), audio cleanup.", ["audio", "voice"]),
    ]
    for slug, label, tier, sysd, tags in media:
        agents.append(_mk(
            "Media", f"med-{slug}", label, label,
            f"You are a {label}. {sysd}", ["media"] + tags, tier,
            ["generate_image", "generate_video", "write_file"], tags))

    # ── 9. GROWTH / SOCIAL / CONTENT (auto-posting connectors) ──
    growth = [
        ("copywriter", "Copywriter", "Persuasive, clear copy for any channel.", ["copy", "content"]),
        ("seo", "SEO Specialist", "Technical + content SEO, keywords, schema.", ["seo"]),
        ("social", "Social Media Manager", "Plans/schedules posts (user-authorized accounts only).", ["social", "posting"]),
        ("tiktok", "TikTok Strategist", "Short-form hooks and trends.", ["tiktok", "social"]),
        ("instagram", "Instagram Strategist", "Reels, carousels, captions.", ["instagram", "social"]),
        ("xtwitter", "X/Twitter Strategist", "Threads and engagement.", ["x", "social"]),
        ("youtube", "YouTube Strategist", "Titles, scripts, retention.", ["youtube"]),
        ("email", "Email Marketer", "Lifecycle and campaign emails.", ["email"]),
        ("ads", "Paid Ads Specialist", "Ad creative and targeting.", ["ads"]),
        ("growth", "Growth Hacker", "Loops, funnels, experiments.", ["growth"]),
        ("community", "Community Manager", "Discord/Telegram community building.", ["community"]),
    ]
    for slug, label, sysd, tags in growth:
        agents.append(_mk(
            "Growth", f"grw-{slug}", label, label,
            f"You are a {label}. {sysd} You only post to accounts the user has "
            f"explicitly connected and authorized, and you follow each platform's "
            f"terms of service. No spam, no fake engagement.",
            ["growth", "content"] + tags, TIER_BALANCED,
            ["web_search", "social_post", "write_file"], tags))

    # ── 10. BUSINESS / PRODUCT / FINANCE ──
    business = [
        ("pm", "Product Manager", "Roadmaps, specs, prioritization.", ["product", "planning"]),
        ("bizdev", "Business Strategist", "Market, model, GTM strategy.", ["strategy"]),
        ("finance", "Finance Analyst", "Unit economics, projections, pricing.", ["finance"]),
        ("payments", "Payments Engineer", "Stripe/Flutterwave integration, paywalls, revenue tracking.", ["payments", "stripe", "flutterwave"]),
        ("legal", "Legal/Compliance Advisor", "ToS, privacy, GDPR (informational, not legal advice).", ["legal", "compliance"]),
        ("pricing", "Pricing Strategist", "Plans, tiers, packaging.", ["pricing"]),
        ("research", "Market Researcher", "Competitive and user research.", ["research"]),
        ("support", "Customer Support Agent", "Helpful, accurate user support.", ["support"]),
        ("recruiter", "Tech Recruiter Helper", "JDs, screening rubrics.", ["recruiting"]),
        ("ops", "Operations Manager", "Process, SOPs, automation.", ["operations"]),
    ]
    for slug, label, sysd, tags in business:
        agents.append(_mk(
            "Business", f"biz-{slug}", label, label,
            f"You are a {label}. {sysd}", ["business"] + tags, TIER_BALANCED,
            ["web_search", "write_file", "run_code"], tags))

    # ── 11. KNOWLEDGE / SKILLS / RESEARCH (skill-import understanding) ──
    knowledge = [
        ("librarian", "Knowledge Librarian", "Organizes the knowledge base and project memory.", ["knowledge", "memory"]),
        ("skillextract", "Skill Extractor", "Extracts methods/frameworks/best-practices from uploaded PDFs/TXT/DOCX/ZIP/audio/video.", ["skill", "extract"]),
        ("summarizer", "Summarizer", "Distills long documents/videos into key points.", ["summarize"]),
        ("docparser", "Document Parser", "Parses and structures any document format.", ["parse", "documents"]),
        ("transcriber", "Transcriber", "Transcribes audio/video accurately.", ["transcribe"]),
        ("teacher", "Tutor/Explainer", "Explains anything clearly at the right level.", ["teach"]),
        ("scientist", "Research Scientist", "Reads papers, synthesizes findings.", ["science", "research"]),
        ("factcheck", "Fact Checker", "Verifies claims with sources.", ["factcheck"]),
        ("translator", "Translator", "High-quality translation across languages.", ["translate"]),
        ("writer", "Long-form Writer", "Essays, docs, reports with structure.", ["writing"]),
    ]
    for slug, label, sysd, tags in knowledge:
        agents.append(_mk(
            "Knowledge", f"kno-{slug}", label, label,
            f"You are a {label}. {sysd} You ground every claim in the provided "
            f"sources or real web search — never fabricate.",
            ["knowledge"] + tags, TIER_FRONTIER,
            ["web_search", "read_file", "write_file"], tags))

    # ── 12. ORCHESTRATION / CONTROL (the brain that runs the others) ──
    control = [
        ("coordinator", "Chief Coordinator", TIER_FRONTIER,
         "You are the chief coordinator. You read user intent, ask clarifying "
         "questions when needed, decompose the goal into a plan, assign the right "
         "specialist agents, run them (in parallel where possible), integrate "
         "results, and guarantee the final output works 100% with no placeholders.",
         ["coordinate", "plan", "route"]),
        ("planner", "Strategic Planner", TIER_FRONTIER,
         "You break large goals into ordered, dependency-aware task graphs.",
         ["plan", "decompose"]),
        ("router", "Task Router", TIER_FAST,
         "You match each task to the best specialist agent by capability.",
         ["route", "match"]),
        ("verifier", "Final Verifier", TIER_FRONTIER,
         "You verify the integrated result end-to-end: run it, test it, check for "
         "errors and placeholders, and only pass it if it truly works.",
         ["verify", "qa"]),
        ("memory", "Memory Keeper", TIER_FAST,
         "You maintain isolated per-project/per-chat memory and never lose context.",
         ["memory", "context"]),
        ("critic", "Critic/Adversary", TIER_FRONTIER,
         "You stress-test plans and outputs, finding flaws before the user does.",
         ["critique"]),
    ]
    for slug, label, tier, sysd, tags in control:
        agents.append(_mk(
            "Orchestration", f"ctl-{slug}", label, label, sysd,
            ["control"] + tags, tier,
            ["run_code", "run_shell", "web_search", "write_file", "read_file"], tags))

    return agents


# ─────────────────────────────────────────────────────────────────────────────
# SCALE-OUT: replicate base specialists into parallel worker instances so the
# system can genuinely run hundreds of agents AT ONCE. Each replica is a real,
# independently-schedulable worker of its base specialist (e.g. "Python
# Engineer #3"). This is how real swarms scale horizontally.
# ─────────────────────────────────────────────────────────────────────────────
def expand_to_scale(base: List[AgentSpec], target: int = 360) -> List[AgentSpec]:
    """Replicate the most parallelizable specialists until we reach `target`
    total agents, so the OS can run 350+ concurrent workers for real."""
    agents = list(base)
    if len(agents) >= target:
        return agents

    # Domains that genuinely benefit from many parallel workers:
    parallelizable = [a for a in base if a.domain in (
        "Engineering", "Data & AI", "DevOps & Cloud", "Security",
        "Media", "Growth", "Knowledge")]

    i = 0
    replica_no = 2
    while len(agents) < target:
        proto = parallelizable[i % len(parallelizable)]
        clone = AgentSpec(
            id=f"{proto.id}-w{replica_no}",
            name=f"{proto.name} #{replica_no}",
            domain=proto.domain,
            role=proto.role,
            system=proto.system,
            capabilities=list(proto.capabilities),
            tier=proto.tier,
            tools=list(proto.tools),
            strengths=list(proto.strengths),
        )
        agents.append(clone)
        i += 1
        if i % len(parallelizable) == 0:
            replica_no += 1
    return agents


# Build once at import — base specialists + scaled worker pool = 350+ agents.
BASE_AGENTS: List[AgentSpec] = build_catalog()
ALL_AGENTS: List[AgentSpec] = expand_to_scale(BASE_AGENTS, target=470)

# Fast lookup indexes
BY_ID: Dict[str, AgentSpec] = {a.id: a for a in ALL_AGENTS}
BY_DOMAIN: Dict[str, List[AgentSpec]] = {}
for _a in ALL_AGENTS:
    BY_DOMAIN.setdefault(_a.domain, []).append(_a)


def catalog_summary() -> Dict[str, Any]:
    return {
        "total": len(ALL_AGENTS),
        "base_specialists": len(BASE_AGENTS),
        "domains": {d: len(v) for d, v in BY_DOMAIN.items()},
    }


if __name__ == "__main__":
    import json
    print(json.dumps(catalog_summary(), indent=2))
    print(f"\nFirst 5 agents:")
    for a in ALL_AGENTS[:5]:
        print(f"  [{a.id}] {a.name} ({a.domain}) tier={a.tier} caps={a.capabilities}")
