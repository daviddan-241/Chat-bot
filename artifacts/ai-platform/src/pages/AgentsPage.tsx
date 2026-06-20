import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Search, X, Send, Loader2, Sparkles, ArrowLeft, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Agent {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  model: string;
  systemPrompt: string;
}

interface ChatMsg { role: "user" | "assistant"; content: string; }

const CATEGORY_COLORS: Record<string, string> = {
  "Development": "from-blue-500 to-cyan-500",
  "Writing": "from-purple-500 to-pink-500",
  "Analysis": "from-amber-500 to-orange-500",
  "Creative": "from-rose-500 to-red-500",
  "Research": "from-green-500 to-teal-500",
  "Business": "from-indigo-500 to-violet-500",
  "Education": "from-sky-500 to-blue-500",
  "Productivity": "from-emerald-500 to-green-500",
  "Science": "from-cyan-500 to-teal-500",
  "Other": "from-gray-500 to-slate-500",
};

function AgentChat({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    const newMsgs: ChatMsg[] = [...msgs, { role: "user", content }, { role: "assistant", content: "" }];
    setMsgs(newMsgs);
    setStreaming(true);
    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          model: agent.model || "openai",
          history: msgs.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: agent.systemPrompt,
        }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            if (j.content) {
              full += j.content;
              setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1]!, content: full }; return c; });
            }
          } catch (_) {}
        }
      }
    } catch (_) {
      setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1]!, content: "Error: please try again." }; return c; });
    } finally { setStreaming(false); }
  };

  const gradient = CATEGORY_COLORS[agent.category] || "from-violet-500 to-indigo-500";

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-40 flex flex-col bg-background md:relative md:inset-auto md:flex md:flex-col md:h-full">
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 bg-gradient-to-r ${gradient} flex-shrink-0`}>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors">
          <ArrowLeft size={15} />
        </button>
        <div className="text-2xl">{agent.icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{agent.name}</p>
          <p className="text-[10px] text-white/70">{agent.category} · {agent.model}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {msgs.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">{agent.icon}</div>
            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{agent.description}</p>
          </div>
        )}
        {msgs.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm
              ${msg.role === "user" ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-white font-bold text-xs" : `bg-gradient-to-br ${gradient} text-xl`}`}>
              {msg.role === "user" ? "U" : agent.icon}
            </div>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm
              ${msg.role === "user" ? "bg-primary text-white rounded-tr-sm" : "bg-card border border-card-border text-foreground rounded-tl-sm"}`}>
              {msg.role === "assistant" ? (
                <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:text-xs">
                  {msg.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  ) : (
                    <div className="flex gap-1 dot-bounce">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                    </div>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-3 flex-shrink-0">
        <div className="flex gap-2 bg-card border border-border rounded-2xl px-3 py-2 focus-within:border-primary/40 transition-colors">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
            placeholder={`Message ${agent.name}...`}
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none" />
          <button onClick={send} disabled={!input.trim() || streaming}
            className="p-2 rounded-xl bg-primary text-white disabled:opacity-25 hover:bg-primary/85 transition-all">
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

import { useRef } from "react";

export default function AgentsPage({ setPage: _setPage }: { setPage: (p: string) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then(d => { setAgents(d.agents || []); setLoading(false); });
  }, []);

  const categories = ["All", ...Array.from(new Set(agents.map(a => a.category)))];
  const filtered = agents.filter(a => {
    const matchCat = category === "All" || a.category === category;
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="h-full flex overflow-hidden bg-background">
      <div className={`flex flex-col flex-1 min-w-0 ${activeAgent ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="border-b border-border/50 px-4 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-base font-bold flex items-center gap-2">
                <Bot size={18} className="text-primary" /> Agent Marketplace
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">{agents.length} specialized AI agents across {categories.length - 1} categories</p>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full bg-muted/40 border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/40 transition-colors" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all border
                  ${category === cat ? "bg-primary text-white border-primary shadow-sm" : "bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/30 hover:text-foreground"}`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No agents found</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((agent, i) => {
                const gradient = CATEGORY_COLORS[agent.category] || "from-violet-500 to-indigo-500";
                return (
                  <motion.div key={agent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="group relative bg-card border border-card-border rounded-2xl p-4 hover:border-primary/30 hover:shadow-lg transition-all cursor-pointer"
                    onClick={() => setActiveAgent(agent)}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl flex-shrink-0 shadow-sm`}>
                        {agent.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
                        <span className="text-[10px] text-muted-foreground">{agent.category}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">{agent.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">{agent.model}</span>
                      <div className="flex items-center gap-1 text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        <Zap size={10} /> Launch
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {activeAgent && (
          <div className={`${activeAgent ? "flex" : "hidden"} md:w-[420px] md:border-l md:border-border/50 flex-col h-full flex-shrink-0`}>
            <AgentChat agent={activeAgent} onClose={() => setActiveAgent(null)} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
