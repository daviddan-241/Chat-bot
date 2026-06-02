"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquarePlus, MessageSquare, Folder, FileText, Settings, Sparkles, ChevronsLeft,
  ChevronsRight, LogOut, Plus, FolderPlus, Search, User as UserIcon, ChevronDown, X,
  Workflow, Rocket, Brain, Command,
} from "lucide-react";
import { useCommandStore } from "@/stores/command-store";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/stores/auth-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { chatsApi, projectsApi, workspacesApi } from "@/lib/api";
import { cn, fmtTime, initials, slugify } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, logout } = useAuthStore();
  const { current, setCurrent } = useWorkspaceStore();
  const { sidebarCollapsed, toggleSidebar, setMobileView } = useUIStore();
  const collapsed = !mobile && sidebarCollapsed;
  const { push } = useToast();
  const [search, setSearch] = React.useState("");

  const { data: workspaces } = useQuery({ queryKey: ["workspaces"], queryFn: workspacesApi.list });
  const { data: chats } = useQuery({
    queryKey: ["chats", current?.id],
    queryFn: () => chatsApi.list(current!.id),
    enabled: !!current,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", current?.id],
    queryFn: () => projectsApi.list(current!.id),
    enabled: !!current,
  });

  const filteredChats = React.useMemo(() => {
    const list = chats ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, search]);

  const createChat = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No workspace");
      return chatsApi.create({ workspace_id: current.id, title: "New chat" });
    },
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: ["chats", current?.id] });
      if (mobile) setMobileView("chat");
      router.push(`/chat/${chat.id}`);
    },
    onError: (e) => push({ kind: "error", title: "Couldn't create chat", message: (e as Error).message }),
  });

  return (
    <div className={cn(
      "h-full flex flex-col glass border-r hairline",
      mobile ? "rounded-none" : "rounded-r-none",
    )}>
      {/* Top: brand + workspace switcher */}
      <div className="px-3 pt-3 pb-2 safe-top">
        <div className="flex items-center gap-2">
          <Link href="/chat" className="flex items-center gap-2 flex-1 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-accent to-fuchsia-500 grid place-items-center shadow-lg shrink-0">
              <Sparkles size={16} className="text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-none">Nova</div>
                <div className="text-[10px] text-ink-faint mt-0.5">AI Workspace</div>
              </div>
            )}
          </Link>
          {!mobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
              className="shrink-0"
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </Button>
          )}
          {mobile && (
            <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("chat")} aria-label="Close">
              <X size={16} />
            </Button>
          )}
        </div>

        {!collapsed && workspaces && current && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            current={current}
            onSelect={(w) => setCurrent(w)}
            onCreated={() => qc.invalidateQueries({ queryKey: ["workspaces"] })}
          />
        )}
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <Button
          onClick={() => createChat.mutate()}
          disabled={createChat.isPending}
          className={cn("w-full", collapsed && "px-0")}
          size="default"
        >
          {createChat.isPending ? <Spinner size={14} className="text-white" /> : <MessageSquarePlus size={16} />}
          {!collapsed && <span>New chat</span>}
        </Button>
      </div>

      {/* Search + ⌘K opener */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <CommandKButton />
        </div>
      )}

      {/* Scroll: chats + projects */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        {/* Chats */}
        <SectionHeader collapsed={collapsed} label="Chats" />
        <div className="space-y-0.5 mb-3">
          {filteredChats.length === 0 && (
            <div className={cn("text-[11px] text-ink-faint px-2 py-1", collapsed && "hidden")}>
              No chats yet.
            </div>
          )}
          {filteredChats.slice(0, 50).map((c) => {
            const active = pathname === `/chat/${c.id}`;
            return (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                onClick={() => mobile && setMobileView("chat")}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-ink-muted hover:text-ink hover:bg-white/[0.05] transition",
                  active && "bg-white/[0.07] text-ink",
                  collapsed && "justify-center",
                )}
                title={c.title}
              >
                <MessageSquare size={14} className="shrink-0" />
                {!collapsed && (
                  <span className="truncate flex-1 min-w-0">{c.title}</span>
                )}
                {!collapsed && (
                  <span className="text-[10px] text-ink-faint opacity-0 group-hover:opacity-100 transition">
                    {fmtTime(c.updated_at)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Projects */}
        <div className="flex items-center justify-between pr-1">
          <SectionHeader collapsed={collapsed} label="Projects" />
          {!collapsed && current && (
            <ProjectCreateDialog
              workspaceId={current.id}
              onCreated={() => qc.invalidateQueries({ queryKey: ["projects", current.id] })}
            />
          )}
        </div>
        <div className="space-y-0.5 mb-3">
          {(projects ?? []).slice(0, 30).map((p) => {
            const active = pathname === `/projects/${p.id}`;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                onClick={() => mobile && setMobileView("chat")}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-ink-muted hover:text-ink hover:bg-white/[0.05] transition",
                  active && "bg-white/[0.07] text-ink",
                  collapsed && "justify-center",
                )}
                title={p.name}
              >
                <Folder size={14} className="shrink-0" />
                {!collapsed && <span className="truncate">{p.name}</span>}
              </Link>
            );
          })}
          {!collapsed && (projects ?? []).length === 0 && (
            <div className="text-[11px] text-ink-faint px-2 py-1">No projects yet.</div>
          )}
        </div>

        {/* Other links */}
        <SectionHeader collapsed={collapsed} label="Workspace" />
        <div className="space-y-0.5">
          <NavItem href="/files" icon={<FileText size={14} />} label="Files" collapsed={collapsed} active={pathname === "/files"} onClick={() => mobile && setMobileView("chat")} />
          <NavItem href="/artifacts" icon={<Sparkles size={14} />} label="Artifacts" collapsed={collapsed} active={pathname === "/artifacts"} onClick={() => mobile && setMobileView("chat")} />
        </div>

        <SectionHeader collapsed={collapsed} label="Configure" />
        <div className="space-y-0.5">
          <NavItem href="/settings/integrations" icon={<Workflow size={14} />} label="Integrations" collapsed={collapsed} active={pathname.startsWith("/settings/integrations")} onClick={() => mobile && setMobileView("chat")} />
          <NavItem href="/settings/deployments" icon={<Rocket size={14} />} label="Deployments" collapsed={collapsed} active={pathname.startsWith("/settings/deployments")} onClick={() => mobile && setMobileView("chat")} />
          <NavItem href="/settings/memory" icon={<Brain size={14} />} label="Memory" collapsed={collapsed} active={pathname.startsWith("/settings/memory")} onClick={() => mobile && setMobileView("chat")} />
          <NavItem href="/settings" icon={<Settings size={14} />} label="Settings" collapsed={collapsed} active={pathname === "/settings"} onClick={() => mobile && setMobileView("chat")} />
        </div>
      </div>

      {/* User */}
      <div className="border-t hairline p-2 safe-bottom">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              "w-full flex items-center gap-2 p-2 rounded-md hover:bg-white/[0.05] transition text-left",
              collapsed && "justify-center",
            )}>
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center text-[11px] font-semibold text-white shrink-0">
                {initials(user?.full_name, user?.email)}
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate text-ink">{user?.full_name || user?.email}</div>
                    <div className="text-[10px] text-ink-faint truncate">{user?.email}</div>
                  </div>
                  <ChevronDown size={14} className="text-ink-faint" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings"><UserIcon size={14} /> Profile & settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()} className="text-danger">
              <LogOut size={14} /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function SectionHeader({ collapsed, label }: { collapsed: boolean; label: string }) {
  if (collapsed) return <div className="h-2" />;
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink-faint font-medium">
      {label}
    </div>
  );
}

