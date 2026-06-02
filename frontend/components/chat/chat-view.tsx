"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Menu, MoreHorizontal, Trash2, Pencil, MessageSquarePlus, Bot } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChatMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";
import { AgentPicker, AgentAvatar } from "./agent-picker";
import { agentsApi, chatsApi, artifactsApi } from "@/lib/api";
import { streamChat } from "@/lib/stream";
import { useAuthStore } from "@/stores/auth-store";
import { useArtifactStore } from "@/stores/artifact-store";
import { useUIStore } from "@/stores/ui-store";
import { useLogStore } from "@/stores/log-store";
import { useAgentStore } from "@/stores/agent-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import type { Agent, ChatMessage as ChatMessageT } from "@/lib/types";

export function ChatView({ chatId }: { chatId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const { setMobileView } = useUIStore();
  const { setActive, setDraft } = useArtifactStore();
  const { selectedAgentId, setSelectedAgentId } = useAgentStore();
  const { push } = useToast();
  const pushLog = useLogStore((s) => s.push);

  const { data: chat } = useQuery({ queryKey: ["chat", chatId], queryFn: () => chatsApi.get(chatId), enabled: !!chatId });
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => chatsApi.messages(chatId),
    enabled: !!chatId,
  });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });

  // Effective agent: chat's saved agent > store selection > default
  const effectiveAgentId = chat?.agent_id || selectedAgentId || agents?.find((a) => a.is_default)?.id || null;
  const effectiveAgent = agents?.find((a) => a.id === effectiveAgentId) || null;

  const [streaming, setStreaming] = React.useState(false);
  const [streamMsg, setStreamMsg] = React.useState<ChatMessageT | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [autoStick, setAutoStick] = React.useState(true);

  const stickBottom = React.useCallback(() => {
    if (!autoStick) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoStick]);

  React.useEffect(() => { stickBottom(); }, [messages.length, stickBottom]);
  React.useEffect(() => { stickBottom(); }, [streamMsg?.content, stickBottom]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoStick(atBottom);
  }

  // Persist agent on the chat
  const setChatAgent = useMutation({
    mutationFn: (agent_id: string | null) => chatsApi.update(chatId, { agent_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", chatId] }),
  });

  function chooseAgent(agent: Agent) {
    setSelectedAgentId(agent.id);
    if (chat) setChatAgent.mutate(agent.id);
  }

  async function send(content: string) {
    if (!chat) return;
    setStreaming(true);
    setAutoStick(true);

    const optimisticUser: ChatMessageT = {
      id: `local-user-${Date.now()}`,
      chat_id: chatId, role: "user", content, metadata: {},
      artifact_id: null, parent_id: null, created_at: new Date().toISOString(),
    };
    qc.setQueryData<ChatMessageT[]>(["messages", chatId], (old = []) => [...old, optimisticUser]);

    const streamingAssistant: ChatMessageT = {
      id: `local-assistant-${Date.now()}`,
      chat_id: chatId, role: "assistant", content: "",
      metadata: { agent_slug: effectiveAgent?.slug, agent_id: effectiveAgent?.id },
      artifact_id: null, parent_id: null, created_at: new Date().toISOString(),
    };
    setStreamMsg(streamingAssistant);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pushLog("stream", `[${effectiveAgent?.name || "default"}] → ${content.slice(0, 80)}`);

    try {
      await streamChat({
        chatId,
        content,
        agentId: effectiveAgentId || undefined,
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.type === "token") {
            setStreamMsg((m) => (m ? { ...m, content: m.content + e.delta } : m));
          } else if (e.type === "artifact") {
            setDraft({ type: e.artifact.type, language: e.artifact.language, content: e.artifact.content, title: e.artifact.title });
            pushLog("info", `Artifact draft: ${e.artifact.type} (${e.artifact.language ?? "—"})`);
            if (isMobile) setMobileView("artifact");
          } else if (e.type === "done") {
            pushLog("success", `← done (${e.content.length} chars)`);
            qc.setQueryData<ChatMessageT[]>(["messages", chatId], (old = []) =>
              old.map((m) =>
                m.id === optimisticUser.id
                  ? { ...m, id: e.assistant_message_id ? `user-${e.assistant_message_id}` : m.id }
                  : m,
              ),
            );
            qc.invalidateQueries({ queryKey: ["messages", chatId] });
            qc.invalidateQueries({ queryKey: ["chats", chat.workspace_id] });
            if (e.artifact_id) {
              artifactsApi.get(e.artifact_id).then((a) => setActive(a)).catch(() => undefined);
              qc.invalidateQueries({ queryKey: ["artifacts", chat.workspace_id] });
            }
          } else if (e.type === "error") {
            pushLog("error", e.error);
            push({ kind: "error", title: "Stream error", message: e.error });
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        push({ kind: "error", message: (err as Error).message });
        pushLog("error", (err as Error).message);
      } else {
        pushLog("info", "Stream stopped by user");
      }
    } finally {
      setStreaming(false);
      setStreamMsg(null);
      abortRef.current = null;
    }
  }

  function stop() { abortRef.current?.abort(); }

  function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) send(lastUser.content);
  }

  const [titleEdit, setTitleEdit] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  React.useEffect(() => { if (chat) setTitleDraft(chat.title); }, [chat]);

  const updateTitle = useMutation({
    mutationFn: () => chatsApi.update(chatId, { title: titleDraft.trim() || "Untitled" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", chatId] });
      qc.invalidateQueries({ queryKey: ["chats", chat?.workspace_id] });
      setTitleEdit(false);
    },
  });

  const deleteChat = useMutation({
    mutationFn: () => chatsApi.delete(chatId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats", chat?.workspace_id] });
      router.push("/chat");
    },
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-3 md:px-6 py-2 md:py-2.5 border-b hairline flex items-center gap-2 safe-top">
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileView("sidebar")}>
            <Menu size={16} />
          </Button>
        )}
        {titleEdit ? (
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => updateTitle.mutate()}
            onKeyDown={(e) => { if (e.key === "Enter") updateTitle.mutate(); if (e.key === "Escape") setTitleEdit(false); }}
            className="h-8 max-w-md"
          />
        ) : (
          <button
            onClick={() => setTitleEdit(true)}
            className="text-sm font-medium text-ink hover:text-ink-muted transition truncate text-left min-w-0"
            title="Click to rename"
          >
            {chat?.title || "Chat"}
          </button>
        )}
        <div className="flex-1" />
        <AgentPicker selectedAgentId={effectiveAgentId} onSelect={chooseAgent} compact={isMobile} />
        {!isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/chat")} title="New chat">
            <MessageSquarePlus size={15} />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm"><MoreHorizontal size={15} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTitleEdit(true)}><Pencil size={13} /> Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => deleteChat.mutate()} className="text-danger">
              <Trash2 size={13} /> Delete chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto py-4 md:py-6 space-y-5">
        {isLoading && (
          <div className="h-full grid place-items-center text-ink-faint text-xs">
            <Spinner />
          </div>
        )}
        {!isLoading && messages.length === 0 && !streamMsg && (
          <EmptyState onSuggest={(s) => send(s)} agent={effectiveAgent} />
        )}
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            user={user}
            agents={agents}
            onRegenerate={m.role === "assistant" ? regenerate : undefined}
          />
        ))}
        {streamMsg && (
          <ChatMessage message={streamMsg} user={user} agents={agents} streaming />
        )}
      </div>

      <div className="shrink-0">
        <ChatComposer
          onSend={(t) => send(t)}
          onStop={stop}
          streaming={streaming}
          placeholder={effectiveAgent ? `Ask ${effectiveAgent.name}...` : (chat ? `Message in "${chat.title}"...` : "Loading...")}
        />
      </div>
    </div>
  );
}

