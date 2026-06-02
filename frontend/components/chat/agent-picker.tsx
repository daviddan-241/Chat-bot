"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Brain, Zap, Star, Code2, GitPullRequest, Bug, Compass, Server, Database,
  BarChart3, Palette, PenLine, Search, FlaskConical, Languages, Lightbulb, Target,
  ShieldCheck, ChevronDown, Check, Bot,
} from "lucide-react";
import { agentsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";

type IconCmp = React.ComponentType<React.ComponentProps<typeof Sparkles>>;
const ICONS: Record<string, IconCmp> = {
  Sparkles, Brain, Zap, Star, Code2, GitPullRequest, Bug, Compass, Server, Database,
  BarChart3, Palette, PenLine, Search, FlaskConical, Languages, Lightbulb, Target, ShieldCheck, Bot,
};

const COLORS: Record<string, string> = {
  indigo: "from-indigo-500 to-violet-500",
  amber: "from-amber-500 to-orange-500",
  emerald: "from-emerald-500 to-green-500",
  sky: "from-sky-500 to-cyan-500",
  violet: "from-violet-500 to-purple-500",
  rose: "from-rose-500 to-pink-500",
  red: "from-red-500 to-rose-500",
  cyan: "from-cyan-500 to-teal-500",
  blue: "from-blue-500 to-indigo-500",
  pink: "from-pink-500 to-rose-500",
  fuchsia: "from-fuchsia-500 to-pink-500",
  lime: "from-lime-500 to-emerald-500",
  teal: "from-teal-500 to-cyan-500",
  yellow: "from-yellow-500 to-amber-500",
  orange: "from-orange-500 to-red-500",
};

export function AgentAvatar({
  agent,
  size = 28,
  className,
}: {
  agent: Pick<Agent, "icon" | "color" | "name">;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[agent.icon] || Sparkles;
  const gradient = COLORS[agent.color] || COLORS.indigo;
  return (
    <div
      className={cn(
        "rounded-lg bg-gradient-to-br grid place-items-center shadow-md shrink-0",
        gradient,
        className,
      )}
      style={{ width: size, height: size }}
      title={agent.name}
    >
      <Icon size={Math.round(size * 0.55)} className="text-white" />
    </div>
  );
}

export function AgentPicker({
  selectedAgentId,
  onSelect,
  compact = false,
}: {
  selectedAgentId: string | null | undefined;
  onSelect: (agent: Agent) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: agentsApi.providers });

  const selected = agents?.find((a) => a.id === selectedAgentId) || agents?.find((a) => a.is_default) || null;

  const filtered = React.useMemo(() => {
    if (!agents) return [];
    const q = filter.toLowerCase().trim();
    if (!q) return agents;
    return agents.filter((a) =>
      [a.name, a.description, ...a.capabilities, a.provider].join(" ").toLowerCase().includes(q),
    );
  }, [agents, filter]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const providerStatus = (provider: string): boolean => {
    if (provider === "auto" || provider === "mock") return true;
    return !!providers?.find((p) => p.name === provider)?.configured;
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition",
          compact ? "px-2 py-1" : "px-2.5 py-1.5",
        )}
        title="Switch agent"
      >
        {selected ? (
          <>
            <AgentAvatar agent={selected} size={compact ? 20 : 24} />
            <div className="text-left min-w-0">
              <div className={cn("font-medium text-ink truncate", compact ? "text-xs" : "text-sm")}>
                {selected.name}
              </div>
              {!compact && (
                <div className="text-[10px] text-ink-faint truncate">
                  {selected.provider === "auto" ? "auto-route" : selected.provider}
                  {selected.model ? ` · ${selected.model.split("/").pop()}` : ""}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Bot size={14} className="text-ink-muted" />
            <span className="text-xs text-ink-muted">Choose agent</span>
          </>
        )}
        <ChevronDown size={12} className="text-ink-faint" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.99 }}
            transition={{ duration: 0.14 }}
            className="absolute z-40 mt-1.5 w-[340px] max-w-[92vw] glass rounded-xl overflow-hidden shadow-2xl right-0 md:left-0"
          >
            <div className="px-3 py-2 border-b hairline">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter agents..."
                  className="w-full bg-transparent outline-none text-xs text-ink placeholder:text-ink-faint pl-6 py-1"
                />
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-ink-faint">No agents match.</div>
              )}
              {filtered.map((a) => {
                const isSelected = selected?.id === a.id;
                const ready = providerStatus(a.provider);
                return (
                  <button
                    key={a.id}
                    onClick={() => { onSelect(a); setOpen(false); }}
                    className={cn(
                      "w-full flex items-start gap-2.5 px-3 py-2 text-left transition",
                      isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <AgentAvatar agent={a} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-ink truncate">{a.name}</span>
                        {!ready && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning">
                            no key
                          </span>
                        )}
                        {isSelected && <Check size={11} className="text-success ml-auto" />}
                      </div>
                      <div className="text-[10.5px] text-ink-muted truncate">{a.description}</div>
                      <div className="text-[9.5px] text-ink-faint mt-0.5 truncate">
                        {a.provider === "auto" ? "auto-route" : a.provider}
                        {a.model ? ` · ${a.model.split("/").pop()}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="border-t hairline px-3 py-1.5 text-[10px] text-ink-faint flex items-center gap-2">
              <Bot size={10} />
              <span>{agents?.length ?? 0} agents available</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