function NavItem({
  href, icon, label, collapsed, active, onClick,
}: {
  href: string; icon: React.ReactNode; label: string; collapsed: boolean; active: boolean; onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-ink-muted hover:text-ink hover:bg-white/[0.05] transition",
        active && "bg-white/[0.07] text-ink",
        collapsed && "justify-center",
      )}
      title={label}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

function WorkspaceSwitcher({
  workspaces,
  current,
  onSelect,
  onCreated,
}: {
  workspaces: import("@/lib/types").Workspace[];
  current: import("@/lib/types").Workspace;
  onSelect: (w: import("@/lib/types").Workspace) => void;
  onCreated: () => void;
}) {
  return (
    <div className="mt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition text-left">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-sky-500 to-indigo-500 grid place-items-center text-[10px] font-bold text-white shrink-0">
              {current.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{current.name}</div>
              <div className="text-[10px] text-ink-faint truncate">Workspace</div>
            </div>
            <ChevronDown size={14} className="text-ink-faint" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => onSelect(w)}>
              <div className="h-5 w-5 rounded bg-gradient-to-br from-sky-500 to-indigo-500 grid place-items-center text-[9px] font-bold text-white">
                {w.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="truncate">{w.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <WorkspaceCreateDialog onCreated={onCreated} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkspaceCreateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const { push } = useToast();
  const create = useMutation({
    mutationFn: () => workspacesApi.create(name, slugify(name)),
    onSuccess: () => { setOpen(false); setName(""); onCreated(); push({ kind: "success", message: "Workspace created" }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <Plus size={14} /> New workspace
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>A workspace holds chats, projects and artifacts.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-ink-muted">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" autoFocus placeholder="My team" />
            {name && <p className="text-[10px] text-ink-faint mt-1">slug: <span className="font-mono">{slugify(name)}</span></p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Spinner size={14} /> : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectCreateDialog({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const { push } = useToast();
  const create = useMutation({
    mutationFn: () => projectsApi.create(workspaceId, name),
    onSuccess: () => { setOpen(false); setName(""); onCreated(); push({ kind: "success", message: "Project created" }); },
    onError: (e) => push({ kind: "error", message: (e as Error).message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="text-ink-faint hover:text-ink p-1 rounded transition"
          title="New project"
        >
          <FolderPlus size={13} />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Group related files and artifacts.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="space-y-3"
        >
          <div>
            <label className="text-xs text-ink-muted">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={!name.trim() || create.isPending}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommandKButton() {
  const { toggle } = useCommandStore();
  return (
    <button
      onClick={() => toggle()}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/5 bg-white/[0.02] text-[11px] text-ink-faint hover:text-ink hover:bg-white/[0.05] transition"
    >
      <Command size={11} />
      <span className="flex-1 text-left">Command palette</span>
      <kbd className="text-[9px] px-1 py-0.5 rounded bg-white/5 border border-white/10">⌘K</kbd>
    </button>
  );
}