function EmptyState({ onSuggest, agent }: { onSuggest: (s: string) => void; agent: Agent | null }) {
  const fallback = [
    "Write a React component for a pricing card with three tiers",
    "Explain how vector databases work, with a small diagram",
    "Generate a JSON config for a Vite + TypeScript project",
    "Draft a markdown spec for a notes app feature",
  ];
  const suggestions = (agent?.examples?.length ? agent.examples : fallback).slice(0, 4);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="h-full grid place-items-center px-6"
    >
      <div className="max-w-xl w-full text-center">
        {agent ? (
          <div className="inline-block mb-4">
            <AgentAvatar agent={agent} size={56} />
          </div>
        ) : (
          <div className="inline-flex h-12 w-12 rounded-2xl bg-gradient-to-br from-accent to-fuchsia-500 items-center justify-center shadow-xl mb-4">
            <motion.div animate={{ rotate: [0, 8, -6, 0] }} transition={{ duration: 4, repeat: Infinity }} className="text-white text-xl">✦</motion.div>
          </div>
        )}
        <h2 className="text-xl font-semibold tracking-tight">
          {agent ? `Chat with ${agent.name}` : "What can I help you build today?"}
        </h2>
        <p className="text-sm text-ink-muted mt-1">
          {agent?.description || "Ask anything. Generated code, markdown, JSON and HTML auto-open in the artifact panel."}
        </p>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggest(s)}
              className="glass-soft text-left text-xs text-ink-muted hover:text-ink hover:bg-white/[0.05] rounded-xl p-3 transition active:scale-[0.98]"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
