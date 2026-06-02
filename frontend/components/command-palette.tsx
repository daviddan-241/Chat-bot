"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, MessageSquarePlus, Plus, Settings, FileCode2, Folder, MessageSquare, FileText,
  Github, Rocket, Brain, LogOut, ArrowRight, Workflow, Sparkles, Command,
} from "lucide-react";
import { useCommandStore } from "@/stores/command-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useAuthStore } from "@/stores/auth-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { chatsApi, projectsApi, artifactsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: "navigate" | "create" | "action" | "chat" | "project" | "artifact";
  icon: React.ReactNode;
  keywords?: string[];
  shortcut?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const router = useRouter();
  const qc = useQueryClient();
  const { open, setOpen, query, setQuery } = useCommandStore();
  const { current } = useWorkspaceStore();
  const { logout } = useAuthStore();
  const { setOpen: setArtifactOpen, active } = useArtifactStore();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [active_idx, setActive] = React.useState(0);

  const { data: chats } = useQuery({
    queryKey: ["chats", current?.id],
    queryFn: () => chatsApi.list(current!.id),
    enabled: !!current && open,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current && open,
  });
  const { data: artifacts } = useQuery({
    queryKey: ["artifacts", current?.id],
    queryFn: () => artifactsApi.list(current!.id),
    enabled: !!current && open,
  });

  React.useEffect(() => {
    if (open) {
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items: CommandItem[] = React.useMemo(() => {
    const list: CommandItem[] = [
      // Navigate
      { id: "nav-chat", group: "navigate", label: "Go to Chat", icon: <MessageSquare size={14} />, run: () => router.push("/chat") },
      { id: "nav-files", group: "navigate", label: "Go to Files", icon: <FileText size={14} />, run: () => router.push("/files") },
      { id: "nav-artifacts", group: "navigate", label: "Go to Artifacts", icon: <FileCode2 size={14} />, run: () => router.push("/artifacts") },
      { id: "nav-deployments", group: "navigate", label: "Go to Deployments", icon: <Rocket size={14} />, run: () => router.push("/settings/deployments") },
      { id: "nav-memory", group: "navigate", label: "Go to Memory", icon: <Brain size={14} />, run: () => router.push("/settings/memory") },
      { id: "nav-integrations", group: "navigate", label: "Go to Integrations", icon: <Workflow size={14} />, run: () => router.push("/settings/integrations") },
      { id: "nav-settings", group: "navigate", label: "Go to Settings", icon: <Settings size={14} />, run: () => router.push("/settings") },
      // Create
      {
        id: "new-chat", group: "create", label: "New chat", icon: <MessageSquarePlus size={14} />, shortcut: "mod+J",
        run: async () => {
          if (!current) return;
          const c = await chatsApi.create({ workspace_id: current.id, title: "New chat" });
          qc.invalidateQueries({ queryKey: ["chats", current.id] });
          router.push(`/chat/${c.id}`);
        },
      },
      {
        id: "new-project", group: "create", label: "New project", icon: <Folder size={14} />,
        run: async () => {
          if (!current) return;
          const name = window.prompt("Project name");
          if (!name) return;
          const p = await projectsApi.create(current.id, name);
          qc.invalidateQueries({ queryKey: ["projects", current.id] });
          router.push(`/projects/${p.id}`);
        },
      },
      {
        id: "open-artifacts-panel", group: "action", label: "Open artifact panel", icon: <FileCode2 size={14} />, shortcut: "mod+shift+P",
        run: () => { setArtifactOpen(true); if (active) router.push("/artifacts"); },
      },
      { id: "logout", group: "action", label: "Sign out", icon: <LogOut size={14} />, run: () => logout() },
    ];

    // Inject chats/projects/artifacts (top 8 each)
    for (const c of (chats ?? []).slice(0, 12)) {
      list.push({
        id: `chat-${c.id}`,
        group: "chat",
        label: c.title || "Untitled chat",
        hint: "chat",
        icon: <MessageSquare size={14} />,
        run: () => router.push(`/chat/${c.id}`),
      });
    }
    for (const p of (projects ?? []).slice(0, 12)) {
      list.push({
        id: `proj-${p.id}`,
        group: "project",
        label: p.name,
        hint: "project",
        icon: <Folder size={14} />,
        run: () => router.push(`/projects/${p.id}`),
      });
    }
    for (const a of (artifacts ?? []).slice(0, 12)) {
      list.push({
        id: `art-${a.id}`,
        group: "artifact",
        label: a.title,
        hint: `${a.type}${a.language ? "·" + a.language : ""} · v${a.version}`,
        icon: <Sparkles size={14} />,
        run: () => router.push("/artifacts"),
      });
    }
    return list;
  }, [chats, projects, artifacts, current, router, qc, logout, setArtifactOpen, active]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.label, i.hint || "", i.group, ...(i.keywords || [])].join(" ").toLowerCase().includes(q),
    );
  }, [items, query]);

  React.useEffect(() => { setActive(0); }, [query]);

  function run(item: CommandItem) {
    setOpen(false);
    Promise.resolve(item.run()).catch(() => undefined);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active_idx];
      if (item) run(item);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Group items in display order
  const groupOrder = ["navigate", "create", "action", "chat", "project", "artifact"] as const;
  const groupLabel: Record<string, string> = {
    navigate: "Navigate",
    create: "Create",
    action: "Actions",
    chat: "Chats",
    project: "Projects",
    artifact: "Artifacts",
  };

  let displayIdx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl glass rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b hairline">
              <Search size={15} className="text-ink-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search commands, chats, projects..."
                className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <kbd className="text-[10px] text-ink-faint px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04]">
                esc
              </kbd>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-ink-faint">
                  No commands match "{query}"
                </div>
              )}
              {groupOrder.map((g) => {
                const groupItems = filtered.filter((i) => i.group === g);
                if (groupItems.length === 0) return null;
                return (
                  <div key={g} className="py-1">
                    <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-ink-faint">
                      {groupLabel[g]}
                    </div>
                    {groupItems.map((i) => {
                      displayIdx++;
                      const isActive = displayIdx === active_idx;
                      const myIdx = displayIdx;
                      return (
                        <button
                          key={i.id}
                          onMouseEnter={() => setActive(myIdx)}
                          onClick={() => run(i)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition",
                            isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                          )}
                        >
                          <div className="h-7 w-7 rounded-md bg-white/[0.04] border border-white/5 grid place-items-center text-ink-muted shrink-0">
                            {i.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-ink truncate">{i.label}</div>
                            {i.hint && <div className="text-[10px] text-ink-faint truncate">{i.hint}</div>}
                          </div>
                          {i.shortcut && (
                            <kbd className="text-[10px] text-ink-faint px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04]">
                              {i.shortcut.replace("mod", "⌘")}
                            </kbd>
                          )}
                          {isActive && <ArrowRight size={12} className="text-ink-faint" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="border-t hairline px-3 py-2 flex items-center gap-3 text-[10px] text-ink-faint">
              <span className="flex items-center gap-1"><Command size={10} /> palette</span>
              <span>↑↓ navigate</span>
              <span>⏎ run</span>
              <span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
