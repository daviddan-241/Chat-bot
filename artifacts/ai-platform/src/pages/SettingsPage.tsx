import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Settings, Save, Check, Loader2, ExternalLink, Github,
  Sparkles, Server, Key, Eye, EyeOff, Trash2, Plus, Cpu,
  MessageSquare, Image, Terminal, Bot, Film
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const CHAT_MODELS = [
  { id: "openai",       label: "GPT-4o",       desc: "Best overall" },
  { id: "openai-large", label: "GPT-4o Large", desc: "Max intelligence" },
  { id: "mistral",      label: "Mistral",      desc: "Fast & capable" },
  { id: "llama",        label: "Llama 3.3",    desc: "Open source" },
  { id: "qwen-coder",   label: "Qwen Coder",   desc: "Best for code" },
  { id: "deepseek",     label: "DeepSeek R1",  desc: "Reasoning" },
];

const IMAGE_MODELS = [
  { id: "flux",          label: "FLUX",         desc: "Best quality" },
  { id: "flux-realism",  label: "FLUX Realism", desc: "Photorealistic" },
  { id: "flux-anime",    label: "FLUX Anime",   desc: "Anime style" },
  { id: "turbo",         label: "Turbo",        desc: "Fastest" },
];

const API_KEYS: { id: string; label: string; field: string; placeholder: string; url: string; color: string }[] = [
  { id: "openai",    label: "OpenAI",    field: "openai_api_key",    placeholder: "sk-...",         url: "https://platform.openai.com/api-keys",          color: "text-emerald-600" },
  { id: "anthropic", label: "Anthropic", field: "anthropic_api_key", placeholder: "sk-ant-...",     url: "https://console.anthropic.com/settings/keys",   color: "text-orange-500" },
  { id: "google",    label: "Google AI", field: "google_api_key",    placeholder: "AIza...",        url: "https://aistudio.google.com/app/apikey",         color: "text-blue-500" },
  { id: "groq",      label: "Groq",      field: "groq_api_key",      placeholder: "gsk_...",        url: "https://console.groq.com/keys",                  color: "text-yellow-600" },
  { id: "replicate", label: "Replicate", field: "replicate_api_key", placeholder: "r8_...",         url: "https://replicate.com/account/api-tokens",       color: "text-purple-600" },
  { id: "custom",    label: "Custom",    field: "custom_api_key",    placeholder: "your-api-key",   url: "#",                                              color: "text-slate-500" },
];

const STACK = [
  { icon: <MessageSquare size={13} />, key: "AI Chat",   val: "Pollinations.ai SSE streaming" },
  { icon: <Image size={13} />,         key: "Images",    val: "FLUX via Pollinations.ai" },
  { icon: <Terminal size={13} />,      key: "Terminal",  val: "child_process + socket.io" },
  { icon: <Bot size={13} />,           key: "Agents",    val: "136 specialized AI agents" },
  { icon: <Film size={13} />,          key: "Video",     val: "FFmpeg CLI processing" },
  { icon: <Cpu size={13} />,           key: "Database",  val: "PostgreSQL + Drizzle ORM" },
];

