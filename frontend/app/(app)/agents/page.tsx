"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bot, Menu, Search, Plus, Loader2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAvatar } from "@/components/chat/agent-picker";
import { agentsApi, chatsApi } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAgentStore } from "@/stores/agent-store";
import { useUIStore } from "@/stores/ui-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/types";

export default function AgentsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { current } = useWorkspaceStore();
  const { setSelectedAgentId } = useAgentStore();
  const { setMobileView } = useUIStore();
  const isMobile = useIsMobile();
  const { push } = useToast();

  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState<"all" | "builtin" | "mine">("all");

  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: agentsApi.providers });

  const filtered = React.useMemo(() => {
    let list = agents ?? [];
    if (tab === "builtin") list = list.filter((a) => a.is_builtin);
    if (tab === "mine") list = list.filter((a) => !a.is_builtin);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((a) =>
        [a.name, a.description, a.provider, ...a.capabilities].join(" ").toLowerCase().includes(s),
      );
    }
    return list;
  }, [agents, q, tab]);

  const newChat = useMutation({
    mutationFn: async (agent: Agent) => {
      if (!current) throw new Error("No workspace");
      setSelectedAgentId(agent.id);
      return chatsApi.create({
        workspace_id: current.id,
        title: `Chat with ${agent.name}`,
        agent_id: agent.id,
      });
    },
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: ["chats", current?.id] });
      if (isMobile) setMobileView("chat");
      router.push(`/chat/${chat.id}`);
    },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 md:px-6 py-2.5 border-b hairline flex items-center gap-2 safe-top">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        <Bot size={14} className="text-ink-muted" />
        <span className="text-sm font-medium text-ink">Agents</span>
        <span className="text-[10px] text-ink-faint">· {agents?.length ?? 0}</span>
      </header>

      <div className="px-4 md:px-6 pt-4 pb-2 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search agents by name, capability, provider..."
            className="pl-9"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="builtin">Built-in</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Provider status strip */}
      {providers && (
        <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-1.5">
          {providers.map((p) => (
            <span
              key={p.name}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
                p.configured
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-white/10 bg-white/[0.02] text-ink-faint",
              )}
              title={p.configured ? `${p.name} configured` : `${p.name} not configured — add API key on backend`}
            >
              {p.configured ? <Check size={9} /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" />}
              {p.name}
              {p.default_model && p.configured && <span className="opacity-60">·{p.default_model}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 pt-0">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-ink-faint">No agents match "{q}".</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                providerConfigured={
                  a.provider === "auto" || a.provider === "mock" ||
                  !!providers?.find((p) => p.name === a.provider)?.configured
                }
                onChat={() => newChat.mutate(a)}
                busy={newChat.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent, providerConfigured, onChat, busy,
}: { agent: Agent; providerConfigured: boolean; onChat: () => void; busy: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className="glass rounded-2xl p-4 flex flex-col"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-ink truncate">{agent.name}</h3>
            {agent.is_default && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent-glow">default</span>
            )}
            {!providerConfigured && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning">no key</span>
            )}
          </div>
          <div className="text-[10px] text-ink-faint mt-0.5 truncate">
            {agent.provider === "auto" ? "auto-route" : agent.provider}
            {agent.model ? ` · ${agent.model.split("/").pop()}` : ""}
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-muted mt-3 leading-relaxed line-clamp-3 min-h-[3.6em]">
        {agent.description}
      </p>
      {agent.capabilities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.capabilities.slice(0, 4).map((c) => (
            <span key={c} className="text-[9.5px] px-1.5 py-0.5 rounded bg-white/[0.05] text-ink-faint">
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="flex-1" onClick={onChat} disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Start chat
        </Button>
      </div>
    </motion.div>
  );
}
