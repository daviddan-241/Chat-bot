import { useState, useEffect, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, Image, Terminal, FolderOpen, Bot, Video,
  Settings, Zap, ChevronLeft, Menu, Search, X, Command,
  Sparkles, Monitor, FileText, Cpu, Film, Cog, ArrowRight
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

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: "chat",     label: "AI Chat",       icon: <MessageSquare size={17} />, badge: "Free" },
  { id: "images",   label: "Image Gen",     icon: <Image size={17} /> },
  { id: "terminal", label: "Terminal",      icon: <Terminal size={17} />, badge: "Live" },
  { id: "files",    label: "Files",         icon: <FolderOpen size={17} /> },
  { id: "agents",   label: "Agents",        icon: <Bot size={17} />, badge: "136" },
  { id: "videos",   label: "Video Tools",   icon: <Video size={17} /> },
];

const CMD_ITEMS = [
  { label: "AI Chat",           page: "chat"     as Page, icon: <MessageSquare size={14} />, desc: "Stream chat with GPT-4o, Mistral, Llama…" },
  { label: "Image Generation",  page: "images"   as Page, icon: <Sparkles size={14} />,       desc: "Generate images with FLUX — free" },
  { label: "Terminal",          page: "terminal" as Page, icon: <Terminal size={14} />,        desc: "Live Linux bash shell over WebSocket" },
  { label: "Files",             page: "files"    as Page, icon: <FolderOpen size={14} />,      desc: "Upload, manage and organize files" },
  { label: "Agents",            page: "agents"   as Page, icon: <Bot size={14} />,             desc: "136 specialized AI agents" },
  { label: "Video Tools",       page: "videos"   as Page, icon: <Video size={14} />,           desc: "FFmpeg video processing" },
  { label: "Settings",          page: "settings" as Page, icon: <Settings size={14} />,        desc: "Configure models and integrations" },
];

function CommandPalette({ open, onClose, setPage }: { open: boolean; onClose: () => void; setPage: (p: Page) => void }) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const filtered = CMD_ITEMS.filter(i =>
    !query ||
    i.label.toLowerCase().includes(query.toLowerCase()) ||
    i.desc.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => { if (open) { setQuery(""); setIdx(0); } }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.97, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -10 }} transition={{ duration: 0.14 }}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search size={15} className="text-muted-foreground flex-shrink-0" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && filtered[idx]) { setPage(filtered[idx]!.page); onClose(); }
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search pages and features…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none" />
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={13} />
          </button>
        </div>
        <div className="py-1.5 max-h-72 overflow-y-auto scroll-ios">
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
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground bg-muted/30">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-border rounded text-[9px] shadow-sm">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-border rounded text-[9px] shadow-sm">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-white border border-border rounded text-[9px] shadow-sm">esc</kbd> close</span>
        </div>
      </motion.div>
    </div>
  );
}