function ApiKeyRow({ keyDef, savedStatus, onSave, onDelete }: {
  keyDef: typeof API_KEYS[number];
  savedStatus: boolean;
  onSave: (field: string, value: string) => void;
  onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    await onSave(keyDef.field, value.trim());
    setSaving(false);
    setSaved(true);
    setValue("");
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="p-3 rounded-xl border border-border/60 bg-background">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Key size={13} className={keyDef.color} />
          <span className="text-xs font-semibold text-foreground">{keyDef.label}</span>
          {savedStatus && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
              <Check size={9} /> Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {keyDef.url !== "#" && (
            <a href={keyDef.url} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded-lg text-muted-foreground hover:text-primary transition-colors">
              <ExternalLink size={11} />
            </a>
          )}
          {savedStatus && (
            <button onClick={() => onDelete(keyDef.id)}
              className="p-1 rounded-lg text-muted-foreground hover:text-red-500 transition-colors">
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={savedStatus ? "••••••• (key saved — enter new to replace)" : keyDef.placeholder}
            className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder-muted-foreground/50 outline-none focus:border-primary/50 pr-8"
          />
          <button type="button" onClick={() => setShow(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            {show ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </div>
        <button onClick={handleSave} disabled={saving || !value.trim()}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-semibold disabled:opacity-40 hover:bg-primary/85 transition-all active:scale-95">
          {saving ? <Loader2 size={11} className="animate-spin" /> : saved ? <Check size={11} /> : <Plus size={11} />}
          {saved ? "Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(d => setSettings(d.settings || {}));
  }, []);

  const set = (key: string, val: string) => setSettings(s => ({ ...s, [key]: val }));

  const saveGeneral = async () => {
    setSaving(true);
    const res = await fetch(`${API}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_model:       settings["default_model"],
        default_image_model: settings["default_image_model"],
        system_prompt:       settings["system_prompt"],
        ollama_url:          settings["ollama_url"],
        custom_base_url:     settings["custom_base_url"],
      }),
    });
    const d = await res.json();
    if (d.settings) setSettings(d.settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const saveKey = async (field: string, value: string) => {
    const res = await fetch(`${API}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const d = await res.json();
    if (d.settings) setSettings(d.settings);
  };

  const deleteKey = async (id: string) => {
    await fetch(`${API}/api/settings/key/${id}`, { method: "DELETE" });
    // Refresh
    const res = await fetch(`${API}/api/settings`);
    const d = await res.json();
    if (d.settings) setSettings(d.settings);
  };

  return (
    <div className="h-full overflow-y-auto bg-background scroll-ios">
      <div className="max-w-lg mx-auto px-4 py-5 space-y-4 pb-24">

        {/* Header */}
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2 tracking-tight">
            <Settings size={18} className="text-primary" /> Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Models, API keys & platform config</p>
        </div>

        {/* API Keys Vault */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
              <Key size={14} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">API Key Vault</h2>
              <p className="text-[11px] text-muted-foreground">Keys stored server-side only — never exposed to browser</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {API_KEYS.map(k => (
              <ApiKeyRow
                key={k.id}
                keyDef={k}
                savedStatus={!!settings[`has_${k.id}_key`]}
                onSave={saveKey}
                onDelete={deleteKey}
              />
            ))}
          </div>
          {/* Custom base URL */}
          <div className="mt-3">
            <label className="text-[10px] font-semibold text-muted-foreground block mb-1 uppercase tracking-wider">
              Custom API Base URL <span className="normal-case opacity-60">(e.g. OpenAI-compatible local server)</span>
            </label>
            <input value={(settings["custom_base_url"] as string) || ""}
              onChange={e => set("custom_base_url", e.target.value)}
              placeholder="https://your-server.com/v1"
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder-muted-foreground/50 outline-none focus:border-primary/50" />
          </div>
        </motion.div>

        {/* Model defaults */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-sm">
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">AI Models</h2>
              <p className="text-[11px] text-muted-foreground">Pollinations.ai — free, no key required</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-2 uppercase tracking-wider">Default Chat Model</label>
              <div className="grid grid-cols-2 gap-1.5">
                {CHAT_MODELS.map(m => (
                  <button key={m.id} onClick={() => set("default_model", m.id)}
                    className={`flex flex-col gap-0.5 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97]
                      ${(settings["default_model"] || "openai") === m.id
                        ? "border-primary/50 bg-primary/8 text-primary"
                        : "border-border/50 hover:border-primary/20 text-foreground"}`}>
                    <span className="text-xs font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-2 uppercase tracking-wider">Default Image Model</label>
              <div className="grid grid-cols-2 gap-1.5">
                {IMAGE_MODELS.map(m => (
                  <button key={m.id} onClick={() => set("default_image_model", m.id)}
                    className={`flex flex-col gap-0.5 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97]
                      ${(settings["default_image_model"] || "flux") === m.id
                        ? "border-primary/50 bg-primary/8 text-primary"
                        : "border-border/50 hover:border-primary/20 text-foreground"}`}>
                    <span className="text-xs font-semibold">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1 uppercase tracking-wider">
                System Prompt <span className="normal-case opacity-60">(default AI personality)</span>
              </label>
              <textarea value={(settings["system_prompt"] as string) || ""}
                onChange={e => set("system_prompt", e.target.value)}
                rows={3}
                placeholder="You are a helpful AI assistant."
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2.5 text-xs text-foreground placeholder-muted-foreground/50 outline-none focus:border-primary/50 resize-none" />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-muted-foreground block mb-1 uppercase tracking-wider">
                Ollama URL <span className="normal-case opacity-60">(optional — for local models)</span>
              </label>
              <input value={(settings["ollama_url"] as string) || ""}
                onChange={e => set("ollama_url", e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder-muted-foreground/50 outline-none focus:border-primary/50" />
            </div>
          </div>

          <button onClick={saveGeneral} disabled={saving}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-primary/85 transition-all active:scale-[0.97] shadow-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? "Saved!" : "Save Settings"}
          </button>
        </motion.div>

        {/* System stack */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Server size={14} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">System Stack</h2>
              <p className="text-[11px] text-muted-foreground">All real — zero mocks or demos</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {STACK.map(({ icon, key, val }) => (
              <div key={key} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                <span className="text-primary mt-0.5 flex-shrink-0">{icon}</span>
                <div>
                  <p className="text-[10px] text-muted-foreground">{key}</p>
                  <p className="text-xs text-foreground font-medium leading-tight">{val}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* GitHub */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="bg-card border border-card-border rounded-2xl p-4">
          <a href="https://github.com/daviddan-241/Chat-bot" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shadow-sm">
              <Github size={14} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">daviddan-241/Chat-bot</p>
              <p className="text-[11px] text-muted-foreground">Full source on GitHub</p>
            </div>
            <ExternalLink size={12} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
          </a>
        </motion.div>

        <p className="text-center text-[10px] text-muted-foreground/40">
          NexusAI · All features real · Pollinations.ai · No API key required for chat & images
        </p>
      </div>
    </div>
  );
}
