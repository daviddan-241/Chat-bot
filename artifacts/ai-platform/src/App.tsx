import { useState, useEffect, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Image, Terminal, FolderOpen, Bot, Video,
  Settings, Search, X, Zap, ArrowRight
} from "lucide-react";
import ChatPage from "@/pages/ChatPage";
import ImagesPage from "@/pages/ImagesPage";
import TerminalPage from "@/pages/TerminalPage";
import FilesPage from "@/pages/FilesPage";
import AgentsPage from "@/pages/AgentsPage";
import VideosPage from "@/pages/VideosPage";
import SettingsPage from "@/pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

type Page = "chat" | "images" | "terminal" | "files" | "agents" | "videos" | "settings";

const NAV: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: "chat",     label: "Chat",    icon: <MessageSquare size={20} />, badge: "Free" },
  { id: "images",   label: "Image",   icon: <Image size={20} /> },
  { id: "terminal", label: "Shell",   icon: <Terminal size={20} />, badge: "Live" },
  { id: "files",    label: "Files",   icon: <FolderOpen size={20} /> },
  { id: "agents",   label: "Agents",  icon: <Bot size={20} />, badge: "136" },
  { id: "videos",   label: "Video",   icon: <Video size={20} /> },
  { id: "settings", label: "Config",  icon: <Settings size={20} /> },
];

const CMD_ITEMS = [
  { label: "AI Chat",          page: "chat"     as Page, icon: <MessageSquare size={14} />, desc: "Stream chat with GPT-4o, Mistral, Llama…" },
  { label: "Image Generation", page: "images"   as Page, icon: <Image size={14} />,         desc: "Generate images with FLUX — free" },
  { label: "Terminal",         page: "terminal" as Page, icon: <Terminal size={14} />,       desc: "Live Linux bash shell over WebSocket" },
  { label: "Files",            page: "files"    as Page, icon: <FolderOpen size={14} />,     desc: "Upload, manage and organize files" },
  { label: "Agents",           page: "agents"   as Page, icon: <Bot size={14} />,            desc: "136 specialized AI agents" },
  { label: "Video Tools",      page: "videos"   as Page, icon: <Video size={14} />,          desc: "FFmpeg video processing" },
  { label: "Settings",         page: "settings" as Page, icon: <Settings size={14} />,       desc: "API keys, models & config" },
];

const PAGE_META: Record<Page, { label: string; desc: string }> = {
  chat:     { label: "AI Chat",     desc: "Pollinations.ai — free" },
  images:   { label: "Image Gen",   desc: "FLUX · free" },
  terminal: { label: "Terminal",    desc: "Live bash shell" },
  files:    { label: "Files",       desc: "Upload & manage" },
  agents:   { label: "Agents",      desc: "136 specialists" },
  videos:   { label: "Video Tools", desc: "FFmpeg powered" },
  settings: { label: "Settings",    desc: "API keys & config" },
};

function CommandPalette({ open, onClose, setPage }: { open: boolean; onClose: () => void; setPage: (p: Page) => void }) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const filtered = CMD_ITEMS.filter(i =>
    !query || i.label.toLowerCase().includes(query.toLowerCase()) || i.desc.toLowerCase().includes(query.toLowerCase())
  );
  useEffect(() => { if (open) { setQuery(""); setIdx(0); } }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.97, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -10 }} transition={{ duration: 0.14 }}
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={14} className="text-muted-foreground flex-shrink-0" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && filtered[idx]) { setPage(filtered[idx]!.page); onClose(); }
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search features…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none" />
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <X size={13} />
          </button>
        </div>
        <div className="py-1.5 max-h-64 overflow-y-auto scroll-ios">
          {filtered.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">No results</p>}
          {filtered.map((item, i) => (
            <button key={item.page} onClick={() => { setPage(item.page); onClose(); }}
              onMouseEnter={() => setIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                ${i === idx ? "bg-primary/8 text-primary" : "text-foreground hover:bg-muted/60"}`}>
              <span className={i === idx ? "text-primary" : "text-muted-foreground"}>{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
              </div>
              {i === idx && <ArrowRight size={11} className="text-primary flex-shrink-0" />}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function AppContent() {
  const [page, setPage] = useState<Page>("chat");
  const [cmdOpen, setCmdOpen] = useState(false);
  const openCmd = useCallback(() => setCmdOpen(true), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(true); }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const meta = PAGE_META[page];

  const pageMap: Record<Page, React.ReactNode> = {
    chat:     <ChatPage />,
    images:   <ImagesPage />,
    terminal: <TerminalPage />,
    files:    <FilesPage />,
    agents:   <AgentsPage setPage={setPage as (p: string) => void} />,
    videos:   <VideosPage />,
    settings: <SettingsPage />,
  };

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)}
        setPage={p => { setPage(p); setCmdOpen(false); }} />

      {/* Top bar — mobile header */}
      <div className="flex items-center h-14 px-4 border-b border-border bg-white/95 backdrop-blur-sm flex-shrink-0 safe-top z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <Zap size={13} className="text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-bold text-sm tracking-tight text-foreground">NexusAI</span>
            <span className="text-[10px] text-muted-foreground">{meta.label}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Status dots */}
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground/50 mr-1">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />AI</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Shell</span>
          </div>
          <button onClick={openCmd}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
            <Search size={11} />
            <span className="hidden sm:block">Search</span>
          </button>
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden min-h-0">
        <AnimatePresence mode="wait">
          <motion.div key={page}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
            className="h-full">
            {pageMap[page]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom tab bar — always visible, mobile-first */}
      <div className="flex items-stretch border-t border-border bg-white/95 backdrop-blur-md safe-bottom flex-shrink-0 z-10">
        {NAV.map(item => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 relative transition-colors
                ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              {active && (
                <motion.div layoutId="tab-active"
                  className="absolute inset-0 bg-primary/6 border-t-2 border-primary" />
              )}
              <span className="relative z-10">{item.icon}</span>
              <span className={`relative z-10 text-[9px] font-semibold ${active ? "text-primary" : ""}`}>
                {item.label}
              </span>
              {item.badge && (
                <span className={`absolute top-1.5 right-1/2 translate-x-3 text-[8px] font-bold px-1 py-px rounded-full
                  ${active ? "bg-primary/20 text-primary" : "bg-slate-100 text-slate-400"}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