function Sidebar({ page, setPage, collapsed, setCollapsed, onCmdK }: {
  page: Page; setPage: (p: Page) => void; collapsed: boolean;
  setCollapsed: (v: boolean) => void; onCmdK: () => void;
}) {
  return (
    <motion.div animate={{ width: collapsed ? 60 : 216 }} transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col border-r border-border bg-sidebar flex-shrink-0 h-full overflow-hidden">

      {/* Logo */}
      <div className={`flex items-center h-14 px-3 border-b border-border flex-shrink-0 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-sm">
              <Zap size={13} className="text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight text-foreground">NexusAI</span>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <Zap size={13} className="text-white" />
          </div>
        )}
        {!collapsed && (
          <button onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <ChevronLeft size={13} />
          </button>
        )}
      </div>

      {/* Search */}
      {!collapsed ? (
        <div className="px-2 pt-3 pb-1">
          <button onClick={onCmdK}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors text-xs shadow-sm">
            <Search size={12} className="flex-shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <span className="flex items-center gap-0.5 text-[9px] opacity-50">
              <Command size={8} /><span>K</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="px-2 pt-3 pb-1">
          <button onClick={onCmdK}
            className="w-full flex items-center justify-center p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Search size={14} />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto space-y-0.5 px-2 scroll-ios">
        {NAV_ITEMS.map(item => {
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center rounded-xl transition-all duration-150 relative group
                ${collapsed ? "justify-center p-2.5" : "gap-3 px-2.5 py-2.5"}
                ${active
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"}`}>
              {active && (
                <motion.div layoutId="nav-indicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <span className={`flex-shrink-0 ${active ? "text-primary" : ""}`}>{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left text-[13px] font-medium truncate">{item.label}</span>
                  {item.badge && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0
                      ${active ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500"}`}>
                      {item.badge}
                    </span>
                  )}
                </>
              )}
              {/* Tooltip for collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-2.5 px-2.5 py-1.5 rounded-lg bg-foreground/90 text-background text-xs whitespace-nowrap
                  opacity-0 pointer-events-none group-hover:opacity-100 z-50 shadow-lg transition-opacity duration-100">
                  {item.label}
                  {item.badge && <span className="ml-1.5 text-primary font-medium">{item.badge}</span>}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-border ${collapsed ? "p-2" : "p-3"}`}>
        <button onClick={() => setPage("settings")}
          className={`w-full flex items-center rounded-xl transition-colors text-muted-foreground hover:text-foreground hover:bg-muted
            ${page === "settings" ? "text-primary" : ""}
            ${collapsed ? "justify-center p-2.5" : "gap-3 px-2.5 py-2.5"}`}>
          <Settings size={17} className="flex-shrink-0" />
          {!collapsed && <span className="text-[13px] font-medium">Settings</span>}
        </button>
        {!collapsed && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              <span>Pollinations.ai</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
              <span>Terminal Live</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const PAGE_META: Record<Page, { label: string; icon: React.ReactNode; desc: string }> = {
  chat:     { label: "AI Chat",           icon: <MessageSquare size={14} />, desc: "Streaming chat powered by Pollinations.ai — free" },
  images:   { label: "Image Generation",  icon: <Sparkles size={14} />,       desc: "FLUX model · Pollinations.ai · free" },
  terminal: { label: "Terminal",          icon: <Monitor size={14} />,        desc: "Live bash shell over WebSocket" },
  files:    { label: "File Manager",      icon: <FileText size={14} />,       desc: "Upload, manage and organize files" },
  agents:   { label: "Agent Marketplace", icon: <Cpu size={14} />,            desc: "136 specialized AI agents" },
  videos:   { label: "Video Tools",       icon: <Film size={14} />,           desc: "FFmpeg-powered video processing" },
  settings: { label: "Settings",          icon: <Cog size={14} />,            desc: "Configure models and integrations" },
};

function AppContent() {
  const [page, setPage] = useState<Page>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const pageMap: Record<Page, React.ReactNode> = {
    chat:     <ChatPage />,
    images:   <ImagesPage />,
    terminal: <TerminalPage />,
    files:    <FilesPage />,
    agents:   <AgentsPage setPage={setPage} />,
    videos:   <VideosPage />,
    settings: <SettingsPage />,
  };

  const meta = PAGE_META[page];

  return (
    /* NO "dark" class — light mode by default */
    <div className="flex h-full w-full bg-background overflow-hidden">
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} setPage={p => { setPage(p); setCmdOpen(false); }} />

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.div initial={{ x: -220 }} animate={{ x: 0 }} exit={{ x: -220 }}
              transition={{ type: "spring", damping: 30, stiffness: 350 }}
              className="absolute left-0 top-0 bottom-0 z-50 w-[216px]">
              <Sidebar page={page} setPage={p => { setPage(p); setMobileOpen(false); }}
                collapsed={false} setCollapsed={() => {}}
                onCmdK={() => { setMobileOpen(false); openCmd(); }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} onCmdK={openCmd} />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center h-14 px-4 border-b border-border bg-white/80 backdrop-blur-sm flex-shrink-0 gap-3 safe-top">
          <button onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Menu size={18} />
          </button>
          {collapsed && (
            <button onClick={() => setCollapsed(false)}
              className="hidden md:flex p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Menu size={18} />
            </button>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground flex-shrink-0">{meta.icon}</span>
            <span className="font-semibold text-[13px] text-foreground">{meta.label}</span>
            <span className="hidden sm:block w-px h-3.5 bg-border mx-1" />
            <span className="hidden sm:block text-xs text-muted-foreground truncate">{meta.desc}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={openCmd}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors shadow-sm">
              <Search size={11} />
              <span>Search</span>
              <span className="flex items-center gap-0.5 text-[9px] opacity-50 ml-1">
                <Command size={8} /><span>K</span>
              </span>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm">
              A
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
              className="h-full">
              {pageMap[page]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mobile bottom nav */}
        <div className="md:hidden flex items-center border-t border-border bg-white/95 backdrop-blur-md safe-bottom">
          {NAV_ITEMS.slice(0, 5).map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors
                ${page === item.id ? "text-primary" : "text-muted-foreground"}`}>
              {item.icon}
              <span className="text-[9px] font-medium">{item.label.split(" ")[0]}</span>
            </button>
          ))}
        </div>
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
