"use client";
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal, ChevronUp, ChevronDown, Trash2, ScrollText, Wrench, AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUIStore } from "@/stores/ui-store";
import { useLogStore } from "@/stores/log-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toolsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel, bottomPanelHeight, setBottomPanelHeight } = useUIStore();
  const { entries, clear } = useLogStore();
  const { current } = useWorkspaceStore();
  const [tab, setTab] = React.useState<"logs" | "tools" | "terminal">("logs");

  const { data: tools } = useQuery({
    queryKey: ["tools"],
    queryFn: toolsApi.list,
    enabled: bottomPanelOpen && tab === "tools",
  });

  const { data: logs } = useQuery({
    queryKey: ["tool-logs", current?.id],
    queryFn: () => toolsApi.logs(current!.id),
    enabled: bottomPanelOpen && tab === "tools" && !!current,
    refetchInterval: bottomPanelOpen && tab === "tools" ? 4000 : false,
  });

  // Drag resize
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  function onDragStart(e: React.MouseEvent) {
    dragRef.current = { startY: e.clientY, startH: bottomPanelHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - ev.clientY;
      setBottomPanelHeight(dragRef.current.startH + dy);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const recentErrors = entries.filter((e) => e.level === "error").length;

  return (
    <div className="shrink-0 border-t hairline bg-bg-soft/70 backdrop-blur-md">
      <button
        onClick={toggleBottomPanel}
        className="w-full px-4 py-1.5 flex items-center gap-2 hover:bg-white/[0.03] transition text-xs"
      >
        <Terminal size={13} className="text-ink-muted" />
        <span className="text-ink-muted">{bottomPanelOpen ? "Hide panel" : "Show panel"}</span>
        {!bottomPanelOpen && recentErrors > 0 && (
          <span className="inline-flex items-center gap-1 text-danger">
            <AlertTriangle size={11} /> {recentErrors}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-ink-faint">{entries.length} events</span>
        {bottomPanelOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>
      <AnimatePresence initial={false}>
        {bottomPanelOpen && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: bottomPanelHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div
              onMouseDown={onDragStart}
              className="h-1.5 cursor-row-resize bg-transparent hover:bg-white/10 transition"
              title="Drag to resize"
            />
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="h-full flex flex-col">
              <div className="px-3 pt-2 flex items-center gap-2 border-b hairline pb-2">
                <TabsList>
                  <TabsTrigger value="logs"><ScrollText size={12} /> Logs</TabsTrigger>
                  <TabsTrigger value="tools"><Wrench size={12} /> Tools</TabsTrigger>
                  <TabsTrigger value="terminal"><Terminal size={12} /> Terminal</TabsTrigger>
                </TabsList>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => clear()} title="Clear logs">
                  <Trash2 size={12} /> Clear
                </Button>
              </div>

              <TabsContent value="logs" className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                {entries.length === 0 && <div className="text-ink-faint">No events yet. Try sending a message.</div>}
                {entries.slice().reverse().map((e) => (
                  <div key={e.id} className="flex gap-2">
                    <span className="text-ink-faint shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
                    <span className={cn(
                      "shrink-0 w-14",
                      e.level === "error" && "text-danger",
                      e.level === "success" && "text-success",
                      e.level === "tool" && "text-amber-300",
                      e.level === "stream" && "text-accent-glow",
                      e.level === "info" && "text-ink-muted",
                    )}>[{e.level}]</span>
                    <span className="text-ink break-all">{e.message}</span>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="tools" className="flex-1 min-h-0 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-faint mb-2">Available tools</div>
                  <div className="space-y-1.5">
                    {(tools ?? []).map((t) => (
                      <div key={t.name} className="glass-soft rounded-lg p-2.5">
                        <div className="text-xs font-medium text-ink">{t.name}</div>
                        <div className="text-[10px] text-ink-muted">{t.description}</div>
                      </div>
                    ))}
                    {!tools && <div className="text-[11px] text-ink-faint">Loading...</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-faint mb-2">Recent executions</div>
                  <div className="space-y-1.5">
                    {(logs ?? []).slice(0, 30).map((l) => (
                      <div key={l.id} className="glass-soft rounded-lg p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-ink">{l.tool_name}</span>
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded",
                            l.status === "success" && "bg-success/15 text-success",
                            l.status === "error" && "bg-danger/15 text-danger",
                            l.status === "denied" && "bg-warning/15 text-warning",
                          )}>{l.status}</span>
                          <span className="text-[10px] text-ink-faint ml-auto">{l.duration_ms}ms</span>
                        </div>
                        {l.error && <div className="text-[10px] text-danger mt-1">{l.error}</div>}
                      </div>
                    ))}
                    {logs && logs.length === 0 && <div className="text-[11px] text-ink-faint">No tool calls yet.</div>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="terminal" className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[11px]">
                <TerminalView />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TerminalView() {
  const [history, setHistory] = React.useState<{ cmd: string; out: string }[]>([]);
  const [cmd, setCmd] = React.useState("");
  return (
    <div className="text-ink">
      <div className="text-ink-muted mb-2">
        Local sandbox terminal · type <span className="text-accent-glow">help</span> for commands.
      </div>
      {history.map((h, i) => (
        <div key={i} className="mb-1">
          <div><span className="text-success">$</span> {h.cmd}</div>
          {h.out && <pre className="text-ink-muted whitespace-pre-wrap">{h.out}</pre>}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="text-success">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && cmd.trim()) {
              const out = runCmd(cmd.trim());
              setHistory((h) => [...h, { cmd, out }]);
              setCmd("");
            }
          }}
          className="flex-1 bg-transparent outline-none border-0 text-ink"
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function runCmd(c: string): string {
  if (c === "help") return "Commands: help, date, clear, echo <text>, version";
  if (c === "date") return new Date().toString();
  if (c === "version") return "Nova v1.0.0";
  if (c.startsWith("echo ")) return c.slice(5);
  if (c === "clear") {
    setTimeout(() => location.reload(), 0);
    return "";
  }
  return `nova: command not found: ${c}`;
}
