import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as TermIcon, RefreshCw, Plus, X, Copy, Check } from "lucide-react";
import { io, Socket } from "socket.io-client";

const SOCKET_PATH = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/terminal/socket.io`;

let xtermLoaded = false;
let XTermClass: unknown = null;
let FitAddon: unknown = null;
let WebLinksAddon: unknown = null;

async function loadXterm() {
  if (xtermLoaded) return;
  const [xt, fit, wl] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
  ]);
  XTermClass = xt.Terminal;
  FitAddon = fit.FitAddon;
  WebLinksAddon = wl.WebLinksAddon;
  xtermLoaded = true;
}

interface Tab {
  id: string;
  label: string;
  socket: Socket | null;
  term: unknown;
  fit: unknown;
  connected: boolean;
}

export default function TerminalPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  const createTab = useCallback(async () => {
    await loadXterm();
    const id = `tab-${Date.now()}`;
    const tab: Tab = { id, label: `Shell ${tabsRef.current.length + 1}`, socket: null, term: null, fit: null, connected: false };
    setTabs(prev => { const u = [...prev, tab]; tabsRef.current = u; return u; });
    setActiveTab(id);
    return id;
  }, []);

  const mountTerminal = useCallback(async (id: string) => {
    if (!XTermClass || !FitAddon || !WebLinksAddon) return;
    const container = containerRefs.current[id];
    if (!container) return;
    const existing = tabsRef.current.find(t => t.id === id);
    if (existing?.term) return;

    type TermType = { open(el: HTMLElement): void; onData(cb: (d: string) => void): void; write(d: string): void; focus(): void; dispose(): void; };
    type FitType = { activate(t: unknown): void; fit(): void; };
    type WLType  = { activate(t: unknown): void; };

    const term = new (XTermClass as new (o: object) => TermType)({
      theme: {
        background: "#0f1117",
        foreground: "#e8eaf0",
        cursor: "#7c3aed",
        cursorAccent: "#0f1117",
        selectionBackground: "rgba(124,58,237,0.25)",
        black: "#1a1b26", brightBlack: "#414868",
        red: "#f7768e",   brightRed: "#ff899d",
        green: "#9ece6a", brightGreen: "#b9f27c",
        yellow: "#e0af68",brightYellow: "#ff9e64",
        blue: "#7aa2f7",  brightBlue: "#7da6ff",
        magenta: "#bb9af7",brightMagenta: "#c9b2ff",
        cyan: "#7dcfff",  brightCyan: "#a9e8ff",
        white: "#c0caf5", brightWhite: "#f8f8f2",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: "bar" as const,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new (FitAddon as new () => FitType)();
    const wl  = new (WebLinksAddon as new () => WLType)();
    term.open(container);
    fit.activate(term);
    wl.activate(term);
    fit.fit();

    const socket = io({ path: SOCKET_PATH, transports: ["websocket"], query: { sessionId: id } });

    term.write("\r\n  \x1b[35m◆\x1b[0m \x1b[1mNexusAI Terminal\x1b[0m  \x1b[90mConnecting…\x1b[0m\r\n\r\n");

    socket.on("session_ready", ({ sessionId }: { sessionId: string }) => {
      setTabs(prev => prev.map(t => t.id === id ? { ...t, connected: true } : t));
      term.write(`  \x1b[32m✓\x1b[0m Session \x1b[90m${sessionId.slice(-8)}\x1b[0m\r\n\r\n`);
      term.focus();
    });
    socket.on("output", (data: string) => { term.write(data); });
    socket.on("exit", ({ exitCode }: { exitCode: number }) => {
      term.write(`\r\n\x1b[90m[exited ${exitCode}]\x1b[0m\r\n`);
      setTabs(prev => prev.map(t => t.id === id ? { ...t, connected: false } : t));
    });
    socket.on("connect_error", (err: Error) => {
      term.write(`\r\n  \x1b[31m✗\x1b[0m ${err.message}\r\n`);
    });

    term.onData((data: string) => { socket.emit("input", data); });

    const obs = new ResizeObserver(() => { try { fit.fit(); } catch (_) {} });
    obs.observe(container);

    setTabs(prev => prev.map(t => t.id === id ? { ...t, socket, term, fit } : t));
  }, []);

  useEffect(() => { createTab(); }, [createTab]);
  useEffect(() => { if (activeTab) { setTimeout(() => mountTerminal(activeTab), 80); } }, [activeTab, mountTerminal]);

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      (tab.socket as Socket | null)?.disconnect();
      (tab.term as { dispose?: () => void } | null)?.dispose?.();
    }
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTab === id) setActiveTab(remaining[remaining.length - 1]?.id ?? null);
  };

  const reconnect = () => {
    if (!activeTab) return;
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    (tab.socket as Socket | null)?.disconnect();
    setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, socket: null, term: null, fit: null, connected: false } : t));
    setTimeout(() => mountTerminal(activeTab), 100);
  };

  const activeTabData = tabs.find(t => t.id === activeTab);

  return (
    <div className="flex flex-col h-full bg-[#0f1117] overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-white/8 bg-[#0a0b0f] flex-shrink-0 px-2 h-10 gap-1">
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0
                ${activeTab === tab.id ? "bg-violet-600/20 text-violet-300" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tab.connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
              {tab.label}
              <button onClick={e => closeTab(tab.id, e)}
                className="p-0.5 rounded hover:text-white/80 ml-0.5 transition-colors">
                <X size={10} />
              </button>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => createTab().then(id => setTimeout(() => mountTerminal(id), 80))}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors" title="New tab">
            <Plus size={13} />
          </button>
          <button onClick={reconnect}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors" title="Reconnect">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => { if (activeTab) { navigator.clipboard.writeText(activeTab); setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/8 transition-colors" title="Copy session ID">
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-1 bg-[#0a0b0f]/80 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] text-white/30">
          <TermIcon size={10} /> <span>bash</span>
        </div>
        <span className="text-white/10">·</span>
        <div className={`flex items-center gap-1.5 text-[10px] ${activeTabData?.connected ? "text-emerald-500/60" : "text-amber-500/60"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {activeTabData?.connected ? "Connected" : "Connecting…"}
        </div>
        <span className="ml-auto text-[10px] text-white/15">socket.io · bash shell</span>
      </div>

      {/* xterm containers */}
      <div className="flex-1 relative overflow-hidden">
        {tabs.map(tab => (
          <div key={tab.id}
            ref={el => { containerRefs.current[tab.id] = el; }}
            className={`absolute inset-0 ${activeTab === tab.id ? "block" : "hidden"}`}
            style={{ padding: "8px" }}
          />
        ))}
        {tabs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <TermIcon size={28} className="text-white/10 mb-3" />
            <p className="text-sm text-white/20 mb-4">No terminal sessions</p>
            <button onClick={() => createTab().then(id => setTimeout(() => mountTerminal(id), 80))}
              className="px-4 py-2 rounded-xl bg-violet-600/20 text-violet-300 text-sm hover:bg-violet-600/30 transition-colors">
              Open Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
