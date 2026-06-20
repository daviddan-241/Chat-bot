import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Send, Plus, Trash2, ChevronDown, MessageSquare,
  Copy, Check, Mic, MicOff, Sparkles, StopCircle
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const MODELS = [
  { id: "openai", label: "GPT-4o", badge: "Smart" },
  { id: "openai-large", label: "GPT-4o Large", badge: "Power" },
  { id: "mistral", label: "Mistral", badge: "Fast" },
  { id: "llama", label: "Llama 3.3", badge: "Open" },
  { id: "qwen-coder", label: "Qwen Coder", badge: "Code" },
  { id: "deepseek", label: "DeepSeek R1", badge: "Reason" },
];

const SUGGESTIONS = [
  "Explain quantum entanglement simply",
  "Write a Python web scraper",
  "Debug my code and suggest fixes",
  "Design a REST API for a todo app",
  "Compare React vs Vue vs Svelte",
  "Write a regex to validate emails",
];

interface Message { role: "user" | "assistant"; content: string; id: string; }
interface Conversation { id: number; title: string; model: string; }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors">
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 h-5 dot-bounce">
      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
    </div>
  );
}

function MessageBubble({ msg, isLast, streaming }: { msg: Message; isLast: boolean; streaming: boolean }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const showTyping = isLast && streaming && msg.role === "assistant";

  const codeRenderer = ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const match = /language-(\w+)/.exec(className || "");
    return match ? (
      <div className="relative my-3 rounded-xl overflow-hidden border border-border/50">
        <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border/40">
          <span className="text-[10px] font-mono text-muted-foreground">{match[1]}</span>
          <CopyButton text={String(children)} />
        </div>
        <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
          customStyle={{ margin: 0, padding: "12px 16px", background: "transparent", fontSize: "12px", lineHeight: "1.65" }}>
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      </div>
    ) : <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary">{children}</code>;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
      className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
        ${isUser ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-xs font-bold" : "bg-card border border-card-border"}`}>
        {isUser ? "U" : <Sparkles size={12} className="text-primary" />}
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? "flex flex-col items-end" : ""}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[85%]
          ${isUser ? "bg-primary text-white rounded-tr-sm shadow-lg" : "bg-card border border-card-border text-foreground rounded-tl-sm"}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none
              prose-headings:font-semibold prose-headings:text-foreground prose-headings:tracking-tight prose-headings:my-2
              prose-p:text-foreground/90 prose-p:leading-relaxed prose-p:my-1.5
              prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground prose-strong:font-semibold
              prose-li:text-foreground/90 prose-ul:my-1.5 prose-ol:my-1.5
              prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground">
              {(msg.content || showTyping) ? (
                <>
                  {msg.content && (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer as never }}>
                      {msg.content}
                    </ReactMarkdown>
                  )}
                  {showTyping && <TypingDots />}
                </>
              ) : showTyping ? <TypingDots /> : null}
            </div>
          )}
        </div>

        {!isUser && !streaming && msg.content && (
          <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("openai");
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const loadConversations = useCallback(async () => {
    const r = await fetch(`${API}/api/chat/conversations`);
    const d = await r.json();
    setConversations(d.conversations || []);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadConversation = async (id: number) => {
    setActiveId(id);
    const r = await fetch(`${API}/api/chat/conversations/${id}`);
    const d = await r.json();
    setMessages((d.messages || []).map((m: { role: string; content: string }, i: number) => ({
      role: m.role, content: m.content, id: `loaded-${id}-${i}`,
    })));
  };

  const newConversation = () => { setActiveId(null); setMessages([]); setInput(""); };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API}/api/chat/conversations/${id}`, { method: "DELETE" });
    loadConversations();
    if (activeId === id) newConversation();
  };

  const resizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
    }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    setInput("");
    setTimeout(resizeTextarea, 0);

    const userMsg: Message = { role: "user", content, id: `u-${Date.now()}` };
    const asstMsg: Message = { role: "assistant", content: "", id: `a-${Date.now()}` };
    setMessages(prev => [...prev, userMsg, asstMsg]);
    setStreaming(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, model, history, conversationId: activeId }),
      });
      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let convId = activeId;
      abortRef.current = () => reader.cancel();

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
              setMessages(prev => {
                const c = [...prev];
                c[c.length - 1] = { ...c[c.length - 1]!, content: full };
                return c;
              });
            }
            if (j.conversationId) convId = j.conversationId;
          } catch (_) {}
        }
      }
      setActiveId(convId);
      loadConversations();
    } catch (_) {
      setMessages(prev => {
        const c = [...prev];
        c[c.length - 1] = { ...c[c.length - 1]!, content: "Something went wrong. Please try again." };
        return c;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SR = (window as Record<string, unknown>)["SpeechRecognition"] as typeof SpeechRecognition | undefined
      || (window as Record<string, unknown>)["webkitSpeechRecognition"] as typeof SpeechRecognition | undefined;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.interimResults = true;
    r.onresult = (e) => { let t = ""; for (const res of e.results) t += res[0]!.transcript; setInput(t); };
    r.onend = () => setListening(false);
    recognitionRef.current = r; r.start(); setListening(true);
  };

  const currentModel = MODELS.find(m => m.id === model) || MODELS[0]!;

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Conversation list */}
      <div className="hidden lg:flex flex-col w-60 border-r border-border/60 bg-sidebar/40 flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border/50">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">History</span>
          <button onClick={newConversation}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5">
          {conversations.length === 0 && (
            <div className="flex flex-col items-center py-10">
              <MessageSquare size={18} className="text-muted-foreground/20 mb-2" />
              <p className="text-[11px] text-muted-foreground/40">No history yet</p>
            </div>
          )}
          {conversations.map(c => (
            <button key={c.id} onClick={() => loadConversation(c.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left group transition-colors
                ${activeId === c.id ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"}`}>
              <MessageSquare size={11} className="flex-shrink-0 opacity-50" />
              <span className="flex-1 text-xs truncate">{c.title || "Conversation"}</span>
              <button onClick={e => deleteConversation(c.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-all">
                <Trash2 size={10} />
              </button>
            </button>
          ))}
        </div>
        <div className="p-2 border-t border-border/40">
          <button onClick={newConversation}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 text-primary border border-primary/15 text-xs font-medium hover:bg-primary/12 transition-colors">
            <Plus size={12} /> New Conversation
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Model picker bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/40 flex-shrink-0">
          <div className="relative ml-auto">
            <button onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50 border border-border hover:border-primary/30 transition-colors text-xs font-medium group">
              <Sparkles size={11} className="text-primary" />
              <span>{currentModel.label}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold">{currentModel.badge}</span>
              <ChevronDown size={11} className={`text-muted-foreground transition-transform duration-200 ${showModelPicker ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {showModelPicker && (
                <motion.div initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -4 }} transition={{ duration: 0.12 }}
                  className="absolute top-full right-0 mt-1.5 w-52 glass rounded-2xl border border-border/60 shadow-2xl z-20 py-2 overflow-hidden">
                  {MODELS.map(m => (
                    <button key={m.id} onClick={() => { setModel(m.id); setShowModelPicker(false); }}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-muted/50
                        ${model === m.id ? "text-primary bg-primary/5" : "text-foreground"}`}>
                      <span className="font-medium">{m.label}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${model === m.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>{m.badge}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.length === 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                className="text-center pt-10">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto mb-5 glow-primary">
                  <Sparkles size={28} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">What can I help with?</h2>
                <p className="text-sm text-muted-foreground mb-8">Free AI powered by Pollinations.ai — no sign-up, no limits</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="text-left px-4 py-3 rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-primary/5 text-xs text-muted-foreground hover:text-foreground transition-all duration-150 group">
                      <span className="group-hover:text-primary transition-colors mr-1">→</span> {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg} isLast={i === messages.length - 1} streaming={streaming} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border/50 bg-background/90 backdrop-blur-sm px-4 py-3 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-primary/40 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/0.2)] transition-all duration-200">
              <textarea ref={textareaRef} value={input} onChange={e => { setInput(e.target.value); resizeTextarea(); }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Message AI... (Enter ↵ to send)"
                rows={1}
                className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground resize-none outline-none py-0 min-h-[20px] max-h-32"
              />
              <div className="flex items-center gap-1.5 pb-0.5 flex-shrink-0">
                <button onClick={toggleVoice}
                  className={`p-1.5 rounded-lg transition-all ${listening ? "text-red-400 bg-red-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                  {listening ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
                {streaming ? (
                  <button onClick={() => abortRef.current?.()}
                    className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                    <StopCircle size={16} />
                  </button>
                ) : (
                  <button onClick={() => send()} disabled={!input.trim()}
                    className="p-2 rounded-xl bg-primary text-white hover:bg-primary/85 disabled:opacity-25 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm">
                    <Send size={15} />
                  </button>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
              Pollinations.ai · Free · No API key · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
