import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Settings, Save, Check, Loader2, ExternalLink, Github, Sparkles, Zap, Monitor, Server } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const CHAT_MODELS = [
  { id: "openai", label: "GPT-4o", desc: "Best overall — smart & fast" },
  { id: "openai-large", label: "GPT-4o Large", desc: "Maximum intelligence" },
  { id: "mistral", label: "Mistral Large", desc: "European, fast & capable" },
  { id: "llama", label: "Llama 3.3 70B", desc: "Open source powerhouse" },
  { id: "qwen-coder", label: "Qwen 2.5 Coder", desc: "Specialized for code" },
  { id: "deepseek", label: "DeepSeek R1", desc: "Chain-of-thought reasoning" },
];

const IMAGE_MODELS = [
  { id: "flux", label: "FLUX", desc: "Best quality — recommended" },
  { id: "flux-realism", label: "FLUX Realism", desc: "Photorealistic images" },
  { id: "flux-anime", label: "FLUX Anime", desc: "Anime & illustration style" },
  { id: "turbo", label: "Turbo", desc: "Fastest generation" },
];

const REPOS = [
  { name: "anthropics/claude-code", desc: "Commands, plugins & workflows", color: "text-orange-400", bg: "bg-orange-400/10", url: "https://github.com/anthropics/claude-code" },
  { name: "rohitg00/awesome-claude-code-toolkit", desc: "136 specialized AI agents across 10 categories", color: "text-blue-400", bg: "bg-blue-400/10", url: "https://github.com/rohitg00/awesome-claude-code-toolkit" },
  { name: "nexu-io/open-design", desc: "Local-first AI design tool", color: "text-purple-400", bg: "bg-purple-400/10", url: "#" },
  { name: "winfunc/opcode", desc: "Claude Code desktop — UI, agents & sessions", color: "text-green-400", bg: "bg-green-400/10", url: "#" },
  { name: "daviddan-241/My-Kali-linux", desc: "Web terminal — node-pty + socket.io + xterm.js", color: "text-cyan-400", bg: "bg-cyan-400/10", url: "#" },
];

const STACK = [
  { key: "AI Chat", val: "Pollinations.ai streaming SSE" },
  { key: "Image Gen", val: "FLUX via Pollinations.ai" },
  { key: "Terminal", val: "child_process + socket.io + xterm.js" },
  { key: "Database", val: "PostgreSQL + Drizzle ORM" },
  { key: "Video", val: "FFmpeg CLI" },
  { key: "Agents", val: "136 from awesome-claude-code-toolkit" },
  { key: "Backend", val: "Express 5 + TypeScript" },
  { key: "Frontend", val: "React 19 + Vite + Tailwind v4" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(d => setSettings(d.settings || {}));
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch(`${API}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const set = (key: string, val: string) => setSettings(s => ({ ...s, [key]: val }));

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="pb-2">
          <h1 className="text-xl font-bold flex items-center gap-2.5 tracking-tight">
            <Settings size={20} className="text-primary" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure models, integrations, and platform options</p>
        </div>

        {/* AI Provider status */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <Sparkles size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">AI Provider</h2>
              <p className="text-[11px] text-muted-foreground">Pollinations.ai — free, no API key needed</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-green-400 bg-green-400/10 px-2.5 py-1 rounded-full border border-green-400/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Active
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-2 uppercase tracking-wider">Default Chat Model</label>
              <div className="grid grid-cols-2 gap-1.5">
                {CHAT_MODELS.map(m => (
                  <button key={m.id} onClick={() => set("default_model", m.id)}
                    className={`flex flex-col gap-0.5 p-2.5 rounded-xl border text-left transition-all
                      ${(settings["default_model"] || "openai") === m.id ? "border-primary/50 bg-primary/8 text-primary" : "border-border/50 hover:border-primary/20 text-foreground hover:bg-muted/30"}`}>
                    <span className="text-xs font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-2 uppercase tracking-wider">Default Image Model</label>
              <div className="grid grid-cols-2 gap-1.5">
                {IMAGE_MODELS.map(m => (
                  <button key={m.id} onClick={() => set("default_image_model", m.id)}
                    className={`flex flex-col gap-0.5 p-2.5 rounded-xl border text-left transition-all
                      ${(settings["default_image_model"] || "flux") === m.id ? "border-primary/50 bg-primary/8 text-primary" : "border-border/50 hover:border-primary/20 text-foreground hover:bg-muted/30"}`}>
                    <span className="text-xs font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wider">Ollama URL <span className="text-muted-foreground/40 normal-case">(optional — for local models)</span></label>
              <input value={settings["ollama_url"] || ""}
                onChange={e => set("ollama_url", e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 transition-colors font-mono text-xs" />
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-primary/85 transition-all active:scale-[0.98] shadow-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? "Saved!" : "Save Settings"}
          </button>
        </motion.div>

        {/* System stack */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <Server size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">System Stack</h2>
              <p className="text-[11px] text-muted-foreground">Technology powering this platform</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {STACK.map(({ key, val }) => (
              <div key={key}>
                <p className="text-[10px] text-muted-foreground mb-0.5">{key}</p>
                <p className="text-xs text-foreground font-medium leading-tight">{val}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Source repos */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
              <Github size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Built On These Repos</h2>
              <p className="text-[11px] text-muted-foreground">5 GitHub repositories merged into one</p>
            </div>
          </div>
          <div className="space-y-2">
            {REPOS.map((repo, i) => (
              <motion.a key={repo.name} href={repo.url} target="_blank" rel="noopener noreferrer"
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.04 }}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/40 hover:border-primary/30 transition-all group">
                <div className={`w-7 h-7 rounded-lg ${repo.bg} flex items-center justify-center flex-shrink-0`}>
                  <Github size={13} className={repo.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${repo.color} truncate`}>{repo.name}</p>
                  <p className="text-[10px] text-muted-foreground">{repo.desc}</p>
                </div>
                <ExternalLink size={11} className="text-muted-foreground/30 group-hover:text-muted-foreground flex-shrink-0 transition-colors" />
              </motion.a>
            ))}
          </div>
        </motion.div>

        <div className="text-center text-[11px] text-muted-foreground/40 pb-2">
          NexusAI · Unified AI Platform · Built with Pollinations.ai
        </div>
      </div>
    </div>
  );
}
